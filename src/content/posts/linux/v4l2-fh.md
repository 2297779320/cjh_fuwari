---
title: V4L2 源码深度解析（三）精读：同一个 /dev/videoX 被多次打开，状态如何管理
published: 2026-10-08
description: '精读 txp《V4L2 源码深度解析（三）》：fd/struct file/video_device/v4l2_fh 四对象辨析、v4l2_fh 生命周期五函数、优先级两层语义、锁边界与三步退出，附典型错误对照。'
image: 'https://www.loliapi.com/bg/'
tags: [V4L2, linux, 驱动]
category: '视频采集'
draft: false
lang: 'zh-CN'
---

txp《V4L2 源码深度解析》系列第三篇（站内已精读的[《驱动对象模型》](/posts/linux/v4l2-driver-model/)是同系列第一篇）。这一篇聚焦一个所有 V4L2 驱动开发者都会遇到、但很少有人真正掰清的问题：**同一个 `/dev/videoX` 被 open 多次（或经 dup 复制）之后，内核里的状态归谁管？** 全文 18 节围绕 `media/v4l2-core/v4l2-fh.c` 展开，基于 Linux 6.1 源码逐行考证。观点归原作者，原文见文末。

## 一、三个描述符，为何只有两个"打开上下文"

先分清四个层次的对象：

| 对象 | 是什么 | 生命周期 |
| --- | --- | --- |
| `fd` | 进程描述符表里的整数索引 | dup 就是再装一个槽位 |
| `struct file` | 一次 open 产生的文件对象 | 最后一个引用释放才销毁 |
| `video_device` | 注册时就存在的节点对象 | 不因打开而重建 |
| `v4l2_fh` | **每次独立 open 建立的上下文** | 随 open 生、随 release 灭 |

关键结论：`dup()` 只把已有的 `struct file` 装进新描述符槽位，**不会重跑驱动的 open**——所以 fd_a 和 fd_b 共享同一个 `file->private_data`（同一个 v4l2_fh），连 `O_NONBLOCK` 这种文件级标志都共享；而 fd_c 来自真正的第二次 open，拥有独立的 file 和 fh。句柄的划分单位是"打开上下文"，**既不是进程也不是 fd 编号**——两个进程可以共享一个上下文，一个进程也可以持有多个上下文。

另一个必须建立的认知：打开成功 ≠ 拥有独立硬件。节点级 VB2 队列可能已被某个上下文占用，帧也不会自动复制给每个打开者。

## 二、v4l2-fh.c 在框架中的位置

分工：`v4l2-dev.c` 定位节点并转发文件操作，`v4l2-ioctl.c` 分发命令，`v4l2-fh.c` 补上这些操作依附的"打开级上下文"。完整生命周期链：`v4l2_open()` 取节点引用（video_get）→ 调驱动 open 回调 → 接入 `v4l2_fh_open()`（分配/init/add）→ ioctl 经 `file->private_data` 使用上下文 → 最后一个引用释放时 `v4l2_release()` 完成 del/exit/释放 → video_put。

两个容易混淆的边界：核心的 `v4l2_open()` **不会**自动调 `v4l2_fh_open()`——必须驱动主动接入；`v4l2_fh_init()` 也不增加设备引用——节点存活保护完全由外层 open/release 的引用配对负责。

## 三、struct v4l2_fh：保存什么，不保存什么

成员分三类：**节点关联**（`list` 是挂入 `vdev->fh_list` 的内嵌成员，`vdev` 指回节点——双向关联但不是双向引用计数）；**操作与事件状态**（`ctrl_handler` 只是从节点继承的指针而非控制值快照；`subscribed`/`available`/`wait`/`sequence` 各司其职，初始化容器不等于自动订阅了事件）；**纯关联字段**（`m2m_ctx`，fh 层不创建也不销毁它）。

最重要的负面结论：**这个结构体没有通用引用计数**（无 kref/refcount_t）。把 fh 裸指针交给工作队列等异步路径不会自动延长寿命——驱动必须自己停止异步访问，或建立明确的持有协议。

## 四、五函数生命周期精读

### fh_open：刻意"什么都没做"

只做三件事：`video_devdata()` 找节点 → `kzalloc()` 分配 → init + add。不注册设备、不分配缓冲区、不设置队列 owner、不启动采集。两个实现细节：`filp->private_data` 的赋值发生在判空**之前**——这不是 bug，是为了保证分配失败时 private_data 干净地留 NULL；`GFP_KERNEL` 合法是因为这是可睡眠的打开路径。布局约定：节点启用 `V4L2_FL_USES_V4L2_FH` 后，框架把 private_data 一律按 `struct v4l2_fh *` 解释——**内嵌句柄必须存 `&ctx->fh`（成员地址）而非 ctx（外层地址）**，否则框架从错误偏移解读内存。

### fh_init：作用于两个层级

句柄级：建立 vdev 关联、继承 ctrl_handler、list 初始化为空环、prio 设 UNSET、建等待队列和订阅/待取链表。节点级：置 `USES_V4L2_FH` 标志——这是"本节点采用标准句柄机制"的**永久声明**，句柄全部退出后也不清除。它还顺手设置 `valid_ioctls` 里的 G/S_PRIORITY 两个位——说明命令位图在注册后仍可修改，且改的是节点级位图。`sequence = -1` 依赖 u32 回绕：事件入队先自增再入队，首个事件序号恰好为 0；这是句柄级事件序号，不是硬件帧号。**最大陷阱：它不是清零器**——不做 memset、不清 navailable，标准路径靠 kzalloc 兜底；驱动自分配内嵌句柄时必须保证内存已清零。

### fh_add：两阶段设计与头插

init 让对象内部可用，add 才把它"曝光"：登记优先级（prio_open 把本地从 UNSET 改为默认值并累加共享计数）+ 挂入 fh_list。两步分离给了驱动一个窗口，在句柄可见前完成附加状态准备。注意优先级登记发生在自旋锁临界区之外——链表节点数与优先级计数不是被同一把锁包住的原子事务。`list_add()` 是**头插**：两个句柄的真实遍历顺序是 H → B → A，这条链只用于组织遍历，完全不是先来先服务的调度队列。

### 优先级：本地值与共享组的两层语义

存在两个 "prio"：`fh->prio` 是当前句柄的本地等级；`vdev->prio` 指向共享的优先级状态组（记录各等级上有多少有效登记，可能跨节点共享）。登记/修改/退出严格对称（open 加一、S_PRIORITY 搬桶、del 撤销），但原子计数只保证单次更新原子，不等于"判断—修改—操作"整体原子。

最大的语义陷阱：**`G_PRIORITY` 返回的是共享组内的最高有效等级，不是当前句柄自己的 prio**——本地是 INTERACTIVE 的句柄可能读到 RECORD，这不代表它自己被提升。受保护命令（`INFO_FL_PRIO`）在进入驱动回调前就执行 `v4l2_prio_check()`，本地等级低于组内最高即返回 `-EBUSY`；S_PRIORITY 自己也带此标志，所以 A 抢到 RECORD 后，B 连提升自己的请求都可能被前置拒绝。最后：优先级检查通过 ≠ 拥有队列——VB2 的 owner 检查是另一个独立层面。

## 五、独立上下文到底"独立"到什么程度

| | 独立 open ×2 | dup |
| --- | --- | --- |
| struct file / fh | 各一份 | 共享一份 |
| 事件订阅与待取队列 | 各自订阅、各得一份 | 共同订阅、共同消费同一条待取队列 |
| 本地 prio | 独立 | 共享 |
| O_NONBLOCK | 独立 | 共享（file 级标志） |

事件层面分清两条链：`subscribed`（关注什么）和 `available`（已发生待取出）是不同的链表。节点级 `v4l2_event_queue()` 遍历 fh_list 按 `(type, id)` 匹配订阅后向各句柄分别投递。但要警惕：**结构体里有事件成员不代表驱动支持事件**——还需要命令入口、订阅回调和事件产生路径（VIMC 捕获节点就没有完整的事件接口）。`vb2_poll()` 把两种就绪汇进同一次 poll：缓冲区就绪由 VB2 判断，事件就绪经 `fh->wait` 返回 `EPOLLPRI`；非阻塞 DQEVENT 没事件时返回 `-ENOENT`，不能套用 DQBUF 的 `-EAGAIN` 习惯。

## 六、锁的边界：四种锁不可混淆

- `vdev->fh_lock`（节点级**自旋锁**）：只保护句柄挂接/摘除等短临界区；`spin_lock_irqsave` 屏蔽的是**本 CPU** 的中断，不是全系统，临界区内不能塞可睡眠操作
- `fh->subscribe_lock`（句柄级**互斥锁**）：完整的订阅变更流程（含可能睡眠的 add/del 回调）；事件代码先持它再短暂取 fh_lock——两把锁职责不同，不是重复
- `videodev_lock`：节点表与打开/注销交接
- `vdev->lock` / `queue->lock`：标准 ioctl 与队列路径串行化

特别地，核心 `v4l2_open()` 调驱动 open 前已释放 videodev_lock，也不会自动取 `vdev->lock`——想做"首开初始化共享硬件"的驱动必须自己建外层同步。阻塞式 DQEVENT 有独立的等待协议：调用方须已持有 `vdev->lock`，函数先**释放**它，等 `navailable != 0`，在 fh_lock 下摘取事件，醒来后重新拿回 vdev->lock 再返回。

## 七、is_singular：瞬时观察，不是独占授权

`v4l2_fh_is_singular()` 在 fh_lock 保护下检查**该句柄是否为节点 fh_list 上唯一挂接的句柄**——它不读文件引用计数、不数 fd、不关心几个进程；一个被多个 dup 共享的句柄照样可能是唯一的。由于锁释放后其他线程随时可能再 add，返回 1 只是瞬时快照，**不构成独占授权**——想做"首开重置硬件、末关清理"，必须自己用外层锁把检查与动作绑成整体。使用时机：首开判断在 add() 之后观察，末关判断在 del() 之前（摘链后的句柄是空环，结果无意义）；不要先手动拿 fh_lock 再调它（递归加锁）。

## 八、退出为什么拆成 del / exit / free 三步

- **del**：持自旋锁摘链（`list_del_init`），解锁后撤销优先级登记。不释放内存、不清 vdev（后面还要用）。**必须与 add 一一配对**——重复 del 会把共享优先级计数多减一次
- **exit**：调媒体源关闭钩子 → 沿完整退订路径 `v4l2_event_unsubscribe_all()`（含退订回调，不是清链表头）→ 销毁 subscribe_lock → **最后才把 vdev 置空**（退订过程还需要它）。不 kfree 句柄，也不管控制处理器和 M2M 上下文
- **release**：与 fh_open 配对的组合清理（del + exit + kfree + 清空 private_data），恒返 0——`__fput()` 本来也不用 release 的返回值

顺序约束两条：先 del 后 exit（exit 会清掉 del 依赖的 vdev）；exit 可能睡眠，不能在 fh_lock 临界区内执行。

## 九、内嵌句柄与失败回滚

真实驱动分配的上下文通常比 fh 大（`demo_context`），此时 private_data 指向内嵌的 `&ctx->fh`，释放的却是外层 `ctx`——靠 `container_of` 反算。**container_of 只做地址换算，不管对象生死、不加引用**；若 fh 不是首成员却直接 `kfree(fh)`，释放地址就和分配地址不一致，即使恰好是首成员也会漏掉外层资源。示例的三个要点：fh 不放结构体开头；可失败的附加分配放在 init 之后 add 之前（失败回滚只调 exit，不调尚未配对的 del）；成功路径最后才写 private_data 并挂链。

open 失败的回滚原则：核心层在驱动打开失败时只归还节点引用，**不会替驱动撤销中间资源**，且失败的 open 永远不会变成正常句柄——清理必须按"进行到哪一步"分阶段做，两条不变量是 private_data 必须清空防悬空、清理回调正在用的对象不能提前销毁。

## 十、VIMC 实证与延迟 release

VIMC 捕获节点 `open = v4l2_fh_open`、`release = vb2_fop_release`——名字不对称但并不矛盾，真正需要对称的是资源。**队列 owner 不是在 open 时设置的**：它在 REQBUFS 成功后按返回的缓冲区数量设置（有缓冲则 owner = private_data，清零则置空）。owner 比较的是**上下文指针**，不是 fd 数值也不是 PID——所以 dup 描述符共享 owner 身份，独立 open 就会被归属检查拦住。关闭路径 `_vb2_fop_release()` 先比较 owner：是 owner 才 `vb2_queue_release()`，不是则跳过；但**两条分支都会调 fh_release**——且"跳过队列释放"不等于对共享硬件毫无影响（fh_exit 里的媒体源钩子仍会执行）。

最后一个 fd 关闭为什么不一定立刻 release？触发点是 `struct file` 最后一个引用释放后进入的 `__fput()`，而它可能经 task work **延后**执行——dup 描述符、fork 继承、内存映射、进行中的操作都会让文件对象续命。不等式链：**某个 fd 关闭 ≠ file 释放 ≠ fh 释放 ≠ video_device 释放**。另外 `video_unregister_device()` 注销节点只唤醒事件等待者、不逐个 kfree 句柄，而阻塞 DQEVENT 的等待条件不含注册状态——被唤醒的任务发现仍无事件可能继续睡眠。

## 十一、典型错误对照（精选）

| 现象 | 隐藏问题 |
| --- | --- |
| 第二次 open 后既有句柄行为异常 | 每次 open 里重新初始化了 `vdev->fh_list`（毁掉既有挂接） |
| 对象不在节点遍历里、优先级不生效 | 只调了 init 忘记 add |
| 随机崩溃 | 直接 `kfree(fh)`——还在链表上、订阅和优先级未撤销 |
| 共享优先级计数莫名变负 | 反复调 del"求保险"（优先级被重复递减） |
| G_PRIORITY 返回 RECORD 就以为被提升 | 混淆共享最高值与本地值 |
| `is_singular()` 返回 1 后无锁重置硬件偶发出错 | 检查与动作之间插入了新打开 |
| fd 全关了却迟迟看不到 release 日志 | 文件引用被继承、映射或并发操作持有，最终释放被延后 |

根源总结：把"持有一个指针""在一条链表上""拥有资源""仍有引用"这四件事混为一谈。

## 十二、总结：三层对象记忆法

七个核心函数的"负责/不负责"在原文里有一张完整对照表，浓缩成三层记忆法：

> **`video_device` 描述节点，`struct file` 描述打开的文件对象，`v4l2_fh` 提供 V4L2 需要的打开级状态。**

推论：多次独立 open 得到不同句柄，但句柄之间仍可能共享控制处理器、优先级组、队列和硬件；而 dup 连打开上下文本身都不复制。原文预告下一篇进 `videobuf2-v4l2.c`——正好能接上站内[零拷贝精读](/posts/rk3588/zero-copy/)里的 REQBUFS/QBUF 话题。

对照站内已有内容：[《V4L2 驱动对象模型》](/posts/linux/v4l2-driver-model/)讲的是整个框架的对象地图，本篇把其中 `v4l2_fh` 一角放到显微镜下，两篇正好构成"面"与"点"的关系。

## 参考资料

- 原文：[V4L2 源码深度解析（三）：同一个 /dev/videoX 被多次打开，状态如何管理？ — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/BkSof9JgSZRrdQY_SXXlxQ)
- 原文基于 Linux 6.1 源码（`drivers/media/v4l2-core/v4l2-fh.c` 及关联文件）考证
- 站内相关：[《V4L2 驱动对象模型精读》](/posts/linux/v4l2-driver-model/)、[《Rockchip 零拷贝技术精读》](/posts/rk3588/zero-copy/)、[《V4L2 视频编解码驱动精读》](/posts/linux/v4l2-codec/)
