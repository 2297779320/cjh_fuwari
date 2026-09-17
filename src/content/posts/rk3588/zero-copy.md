---
title: Rockchip 零拷贝技术精读
published: 2026-09-16
description: '精读 txp《rk平台上的零拷贝技术到底是咋回事？》：DMA-BUF 对象链、V4L2/VB2 导出导入全链路、MPP 缓冲导入、所有权状态机、stride 陷阱、同步纪律与验证方法。'
image: 'https://www.loliapi.com/bg/'
tags: [Rockchip, DMA-BUF, 零拷贝, V4L2, MPP]
category: '瑞芯微'
draft: false
lang: 'zh-CN'
---

txp 系列第四篇精读。这篇《rk平台上的零拷贝技术到底是咋回事？》共 33 章，从原理一路逐行挖到 RKCIF 内核源码和 MPP 工程整合，是四篇里最"内核"的一篇。它正好把前两篇的拼图补齐：[V4L2 对象模型](/posts/linux/v4l2-driver-model/)讲了框架，[DRM/KMS](/posts/rk3588/drm-kms/)讲了显示，[rk3588 MPP](/posts/rk3588/rk3588/)讲了编解码——而这篇讲的 DMA-BUF 就是把三者串成零拷贝数据面的那根线。观点归原作者，原文见文末。

## 一、零拷贝的本质

一句话定义：**同一组物理页在多个硬件模块间共享，交接时只传句柄，不搬像素**。

视频帧单块体积大（1080p@30fps 仅 YUV 就是约 89 MiB/s）、产生频率高，如果采集后先 CPU 拷一次到应用缓冲、再拷一次到编码器输入，等于在硬件自身读写之外凭空多出两次整帧搬运——吃 DDR 带宽、烧 CPU、反复冲刷 Cache，多路或 4K 场景直接掉帧。

注意"零"的只是**像素的整帧复制**，有四件事仍然省不掉：几百字节量级的元数据传递；DMA-BUF 到达新设备时的 attach/map（建立该设备的 DMA 地址视图）；非一致性平台上 CPU 与设备切换时的 Cache 同步；格式不兼容时的硬件转换（RGA/VPSS）——那是一次硬件读写，虽不如共享省流量，但仍远好于 CPU memcpy。

## 二、DMA-BUF 对象链

应用拿到的 fd 只是入口，内核里真正起作用的是一条对象链：

```text
fd → struct dma_buf（后备存储 + 引用计数）
  → dma_buf_attachment（某设备的一次附着）
  → sg_table（页与映射结果描述）
  → DMA address（写进硬件寄存器的最终地址）
```

同一块 dma_buf 可以被 CIF、ISP、RGA、编码器、显示控制器同时 attach；各设备可能处于不同 IOMMU 域、看到的 DMA 地址不同，但底层页始终是同一组。跨进程边界用 fd，内核内部直接传 `struct dma_buf *`——两种句柄形态指向同一块后备存储。

## 三、两种共享架构

| | 采集端分配再导出 | 外部统一分配再导入 |
| --- | --- | --- |
| 做法 | 沿用 V4L2 MMAP 分配，`VIDIOC_EXPBUF` 导出 fd 给 MPP | dma-heap/DRM/MPP 先建缓冲池，V4L2 以 `V4L2_MEMORY_DMABUF` 送 fd，MPP 导入同一组 fd |
| 优势 | 改造成本低，适合存量程序 | 缓冲数量、格式、stride、生命周期全由上层统一掌控 |
| 代价 | 缓冲策略绑定采集驱动 | 系统设计更复杂，兼容性/映射/同步全要自己保证 |

导出的就是原来那块 VB2 缓冲，不会多出一份像素；外部池模式则是更彻底的端到端方案。

## 四、MPP 接口层

四个核心内存对象：`MppBuffer`（硬件可访问内存的封装，带引用计数）、`MppFrame`（在 buffer 之上补充宽高/stride/格式/时间戳等图像属性）、`MppPacket`（一维码流）、`MppTask`（高级模式的任务容器）。关键前提：**MPP 不要求内存由它自己分配**——外部内存能包装成 MppBuffer，编码器就能直接读。

两个高频坑：

1. **stride 与对齐高度**：1920×1080 的帧实际可能按 hor_stride=2048、ver_stride=1088 存储，UV 平面起点按 stride×对齐高度算。上下游布局理解不一致，轻则绿边紫边 UV 错位，重则 DMA 越界。MppFrame 参数必须以 `VIDIOC_G_FMT` 的实际生效值为准，不能用业务侧的可见宽高
2. **编码输入零拷贝 ≠ 码流输出零拷贝**：图像侧用 dmabuf 导入 MppBuffer 即可不复制；但常用的 `encode_get_packet()` 没有外部输出缓冲入口，H.264/H.265 码流仍会被复制一次——想连码流也零拷贝，得改用 enqueue/dequeue + MppTask 异步接口

## 五、内核源码主线（RKCIF 证据链）

原文用 14 章逐行拆 RKCIF，串成一条完整证据链，提炼如下：

- **能力声明**：`vb2_queue` 的 `io_modes` 设 `VB2_MMAP | VB2_DMABUF` 只是"准入声明"，真正决定能否导出/导入的是 mem_ops（`vb2_cma_sg_memops`）是否实现 `get_dmabuf`/`attach_dmabuf`/`map_dmabuf` 等回调
- **分层纪律**：RKCIF 把 REQBUFS/QBUF/EXPBUF 等标准命令直接映射到 `vb2_ioctl_*` 通用函数，驱动只管格式校验、硬件地址、启停流和中断——V4L2 Core 分发命令、VB2 维护状态机、驱动只管硬件
- **布局契约**：`queue_setup` 不搬像素，但决定每个 plane 的数量和容量（按对齐高度换算），是共享安全的"契约"环节
- **导出链路**：`EXPBUF → vb2_ioctl_expbuf → vb2_core_expbuf → get_dmabuf → dma_buf_export → fd`，全程没有第二份像素。关键保护是引用计数：导出后 DMA-BUF 额外持有一份引用，即使视频节点侧释放，后备内存也不会被提前回收
- **导入五步**（外部 fd 反向进入）：`dma_buf_get(fd)` 还原对象 → 校验 plane 长度防越界 → attach 建立设备关联 → map 生成设备专属 sg_table → 标记映射完成。没有申请内存、没有复制
- **buf_queue 边界**：从 sg_table 取出 DMA 地址（连续内存则直接取），单 plane NV12 的 UV 起始地址由基址加偏移算出，填好地址挂入硬件链表——全程无 CPU 搬运
- **memset 陷阱**：驱动里的调试性清零只在调试开关、CPU 虚拟地址、IOMMU 关闭三条件同时满足时执行。做性能测试前必须确认关闭，否则调试代码本身就会污染测量结果
- **CIF→ISP 内部交接**：跨模块送帧不复制图像，`get_dmabuf()` 拿到 `struct dma_buf *` 直接塞进 ISP 接收队列——传的是所有权凭证，不是像素
- **内存后端选择**：默认要连续内存，但 IOMMU 可用时改由 SG/IOMMU 拼映射。结论：**零拷贝不要求物理连续，只要求各硬件能对同一后备存储建立有效 DMA 映射**
- **Cache 同步**：`prepare` 在 CPU→设备方向（保证设备读到最新），`finish` 在设备→CPU 方向（保证 CPU 缓存有效），可用 skip 标志跳过。纯采集到编码链路 CPU 根本不碰像素，应避免 mmap 后读帧、整帧 memset、软件格式转换
- **帧完成**：中断后只设 bytesused 和标记 DONE，DQBUF 拿到的还是原来的 buffer——流转的是**所有权**，不是数据
- **Rockit 私有路径**：内核侧已持有 dma_buf 指针，绕过 fd 直接 attach/map/取地址。平台私有但最能说明本质——模块间传的是同一内存对象

## 六、工程实现

**所有权状态机**是零拷贝稳定运行的核心——同一块缓冲绝不能同时被采集硬件写和编码硬件读。每个 slot 记录 V4L2 索引、fd、plane 大小、MppBuffer、状态、序号、时间戳，状态至少六种：FREE → CAPTURE_QUEUED → CAPTURING → CAPTURE_DONE → ENCODING → 回到 FREE。

整合骨架四步：EXPBUF 导出 fd（multi-planar 要对每个 memory plane 各导一次）→ `mpp_buffer_import()` 导入 MppBuffer → 构造 MppFrame（stride/格式取 G_FMT 实际值）→ 编码。主循环铁律：**DQBUF → MPP 使用 → MPP 完成 → QBUF，绝不能异步提交后立即归还缓冲**。

解码到显示与采集到编码完全对称，只是生产者/消费者互换（RKVDEC 写、显示读），同样有内部分配/半内部/纯外部三种缓冲模式。

## 七、同步与验证

三条比 fd 更重要的纪律：

- **不能过早 QBUF**：fd 交给异步 MPP 就立即归还采集，RKCIF 会覆盖编码器还在读的旧帧——撕裂、花屏、码流损坏都是这么来的
- **fence 比固定等待可靠**：`dma_fence` → `sync_file` → fence fd，硬件完成时信号通知，优于 sleep 毫秒数或按帧率猜
- **引用计数必须对称**：attach/map 与 detach/unmap、`dma_buf_put` 与 `mpp_buffer_put` 一一对应，漏一个就是 DMA-BUF 泄漏乃至 CMA 耗尽

验证"真的没有 CPU 大块复制"要分层：确认 io_modes 与 ioctl 表 → ftrace 跟踪关键函数调用顺序 → 搜代码里按 sizeimage 量级搬运的 memcpy/memset → 对比整帧 memcpy 版与 DMA-BUF 直通版的 CPU 占用和丢帧数。不同 IOMMU 域的 DMA 地址不同是正常现象，不能凭地址不同断定发生了复制。

七大误区里最值得刻在脑子里的三个：mmap ≠ 零拷贝（mmap 后 memcpy 仍是整帧复制）；传了 fd ≠ 没复制（中间层可能偷偷转换或复制）；格式名相同 ≠ 布局相同（同为 NV12，stride/对齐/plane 数都可能不同）。

## 八、八条设计建议

原文收尾的八条架构建议，压缩成清单：

1. 先统一格式（fourcc/plane 数/stride/对齐/色彩范围），再统一内存
2. 固定缓冲池，每个 slot 完整记录元数据与 fence
3. 模块间只传句柄和元数据，不传整帧副本
4. attach/map 与 detach/unmap 严格对称
5. 以完成事件（vb2_buffer_done / fence）交接所有权
6. 需要 CPU 处理时优先走 RKISP/VPSS/RGA 硬件，继续 DMA-BUF
7. 区分标准接口（V4L2 DMABUF，兼容好）与私有快路径（Rockit，性能好但耦合强）
8. MPP 导入 API 按实际 SDK 校准——不同分支的 buffer type（DRM/ION/DMA_HEAP/EXT_DMA）可能不同，机制相同

## 写在最后

这篇和前面几篇凑成了一套完整的 Rockchip 多媒体方法论：V4L2 给出对象模型，DRM/KMS 给出显示侧，MPP 给出编解码侧，而这篇用 DMA-BUF 把它们焊成一条零拷贝数据面。最大的认知升级是那句贯穿全文的主线——**零拷贝的本质是同一块后备存储在多个硬件间的安全轮转，靠的是所有权追踪和同步证明，而不是仅仅拿到一个 fd**。

## 参考资料

- 原文：[rk平台上的零拷贝技术到底是咋回事？ — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/06kfE9frnfo5bY92bHyHEw)
- 姊妹篇笔记：[《V4L2 驱动对象模型精读》](/posts/linux/v4l2-driver-model/)、[《Rockchip DRM/KMS 显示驱动精读》](/posts/rk3588/drm-kms/)、[《嵌入式音频对讲技术精读》](/posts/audio/intercom/)
- 站内相关：[《rk3588使用》](/posts/rk3588/rk3588/)（RK MPP 媒体处理）
