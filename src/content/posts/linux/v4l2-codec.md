---
title: V4L2 视频编解码驱动精读
published: 2026-09-17
description: '精读深研集《V4L2 视频编解码驱动框架》：M2M 设备模型、Buffer 状态机、Stateful 与 Stateless 两种驱动模型、Request API 原子提交，以及码率不稳与画面撕裂两个实战案例。'
image: 'https://www.loliapi.com/bg/'
tags: [V4L2, M2M, 编解码, linux, 驱动]
category: '视频采集'
draft: false
lang: 'zh-CN'
---

深研集系列第二篇精读（第一篇是[《ALSA/TinyALSA 与内核音频驱动》](/cjh_fuwari/posts/linux/alsa-tinyalsa-asoc/)）。之前那篇[《V4L2 驱动对象模型精读》](/cjh_fuwari/posts/linux/v4l2-driver-model/)讲的是采集/Sensor 侧的对象模型，这篇往下走——同一个 V4L2 子系统的另一半：**视频编解码**。VPU 不是采集设备，它怎么塞进 V4L2 框架？Stateful 和 Stateless 两种驱动模型差在哪？观点归原作者，原文见文末。

## 为什么编解码用 V4L2：M2M 扩展

V4L2 最初为摄像头设计，核心抽象是"设备节点 + ioctl 控制数据流"。但编解码器既不产生也不消费数据，它**转换**数据：输入压缩码流输出 YUV 帧（解码），或反之（编码）。

2010 年前后三星提出 M2M（Memory-to-Memory）扩展，思路是在一个设备节点上挂两个队列：

- **Output Queue**：用户空间把数据"输出"给驱动——对解码器来说放的是压缩码流
- **Capture Queue**：驱动把结果"捕获"给用户空间——解码后的 YUV 从这里取

命名是 V4L2 最坑新手的地方：**Output 是喂料口，Capture 是出料口**，不是字面的"输出结果"。这个命名沿袭自采集设备的语义，M2M 复用后语义完全反转——高通内部文档甚至专门改叫 source/sink queue 来避免混淆。

为什么不用自定义 ioctl？三个理由：用户空间统一（GStreamer/FFmpeg/MediaCodec 都只对接 V4L2 API）；内核审核规则（通用子系统优先，自定义 ioctl 在 linux-media 列表基本被拒）；videobuf2 的 Buffer 管理直接复用（DMA-BUF import/export、mmap、userptr 三种模式白送）。

## M2M 数据流与调度

解码流程的关键约束：用户空间必须**同时**向两个队列供数——Output 空了 VPU 没输入，Capture 空了解码完没地方写，两种情况都会让 pipeline 停滞。Android MediaCodec 的 `queueInputBuffer`/`releaseOutputBuffer` 正好映射到这两个队列。

内核侧的调度是"双条件触发"：`v4l2_m2m_try_schedule()` 在每次 QBUF 时检查 output 队列有待处理 buffer **且** capture 队列有空闲 buffer，同时满足才调驱动的 `device_run` 回调启动硬件。驱动不用自己写就绪检查——这个设计把状态同步收进了框架。

## Buffer 状态机：STREAMOFF 是核弹

每个 buffer 在内核里有严格状态机（DEQUEUED → QUEUED → ACTIVE → DONE → 回到 DEQUEUED），三个易踩的点：

- **PREPARE_BUF 可选**：多数场景直接跳过，只有想提前做 DMA 映射减少 QBUF 延迟时才用
- **STREAMOFF 是核弹**：把该队列**所有** buffer 强制拉回 DEQUEUED，不管它们在 QUEUED 还是 ACTIVE。这就是 seek 昂贵的原因——不是解码慢，是整条 buffer pipeline 被清空重建。Android MediaCodec 的 `flush()` 底层就是 STREAMOFF + STREAMON，in-flight buffer 全部作废，解码器要从下一个 IDR 重来。码流 IDR 间隔长的直播流，seek 延迟会非常明显
- **DONE 状态用户不可见**：DQBUF 时 buffer 没到 DONE 就阻塞（或非阻塞模式返回 -EAGAIN）

与 DMA-BUF 的集成点：`V4L2_MEMORY_DMABUF` 时 QBUF 传 fd，驱动经 `dma_buf_attach` + `map_attachment` 拿物理地址配给 VPU——站内[零拷贝精读](/cjh_fuwari/posts/rk3588/zero-copy/)讲的 attach/map 和 fence 同步就发生在这个环节。

## Stateful：驱动掌控一切

Android 手机上九成以上硬件编解码器是 stateful 模型：**驱动内部维护完整解码状态**——参考帧管理、DPB 分配、码流解析全在驱动/固件里，用户空间只管喂数据取结果。

典型交互：喂码流 → 驱动解析 SPS/PPS → 通过 `V4L2_EVENT_SOURCE_CHANGE` 事件通知"分辨率变了" → 用户空间重新协商 capture buffer → 持续解码。动态分辨率切换（如自适应直播）要走完"完成已有帧 → 发事件 → 用户 STREAMOFF → 重协商 → STREAMON"五步以上，任何一步出错就卡死——不少 bug 出在 Codec2 V4L2 适配层漏步骤。

两个实战教训：一是事件触发时机依赖固件——某些平台收到第一个 IDR 前不触发 SOURCE_CHANGE，从流中间开始播放时前面 P 帧被**静默丢弃**，无错误无事件，只是 capture 队列迟迟不出数；二是固件升级会改变行为而 API 不变，这正是 Android CTS media 测试项特别多的原因——用测试约束驱动行为一致性。

## Stateless：把状态还给用户空间

另一个极端：**驱动不维护任何解码状态**。参考帧列表、量化矩阵、slice header 全由用户空间通过 Extended Controls 逐帧传入。内核代码从 10000+ 行缩到 2000~5000 行，码流解析上移到 FFmpeg/GStreamer。

为什么 VP9/AV1 这些更新的格式反而用"更简单"的驱动模型？因为硬件设计哲学变了：早期 VPU（高通 Venus）是"自治型"，固件复杂难修；新一代（Hantro G2、RKVDEC2）走"协处理器"路线——硬件只做计算密集部分（IDCT、运动补偿、环路滤波），状态管理归软件。

| 维度 | Stateful | Stateless |
| --- | --- | --- |
| 内核代码量 | 10000+ 行 | 2000~5000 行 |
| 用户空间复杂度 | 低 | 高（需完整解析器） |
| mainline 状态 | 少数合入 | 多数已合入 |
| Android 支持 | 原生 | 12+ 经 Request API |
| 适合格式 | H.264/HEVC | VP9/AV1/MPEG2 |

原文的揭示性结论：Stateless 能进 Linux mainline 的关键不是技术更好，而是**可审计性**——stateful 驱动内部状态机的正确性几乎无法靠 code review 验证，而 stateless 每次调用输入输出确定、可推理。Hantro/Cedrus/RKVDEC 早早合入，高通 Venus 磨了好几年。

## Request API：原子提交

Stateless 有个竞态难题：一帧解码要同时给 buffer（QBUF）和参数（S_EXT_CTRLS），两个独立 ioctl 中间可能被别的线程插队。Request API 的解法是**把多个操作打包成一个 request 原子提交**：

```c
int req_fd = ioctl(media_fd, MEDIA_IOC_REQUEST_ALLOC);

/* 参数绑定到 request */
struct v4l2_ext_controls ctrls = { .request_fd = req_fd, ... };
ioctl(video_fd, VIDIOC_S_EXT_CTRLS, &ctrls);

/* buffer 绑定到 request */
struct v4l2_buffer buf = { .flags = V4L2_BUF_FLAG_REQUEST_FD,
                           .request_fd = req_fd, ... };
ioctl(video_fd, VIDIOC_QBUF, &buf);

/* 原子提交：参数 + buffer 一起生效 */
ioctl(req_fd, MEDIA_REQUEST_IOC_QUEUE);
```

本质是给 V4L2 加了"事务"概念——驱动看到的是"一帧"的完整上下文而不是零散命令。附带两个好处：流水线化（提前备好后续帧的 request，硬件连续调度利用率更高）；ChromeOS VP9 4K 场景实测吞吐提升 15~20%（批量提交减少近一半系统调用）。注意目前 Request API 只覆盖 output 侧——capture 侧的解码结果没有附加元数据，仍是常规 QBUF/DQBUF。Android 12+ 的 Codec2 对 stateless 硬件的支持路径（从 ChromeOS 移植）就建在它之上。

## 实战案例一：编码码率不稳定

现象：目标码率 8Mbps，实际输出 2~15Mbps 乱跳。排查：`v4l2-ctl --get-ctrl` 确认参数已设置 → 给调用顺序打时间戳日志，发现 **S_FMT 在 STREAMON 之后被调用**。

根因：很多编码驱动里 `S_FMT` 会把编码参数**重置为默认值**（格式变化可能意味着原配置不兼容，驱动选了"安全重置"）。而用户空间"先设码率 → STREAMON → 发现 capture 格式要调整 → 重新 S_FMT"的顺序，把码率悄悄抹掉了——没有错误码，没有事件。

修复是固化顺序：**先完成所有格式协商和 REQBUFS，最后设编码参数，再 STREAMON**。这暴露了 V4L2 的设计缺陷：控制参数与格式配置间存在隐式依赖，却没有 API 契约声明"哪些操作会清掉哪些参数"。Stateless + Request API 从根上消除了这类问题。

## 实战案例二：解码画面撕裂

现象：解码输出送 Display 出现水平撕裂，dump capture buffer 数据正确，其他视频源又正常——问题夹在中间。

根因：**DMA-BUF fence 没有正确传递**。VPU 的 DMA 写入还没完成，buffer 就被 DQBUF 交给用户空间，下游立即送 Display 就读到半写状态的数据。修复分两档：基础版在驱动的 `buf_finish` 回调里等 VPU DMA 完成；正确版是实现 explicit fence（`V4L2_BUF_FLAG_OUT_FENCE`），把 fence 传给下游由硬件等待，避免 CPU 侧阻塞。

这个问题的隐蔽性在于：bringup 阶段"先跑通后补 fence"很常见，低帧率（24fps 电影）下 DMA 有时间写完根本不暴露，一旦切到 60fps 高帧率场景就随机撕裂——正好撞上 benchmark 或 CTS 测试。

## 源码导航

| 路径 | 内容 |
| --- | --- |
| `drivers/media/v4l2-core/v4l2-mem2mem.c` | M2M 框架核心 |
| `drivers/media/common/videobuf2/` | Buffer 管理框架 |
| `drivers/media/platform/qcom/venus/` | 高通 Stateful 驱动 |
| `drivers/media/platform/verisilicon/` | Hantro Stateless 解码驱动 |
| `drivers/media/platform/rockchip/rkvdec/` | 瑞芯微 Stateless 解码驱动 |
| `include/uapi/linux/videodev2.h` | 用户空间 API 定义 |

## 写在最后

两种模型不是对错而是工程权衡：硬件有强固件和完整码流解析器，stateful 是自然选择；想进 mainline 或硬件本就是"无脑计算单元"，stateless + Request API 是正路。作者预判 Android 16/17 上 stateless 支持会从可选变成 CTS 要求。

这篇和站内几篇拼起来正好是完整的 V4L2 图谱：[对象模型篇](/cjh_fuwari/posts/linux/v4l2-driver-model/)是采集侧骨架，本篇是编解码侧的 M2M/Stateful/Stateless，[零拷贝篇](/cjh_fuwari/posts/rk3588/zero-copy/)讲 buffer 在 V4L2/VPU/Display 间怎么流转——三篇合读，从 Sensor 到 VPU 到屏幕的整条视频链路就通了。

## 参考资料

- 原文：[V4L2 视频编解码驱动框架 — 深研集（微信公众号）](https://mp.weixin.qq.com/s/V85b4A52hqjnyVsjhODsPw)
- 原文引用的一手信源：[V4L2 Stateless Decoder 接口文档](https://www.kernel.org/doc/html/latest/userspace-api/media/v4l/dev-stateless-decoder.html)、[M2M 接口文档](https://www.kernel.org/doc/html/latest/userspace-api/media/v4l/dev-mem2mem.html)、[Request API 文档](https://www.kernel.org/doc/html/latest/userspace-api/media/mediactl/request-api.html)
- 站内相关：[《V4L2 驱动对象模型精读》](/cjh_fuwari/posts/linux/v4l2-driver-model/)、[《Rockchip 零拷贝技术精读》](/cjh_fuwari/posts/rk3588/zero-copy/)、[《ALSA/TinyALSA 与内核音频驱动精读》](/cjh_fuwari/posts/linux/alsa-tinyalsa-asoc/)
