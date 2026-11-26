---
title: V4L2 STREAMOFF 与退出路径精读：停止、取消、释放不是一回事
published: 2026-10-19
description: '精读 txp《V4L2 源码解析》第十篇：STREAMOFF 的三层依赖链（停止运行/取消排队/释放存储）、VIMC 停止顺序、阻塞 DQBUF 的退出、异常回滚分类，以及写 stop_streaming 的六项检查清单。'
image: 'https://www.loliapi.com/bg/'
tags: [V4L2, VB2, linux, 驱动, 源码]
category: '视频采集'
draft: false
lang: 'zh-CN'
---

视频采集分类的 txp 系列继续——[《V4L2 文件句柄精读》](/posts/linux/v4l2-fh/)是系列第三篇，这篇《STREAMOFF 与异常退出路径》是第十篇。主题抓的是采集结束时最容易被想当然的一步：**停流了，缓冲区就能直接释放吗？** 结论是不能——中间隔着一整条依赖链。实验环境是 VIMC + CAPTURE + MMAP + vmalloc 后端，可复现。观点归原作者，原文见文末。

## 一、先把三件事分开

「收回缓冲区」实际是三步，顺序不可换：

1. **停止运行**（`stop_streaming`）：让驱动结束对内存的实际访问——等软件线程退出、停 DMA
2. **取消排队**（`__vb2_queue_cancel`）：撤销本轮提交/完成列表、唤醒等待者、补齐每块缓冲的 `buf_finish` 收尾
3. **释放存储**（`REQBUFS(0)` / `queue_release` / 最后一个引用退出）：队列放弃池，vmalloc 后端才真正 `vfree`

三条常被误读的结论先立在这：**STREAMOFF ≠ 释放内存**；**驱动的 `buf_list` 为空 ≠ 没有在途缓冲区**；`WARN_ON(owned_by_drv_count)` **只是软件兜底告警，不能替代硬件停止**。

## 二、入口与拒绝条件

调用链：`vb2_ioctl_streamoff → vb2_streamoff → vb2_core_streamoff`。途中会检查 owner（谁开的队列）、fileio、队列类型；外层还有优先级与锁的约束。被拒绝的几种情况（未启动、非 owner、类型不符）各有对应的返回码——这些层次在第八节分类里会再出现。

## 三、先让驱动停：stop_streaming 的契约

进入取消函数后**先判断 `start_streaming_called`**——没真正启动过就不该走停止流程。`stop_streaming` 是 **void 回调**，这个签名本身就是契约：驱动必须在这个回调返回前**交还全部接收到的缓冲对象**（通过 `vb2_buffer_done`），因为框架无法知道失败原因，也无法替驱动等。

VIMC 的实现示范了正确顺序：`kthread_stop` **先等抓帧线程真正退出**（它不会打断线程，只发停止请求并等待），然后才遍历 `buf_list`，把剩余缓冲按 `ERROR` 状态归还。**先遍历再停线程是经典错误**——线程可能正在往列表里放缓冲。

## 四、驱动返回之后，VB2 还要检查 ACTIVE

驱动回调返回后，框架检查 `owned_by_drv_count`：还有缓冲挂在驱动名下就 `WARN_ON` 告警。但这只是**软件层面的兜底**——告警说明驱动违约，不能说明硬件已经停了；`vb2_wait_for_all_buffers` 也只等配对计数归零，不会触发归还。

## 五、取消列表与逐块收尾

`__vb2_queue_cancel` 做四件事：清 `streaming` 与 `queued_count`、`INIT_LIST_HEAD` 重置两条列表、**先唤醒等待者**、再逐块做收尾（`__vb2_buf_mem_finish` 与 `buf_finish` 配对）。注意两个细节：唤醒发生在逐块收尾**之前**（等的人先醒，但拿不到「已完成」的假象）；`__vb2_dqbuf` **并不清零缓冲数据**——数据残留是正常现象，不要拿它判断生命周期。

## 六、阻塞在 DQBUF 的线程怎样退出

DQBUF 的等待条件里含 `!streaming`——STREAMOFF 之后，阻塞的线程会被叫醒并返回 `-EINVAL`（不是 `-EAGAIN`，也不是成功）。`wait_prepare/finish` 在等待期间让出锁，所以停止流程不会被阻塞的 DQBUF 卡死。多线程应用建议的退出顺序：先停流、再收敛所有消费者线程、最后释放队列。

## 七、STREAMOFF 返回后，池里剩什么

按四个观察时刻追踪 `queued_count` / `owned_by_drv_count` / 两条列表 / 池状态，会发现：**缓冲对象还在池里、只是全部回到 DEQUEUED**。想复用同一组缓冲，必须**重新 QBUF**——STREAMON 不会自动把旧缓冲塞回队列。

## 八、异常退出不能都画成同一条回滚线

几种情况要分开处理：**未真正启动**（没走 start_streaming，取消流程基本是空操作）；**启动回调失败**（已部分接收的缓冲要按失败路径归还）；**`vb2_queue_error` 单帧错误 vs 队列错误**（前者只影响一块缓冲，后者要求整个队列停摆，之后的 DQBUF 返回 `-ENODEV` 一类）。返回码的层次：`-EBUSY`（有在途/资源被占）、`-EINVAL`（状态不对）、`-ENODEV`（设备已断）、`-ENOTTY`（不支持的命令）——**它们在告诉你「卡在哪一层」**，不要混成一个错误处理。

## 九、真正释放池：REQBUFS(0) 与 queue_release

本实现里 `REQBUFS(0)` 也检查 `streaming`——**必须先 STREAMOFF 才能释放池**。`__vb2_queue_free` 里可能遇到 `PREPARING` 返回 `-EAGAIN`（有准备中的缓冲），并逐块调 `buf_cleanup`；`vb2_core_queue_release` **不是 kfree(q)**，它清理队列内部资源，队列对象本身归驱动。

一个反直觉的现象：**池已释放，映射仍可能存在**。vmalloc 后端的引用计数示例是 1→2→2→1→0——应用侧的 VMA 持有引用，旧 VMA 不会绑定到新池；`close(fd)` 也不是总开关。下游消费者（比如把 buffer 送去显示的进程）要自行等待传输结束。

## 十、最终关闭与设备断开

`_vb2_fop_release` 按 owner 分支处理：owner 关队列、非 owner 只清句柄。**进程被 kill 不替代驱动实现停止**——如果驱动没实现正确的 `stop_streaming`，强行终止进程只会让在途 DMA 继续写内存。设备注销时 `vb2_video_unregister_device` 会在节点注销后主动清理队列。

## 十一、写真实硬件的 stop_streaming：六项检查

1. **不再产生新任务**：停掉所有会提交 DMA 的软件路径（先断源）
2. **当前任务已结束**：等 DMA/中断/工作线程真正完成，不是「发出停止请求」
3. **无晚到完成**：处理停止之后才到达的中断（用标志位或状态机挡住）
4. **收发配对**：每个交给硬件的缓冲都必须归还（`vb2_buffer_done`，带正确状态）
5. **不死锁**：停止路径不能和完成回调抢同一把锁的顺序反了
6. **对象寿命覆盖**：驱动私有对象在最后一个在途任务结束后才可释放

## 十二、实验与七步总链

原文配了 `streamoff_probe.c` 做两轮场景（停流后复用 / 停流后释放），观察日志逐项对照。整个退出过程收束成七步：

**停止提交 → 驱动归还 → VB2 撤销并唤醒 → 补齐收尾 → 应用退出消费 → 解除映射 → 最后引用释放。**

## 写在最后

这篇和[《V4L2 文件句柄精读》](/posts/linux/v4l2-fh/)正好是一对：那篇讲「打开上下文」（fh）怎么生灭，这篇讲「队列与缓冲」（vb2）怎么退出。V4L2 的生命周期不是一条时间线，而是**多层对象各自有退出链、彼此有依赖**——缓冲区要等驱动停访问、映射要等消费者放手、池要等队列空闲。理解这种「分层退出」比记住任何一个函数都重要。

## 参考资料

- 原文：[STREAMOFF 与异常退出路径 — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/l50CHiE8yDFHrKIkbKH4PA)（《V4L2 源码解析》系列第十篇）
- 原文基于 Linux v6.1 V4L2/VB2 源码（VIMC + vmalloc 后端实验）
- 站内相关：[《V4L2 文件句柄精读》](/posts/linux/v4l2-fh/)、[《V4L2 驱动对象模型精读》](/posts/linux/v4l2-driver-model/)、[《V4L2 视频编解码驱动精读》](/posts/linux/v4l2-codec/)、[《Rockchip 零拷贝技术精读》](/posts/rk3588/zero-copy/)

## V4L2 系列导航

[对象模型](/posts/linux/v4l2-driver-model/) · [文件句柄](/posts/linux/v4l2-fh/) · [STREAMOFF](/posts/linux/v4l2-streamoff/) · [Media Controller](/posts/linux/media-controller/) · [编解码](/posts/linux/v4l2-codec/)
