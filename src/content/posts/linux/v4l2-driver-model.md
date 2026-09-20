---
title: V4L2 驱动对象模型精读
published: 2026-09-16
description: '精读 txp《v4l2驱动学习：建立 Linux V4L2 驱动对象模型》，梳理 V4L2 四大框架、七大核心对象的职责边界，以及用 VIMC/IMX335/RKCIF 三个实例验证对象模型的学习路径。'
image: 'https://www.loliapi.com/bg/'
tags: [v4l2, linux, 驱动]
category: '视频采集'
draft: false
lang: 'zh-CN'
---

站里之前写过一篇[《视频采集开发》](/cjh_fuwari/posts/linux/v4l2/)，讲的是用户态怎么走通 open → REQBUFS → QBUF → DQBUF 的采集流程。但这几天读内核驱动源码时发现，应用层的流程知识到了内核侧完全不够用——网上读到 txp 的《v4l2驱动学习：建立 Linux V4L2 驱动对象模型》一文（基于 RV1126B 平台 IMX335 摄像头链路），把驱动对象模型讲得非常透，这篇笔记按我的理解提炼其骨架，观点归原作者，原文链接见文末。

## 为什么直接啃源码会迷路

第一次读 V4L2 驱动代码（比如某 Sensor 的 `xxx.c` 或平台 `capture.c`）的典型体验是：函数多、回调多、结构体互相嵌套，几千行读下来，连几个最基本的问题都答不上来——为什么 Sensor 驱动通常不注册 `/dev/videoX`？`v4l2_device` 和 `media_device` 名字这么像，是不是同一个东西？

根源在于：**V4L2 不是一个结构体加一套 file_operations，而是四套协作框架的组合**：

1. **V4L2 Core**——视频字符设备、IOCTL 分发、Subdev、Controls 等通用机制
2. **Media Controller**——用 entity / pad / link 描述设备内部的媒体拓扑
3. **Videobuf2 (VB2)**——用户缓冲区的申请、映射、排队与完成通知
4. **平台驱动**——把标准回调接到真实的 Sensor、CSI、DMA 和中断上

对象没放对层次，就会把平台私有实现误认成 V4L2 通用规则。

## 五问阅读法

原文给了一条最重要的阅读原则：每遇到一个对象，固定回答五个问题——

1. 它解决什么问题？（对象聚合、用户入口、媒体拓扑还是缓冲区管理）
2. 谁创建它？
3. 谁注册它？调用了哪个 Core 辅助函数？
4. 谁释放它？
5. 用户态能否直接访问？对应哪个 `/dev/*` 节点？

字段会随内核版本漂移，但**对象的职责和边界相对稳定**——这五问比背结构体成员值钱得多。

## 三类用户态入口

| 节点 | 用途 | 背后对象 |
| --- | --- | --- |
| `/dev/videoX` | 协商格式、申请缓冲区、启停采集、取帧 | `video_device` + `vb2_queue` |
| `/dev/mediaX` | 枚举 entity/pad/link，查看媒体拓扑 | `media_device` |
| `/dev/v4l-subdevX` | Subdev 的 pad 格式、事件等操作 | `v4l2_subdev`（可选暴露） |

必须建立的认识：**设备节点只是某个对象暴露给用户态的入口，不等于硬件实体本身**。IMX335 是真实的 I2C 摄像头，但它不提供帧缓冲区，所以它的核心身份是 `v4l2_subdev`；真正承接 REQBUFS/STREAMON 的 `/dev/videoX` 由下游的 Capture 驱动注册。

## 七大核心对象

| 对象 | 一句话职责 |
| --- | --- |
| `v4l2_device` | V4L2 子对象的聚合器：管理 subdev 链表、统一锁与引用计数。它不是字符设备，注册它不会产生任何 `/dev` 节点 |
| `media_device` | 媒体拓扑的根：维护所有 entity、pad、link，对应 `/dev/mediaX` |
| `video_device` | 对外办事窗口：承接 open/ioctl/mmap/poll，注册后才有 `/dev/videoX` |
| `v4l2_fh` | 一次 `open()` 的文件上下文：事件订阅、优先级等每进程独立状态 |
| `v4l2_subdev` | 流水线内部组件（Sensor、CSI、ISP 子模块）的标准抽象 |
| `media_entity` / `pad` / `link` | 拓扑中的实体、端口和有向连接 |
| `vb2_queue` | 帧缓冲区生命周期管理，连接用户态 IO 与平台 DMA |

平台驱动的典型写法是把这些通用对象**内嵌进自己的私有结构体**，再逐个填充字段后交给 Core 注册——"对象先准备完整，再注册"这个顺序在所有驱动里都成立。

## 三组最容易混淆的概念

**`fops` vs `ioctl_ops`**：前者回答 VFS 调用到哪个入口，后者回答具体 V4L2 命令交给谁。调用链是：`ioctl() → fops->unlocked_ioctl → video_ioctl2() → ioctl_ops->vidioc_xxx → VB2 helper 或平台回调`。

**两个 `release`**：`v4l2_file_operations.release` 在关闭文件描述符时调用，处理本次 open 的上下文；`video_device.release` 在节点对象引用归零时调用，处理节点本身的生命周期。当 `video_device` 内嵌在驱动私有结构体里时，后者常设为 `video_device_release_empty`——两个 release 各管各的，不能混淆。

**`video_device` vs `v4l2_subdev`**：前者面向用户态 I/O 节点，后者面向流水线内部组件。二者都可内嵌 `media_entity`；subdev 默认没有设备节点，但带 `V4L2_SUBDEV_FL_HAS_DEVNODE` 标志时可以有 `/dev/v4l-subdevX`——它与 `/dev/videoX` 的采集缓冲区语义完全不同。

## 三个实例，同一套对象

原文最有价值的部分是用三个由简到繁的实例验证同一套对象模型：

- **VIMC**（内核虚拟媒体设备）：没有真实寄存器和 DMA 干扰，`media_device + v4l2_device` 做根，sensor 内嵌 `v4l2_subdev`，capture 内嵌 `video_device + vb2_queue`——最小可读的标准参考实现，入门首选
- **IMX335**（真实 I2C Sensor）：框架部分与 VIMC 几乎一致（subdev init → controls → source pad → 异步注册），新增的只有电源时钟、寄存器表、mode 表这些硬件私货。读真实 Sensor 驱动的技巧：**把通用框架部分和硬件部分分开标记**
- **RKCIF**（Rockchip 采集驱动）：`rkcif_vdev_node` 内嵌 `video_device + vb2_queue + media_pad`，外层 `rkcif_stream` 再挂硬件队列和中断状态——"通用对象嵌入平台私有结构体"的教科书式写法

## 板端观察实验

对象模型建立后，上板验证（原文命令，我实测有效）：

```shell
# 枚举所有媒体节点，不要按编号猜用途
ls -l /dev/media* /dev/video* /dev/v4l-subdev* 2>/dev/null

# 逐个查看能力与格式
for n in /dev/video*; do
    echo "===== $n ====="
    v4l2-ctl -d "$n" --all 2>/dev/null | head -80
done
```

关注 Driver name、Device Caps、单/多平面、Streaming 能力，再用 `media-ctl -p -d /dev/mediaX` 对照拓扑——`media-ctl` 里看到的每个 entity，都应能对应到上面七个对象之一。

## 学习路径建议

原文给的两步走值得照抄：第一天吃透术语和对象关系（验收标准是不看源码能回答 video_device 与 v4l2_subdev 的差异、为什么 media_entity 不等于 /dev/videoX 这类问题）；第二天用 VIMC → IMX335 → RKCIF 逐个验证，每个实例只验证对象身份，不碰 HDR、中断细节这些支线。

一句话总结整套框架：**`v4l2_device` 管聚合，`media_device` 管拓扑，`video_device` 管用户入口，`v4l2_fh` 管一次打开，`v4l2_subdev` 管流水线组件，`vb2_queue` 管帧缓冲——平台驱动负责把它们焊到真实硬件上**。这句话能对应到三个实例的具体结构体时，再去追格式协商、异步绑定和 VB2 状态机，效率远高于直接通读平台代码。

## 参考资料

- 原文：[v4l2驱动学习：建立 Linux V4L2 驱动对象模型 — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/XhM4RCxjZEyls5re8UOh0A)
- 站内相关：[《视频采集开发》](/cjh_fuwari/posts/linux/v4l2/)（用户态采集流程）
