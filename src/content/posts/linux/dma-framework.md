---
title: Linux DMA 驱动框架精读：一次搬运究竟经过哪些模块
published: 2026-10-07
description: '精读 txp《图解 Linux DMA 驱动框架》：DMA Mapping/DMAEngine/DMA-BUF 的职责边界、DW AXI DMAC 的注册与申请、memcpy 从 prep 到回调的六步、三种地址视角，以及摄像头链路的常见误解。'
image: 'https://www.loliapi.com/bg/'
tags: [DMA, DMAEngine, DMA-BUF, linux, 驱动]
category: '系统编程'
draft: false
lang: 'zh-CN'
---

系统编程分类第二篇——txp 的《图解 Linux DMA 驱动框架》。选题很准：站内已有[《零拷贝精读》](/posts/rk3588/zero-copy/)（DMA-BUF 的用法）和 [V4L2 系列](/posts/linux/v4l2-driver-model/)（采集/编解码），唯独缺底下那层「DMA 框架本身」。观点归原作者，原文见文末。

开篇的困惑很真实：`dma_request_chan()`、`dma_map_single()`、`dma_async_issue_pending()`、`dma_buf_attach()` 都带 `dma`，职责却不同——申请传输资源、建立设备可用地址、让排队任务进入执行、管理共享缓冲。混在一起就会画出错误的框架图：数据先过 DMA-BUF，再过 DMA Mapping，再过 DMAEngine，最后进内存。

**真实情况：软件组织任务，DMA 硬件发起数据访问；地址映射和缓冲区共享为这种访问提供条件，并不是数据依次经过的「搬运站」。**

## 一、DMA 省掉的究竟是哪部分工作

PIO 模式下 CPU 反复执行「读外设数据寄存器 → 写内存」；换 DMA 后，CPU 仍要配置外设、准备缓冲区、设参数、处理完成通知——不同的是**批量访问由 DMA 控制器发起**，不再需要 CPU 为每次读写执行搬运指令。

两个必须分清的点：**搬运可以交给 DMA，任务管理仍由 CPU 上的驱动完成**——「DMA 不经过 CPU」只描述载荷的搬运方式，不代表驱动不执行、不处理中断。另外 **DMA 不承诺每次都更快**：准备描述符、建立映射、配置硬件、完成通知、回收都有固定成本，小数据块可能比直接复制更贵；它的价值是减少 CPU 参与批量搬运并实现并行，不是凭空增加带宽。还有个小陷阱：普通 C 代码的 `memcpy()` 不会因为系统里有 DMA 控制器就自动变成 DMAEngine 任务——DW AXI DMAC 配置函数里的 `memcpy()` 复制的是配置结构体。

## 二、四个名字的职责边界

| 名称 | 负责的事 | 不该混淆成 |
| --- | --- | --- |
| DMA 硬件 | 发起总线读写，执行实际数据访问 | 一组 Linux 函数 |
| DMA Mapping API | 提供设备可用的 DMA 地址，满足缓存一致性约束 | 提交和启动传输的接口 |
| DMAEngine | 统一组织控制器、通道、任务描述符与完成通知 | 逐层流过载荷的软件管道 |
| DMA-BUF | 管理共享缓冲区的引用、设备附加、映射与同步 | 另一种 DMA 控制器 |

**Mapping**：`dma_map_single()` 建流式映射，`dma_alloc_coherent()` 把一致性分配与 DMA 地址获取结合——但**映射成功不等于数据开始搬运**。**Engine**：Client（要搬运数据的一方，如串口/SPI/I2S 驱动、dmatest）与 Provider（控制器驱动）通过通道和描述符协作，客户端不用为每种控制器重写寄存器逻辑。**BUF**：解决「一份图像被采集/处理/编码/显示多驱动共用」时的生命周期与访问关系——与 Engine 可协作但不强制依赖。

## 三、控制流向下，数据不跟着走

「客户端 → DMAEngine → 控制器驱动」是**调用关系与职责分工**，不是载荷被复制三遍。而且 DMAEngine 不等于单个 `dmaengine.c`——核心管理、头文件接口封装、控制器注册的回调、驱动辅助层共同组成，追源码要同时看接口和回调。

`prep` 构造的是**描述传输的元数据**（源/目标地址、块长度编码、链表指针），不是把载荷复制进驱动；`start` 阶段才写首个硬件链表项地址并**使能通道**。这中间还有个常被高估的层：**virt-dma 是可选的**——DW AXI DMAC 用它管软件描述符队列/cookie/回调，PL330 就不用（自维护 submitted/work/completed 三条链表），Kconfig 也能佐证（`DW_AXI_DMAC` 选 `DMA_VIRTUAL_CHANNELS`，`PL330_DMA` 没选）。

## 四、控制器、通道、描述符：三个对象

- **控制器**：`struct dma_device` 记录通道集合、能力与操作回调，DW 把它内嵌在私有结构里；这里的 device 不是「open 就能搬数据」的字符设备
- **通道**：`struct dma_chan` 是客户端持有的执行资源；**通道与「外设握手请求线」不是同一概念**，API 里的通道也不能凭想象与硬件编号恒等
- **描述符**：至少要分三层——数据缓冲区（载荷）、软件描述符 `dma_async_tx_descriptor`（回调/cookie/队列管理）、硬件链表项 LLI（按硬件格式编码的地址与控制字段）

**一笔软件任务不一定只对应一项 LLI**：长度、对齐、单块限制都可能触发拆分。另外 **cookie 是任务标识，不是「已完成」的标志**。

## 五、控制器怎样被发现：注册与申请两条线

控制器先注册、再被申请，两条线在 provider 查找与 xlate 回调处接上：

1. **`dw_probe()` 准备通道与回调**：`vchan_init()` 关联公共通道，`dma_cap_set(DMA_MEMCPY/DMA_SLAVE/DMA_CYCLIC)` 声明能力，再赋 `device_prep_dma_memcpy` 等回调——能力声明与回调必须对应，注册时会检查（声明了 MEMCPY 却没给回调直接报错）
2. **`dmaenginem_async_device_register()`**：名字里多出的 `m` 是带资源管理的版本，内部再调裸注册；它管注册资源，不管在途 DMA 的生命周期
3. **`of_dma_controller_register()`**：保存设备树节点、xlate 回调与私有数据，建立「设备树描述 → 转换函数」的关联
4. **外设 `dma_request_chan(dev, "rx")`**：进 `of_dma_request_slave_channel()`，按 `dma-names` 匹配 `dmas` 条目、查已注册控制器、调 xlate；DW 的 xlate 里先 `dma_get_any_slave_channel()`，再把设备树参数记成 `hw_handshake_num`——**这个参数不能理解成「固定使用第几个物理通道」**

## 六、一笔 memcpy：从请求到完成

以 4 KiB、非重叠、非循环的内存复制为例，沿 dmatest 的非轮询路径走六步：

1. **缓冲与映射**：分配源/目标后 `dma_map_page()`。方向必须按源码：源用 `DMA_TO_DEVICE`、目标用 `DMA_BIDIRECTIONAL`（注释说明是为强制 writeback/invalidate），不能因为「是 memcpy」就改成 `DMA_FROM_DEVICE`。注意 **Mapping 的方向描述设备怎样访问内存，Engine 的 `DMA_MEM_TO_MEM` 描述传输类型，两套枚举不能互换**
2. **prep**：直接调控制器注册的回调 `device_prep_dma_memcpy()`（不是 dmaengine 的公共封装），构造软件任务和 LLI，返回公共描述符——**这是「准备好的任务」，不是「复制好的数据」**
3. **submit**：`tx->tx_submit(tx)` 分配 cookie、把描述符移入 submitted 队列——**提交本身没有启动硬件**；此后描述符归控制器一侧，客户端不应再随意修改
4. **issue_pending**：`vchan_issue_pending()` + `axi_chan_start_first_queued()` → 写 LLI 入口、设中断、`axi_chan_enable()`。**返回不代表搬完**，它只是推进待执行任务
5. **中断与回调**：`dw_axi_dma_interrupt()` 读清状态 → `axi_chan_block_xfer_complete()` 移出 issued 链表 → `vchan_cookie_complete()` 放 completed 并调度 tasklet → `vchan_complete()` 调客户端回调。**tasklet 是软中断上下文，不能睡眠**
6. **收尾**：`dmaengine_unmap_put()` 释放映射，再校验数据。**完成通知回答「传输是否结束」，映射与缓存同步回答「CPU 现在能否按约定访问」——两个问题**。异常路径上，**等待超时只能说明软件等太久，不能证明硬件已停止访问内存**——「超时后立即解映射并释放」不是通用模板

## 七、三种地址：CPU 指针为什么不能直接给 DMA

**CPU 虚拟地址**（内核里的 `buf` 指针）、**CPU 物理地址**、**DMA 地址**（`dma_addr_t`，设备在其访问路径中使用的地址）是三个视角。简单平台上 DMA 地址可能等于物理地址；经过 IOMMU、总线桥或地址转换就可能不同。**IOMMU 是设备侧的地址翻译与访问约束，不是 CPU 的 MMU，也不能替代全部缓存一致性处理**。所以「强转成整数」「`virt_to_phys()` 后一定能用于 DMA」都不是通用写法。

DW 的硬件描述符把双视角体现得很清楚：`dma_pool_zalloc()` 返回 CPU 可写的 LLI 指针**同时**给出 DMA 地址——驱动用指针填内容、用 DMA 地址把链表交给硬件。变量名里写着 `phys` 也不能据此把 DMA 地址当成 CPU 物理地址。

## 八、摄像头链路：为什么不能一律画成 DMAEngine

「摄像头采集 → DMAEngine → 通用 DMA 控制器 → 内存」是过度简化：可能成立的只是「设备带有自己的总线访问单元、由所属驱动直接控制读写」的情况。**判断依据只有两条：客户端是否申请并使用 DMAEngine 通道、目标硬件怎样完成内存读写**——代码里有 DMA 地址、DMA 缓冲区或 DMA-BUF，都推不出一定经过 DMAEngine。

DMA-BUF 管的是**共享**：`dma_buf_export()` 建对象、`dma_buf_fd()` 关联 fd、`dma_buf_attach()` 建设备附加、`dma_buf_map_attachment()` 取该设备的映射。设备 A 和设备 B 访问同一份存储，拿到的 DMA 地址也不保证相同。共享还要满足可访问、格式布局兼容、执行顺序正确——**共享成功不等于天然零拷贝**；fence 表达设备工作是否完成，CPU 访问共享缓冲区还要遵守一致性约定。

所以图像链路要分开问三个问题：**这份存储怎样共享？每台设备怎样执行任务？生产者结束后消费者何时能访问？**——不要用一个「DMA」箭头把三个问题一起略过。

## 写在最后

这篇的价值在于**用职责边界替掉「管道图」思维**：DMA 不是一个数据依次流过的软件栈，而是一组各管一段的机制。这和站内[《零拷贝精读》](/posts/rk3588/zero-copy/)「零拷贝的本质是所有权轮转」、[《rk_libs》](/posts/rk3588/rk-libs/)「依赖方向只允许向下」是同一种读代码方式——先把边界定清楚，再谈数据怎么走。

## 参考资料

- 原文：[图解 Linux DMA 驱动框架：一次数据搬运，究竟经过哪些模块？ — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/-qhWDVKfYPYqN8yo2Unenw)
- 原文以 DW AXI DMAC 与 dmatest 源码为线索（设计文档与内核源码）
- 站内相关：[《Rockchip 零拷贝技术精读》](/posts/rk3588/zero-copy/)、[《V4L2 驱动对象模型精读》](/posts/linux/v4l2-driver-model/)、[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)
