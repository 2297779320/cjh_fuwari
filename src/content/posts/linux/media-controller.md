---
title: V4L2 Media Controller 精读：Entity、Pad、Link 怎样描述一条链路
published: 2026-11-17
description: '精读 txp《V4L2 源码解析》第二十篇：Entity/Pad/Link 三对象语义、三种 Link 类型与标志、三个核心函数的源码、VIMC 完整拓扑，以及九条常见误解与 media-ctl 调试。'
image: 'https://www.loliapi.com/bg/'
tags: [V4L2, MediaController, linux, 摄像头, 源码]
category: '视频采集'
draft: false
lang: 'zh-CN'
---

视频采集分类的 txp 系列继续——《V4L2 源码深度解析》第二十篇。此前站内已有[《对象模型》](/posts/linux/v4l2-driver-model/)、[《文件句柄》](/posts/linux/v4l2-fh/)（第三篇）、[《STREAMOFF》](/posts/linux/v4l2-streamoff/)（第十篇），这篇补上摄像头链路的另一套核心框架：**Media Controller**。观点归原作者，原文见文末。

开篇把问题说得很准：Sensor、CSI 接收器、ISP、Scaler、Capture 可能由不同驱动实现，内核需要一种统一方式描述它们是什么、从哪接收、往哪输出、彼此怎么连。Media Controller 不搬像素、不分配缓冲区——**它建立的是一张可查询、可遍历、可配置的媒体拓扑图**。

## 一、五个概念先分清楚

| 对象 | 表达什么 | 摄像头例子 |
| --- | --- | --- |
| `media_device` | 一套媒体拓扑的管理容器 | 一套摄像头子系统 |
| `media_entity` | 一个媒体功能模块 | Sensor、CSI、ISP、Scaler、Capture |
| `media_pad` | Entity 的输入/输出端口 | Sensor source pad、ISP sink pad |
| `media_link` | 两个 Pad 或媒体对象之间的连接 | Sensor Pad 0 → CSI Pad 0 |
| `media_interface` | Entity 对外的访问接口 | `/dev/videoX`、`/dev/v4l-subdevX` |

三个易混点：**Link 表达媒体连接，Interface 表达如何访问实体**；`/dev/mediaX` 是整个拓扑的查询/配置入口，不是某个 Entity 的数据端口；Entity **不是** `v4l2_subdev` 的同义词——Subdev 可以承载 Entity，Video 节点也可以通过 `video_device.entity` 参与媒体图，还存在非 V4L2 的媒体实体。

## 二、Entity 与 Pad

`struct media_entity` 的 `function` 描述功能类别（Sensor/视频处理器/V4L I/O），`pads` 与 `num_pads` 描述端口数组，`links` 组织连接，`ops` 提供实体级操作（如链路校验）。

Pad 用 `MEDIA_PAD_FL_SINK`（数据进入）与 `MEDIA_PAD_FL_SOURCE`（数据流出）描述方向；`index` 是它在所属 Entity `pads[]` 数组中的下标，**不是全局编号**。方向是建链的硬约束：**数据 Link 必须 SOURCE → SINK**，两个 SOURCE 或两个 SINK 相连都不是正常数据链路。

## 三、Link：连接存在，不等于一定启用

数据 Link 的方向有明确含义：IMX335 的 SOURCE Pad 0 连到 CSI Receiver 的 SINK Pad 0——**它只表示拓扑关系，不表示内核复制了一帧图像，也不代表硬件完成了电气配置**。框架会为每条数据 Link 维护反向 Link（backlink），它只是图遍历辅助，不向应用层重复报告。

三种 Link 不要混：**Data Link**（Pad → Pad，`media_create_pad_link()` 创建）；**Interface Link**（Entity ↔ 访问接口，如 Capture Entity 与 `/dev/videoX`）；**Ancillary Link**（辅助关联，如 Sensor 与 Lens，不是像素路径）。

| 标志 | 含义 |
| --- | --- |
| `MEDIA_LNK_FL_ENABLED` | 当前已启用 |
| `MEDIA_LNK_FL_IMMUTABLE` | 状态不可被普通配置操作修改 |
| `MEDIA_LNK_FL_DYNAMIC` | 动态 Link，影响流运行期间的变更限制 |
| `MEDIA_LNK_FL_DATA_LINK` / `_INTERFACE_LINK` / `_ANCILLARY_LINK` | 三种类型标志 |

关键语义：Link 被创建**不代表启用**；非动态 Link 在相关 Pad 已处于 Streaming 时修改状态可能返回 `-EBUSY`；**DYNAMIC 不是「自动切换」**——能不能切仍取决于驱动的 `link_setup`、设备状态与框架校验。

## 四、三个核心函数

**`media_entity_pads_init()`**（`mc-entity.c`）：检查数量上限 → 保存 `num_pads` 与 `pads` 数组指针 → 遍历设置 `pad->entity`/`pad->index` → 若已关联 `media_device` 才为 Pad 创建 graph object。注意它**不分配 Pad 数组、不创建 Link**，数组生命周期由驱动保证。时序细节：VIMC 里 Subdev 的 `pads_init()` 发生在 `v4l2_device_register_subdev()` **之前**，此时 Entity 可能还没关联 mdev，所以只建立内存关系；等 `media_device_register_entity()` 时才统一创建 Entity 与 Pad 的 graph object。

**`media_device_register_entity()`**（`mc-device.c`）：校验 function → 指向 mdev → 初始化 Link 链表 → IDA 分配 `internal_idx` → 在 `graph_mutex` 下创建 Entity graph object → 遍历 Pad 创建 graph object → 通知 Notify 回调 → 必要时扩展电源图遍历结构。这里有两种 ID：**对外 graph object ID**（拓扑描述用）与 **`internal_idx`**（内核遍历位图用），不是一回事。

**`media_create_pad_link()`**（`mc-entity.c`）：拒绝调用者传入 Link 类型位（它自己设 DATA_LINK）→ 校验 Entity、Pad 越界、SOURCE/SINK 方向 → 为源端分配 Link 并创建 graph object → 为目标端建反向 Link、互指、更新计数。两个调用前提值得记住：函数体**没有显式获取 `graph_mutex`，也没有比较两端 `mdev` 是否相同**——调用方要保证两端 Entity 已登记到同一个 `media_device`。VIMC 的做法是先在 `vimc_register_devices()` 里登记所有实体，再在媒体设备对外发布前集中建链。

## 五、VIMC：一张完整拓扑

VIMC 用三个配置数组描述一切：`ent_config[]`（实体：Sensor A/B、Debayer A/B、Raw Capture、Scaler、RGB/YUV Capture、Lens）、`data_links[]`、`ancillary_links[]`。数据链路里层次很清楚：

| 源 / Pad | 目标 / Pad | 初始状态 |
| --- | --- | --- |
| Sensor A / 0 | Debayer A / 0 | ENABLED、IMMUTABLE |
| Sensor A / 0 | Raw Capture 0 / 0 | ENABLED、IMMUTABLE |
| Debayer A / 1 | Scaler / 0 | ENABLED，可配置 |
| Debayer B / 1 | Scaler / 0 | **初始禁用** |
| RGB/YUV Input / 0 | Scaler / 0 | **初始禁用** |

这正好说明：**拓扑连接可以预先存在，启用状态是另一层信息**。注册顺序六步：`v4l2_device_register()` → 分配 `ent_devs[]` → `vimc_add_subdevs()` → `vimc_create_links()` → `media_device_register()`（发布 `/dev/mediaX`）→ `v4l2_device_register_subdev_nodes()`。媒体图不是一次调用自动生成的，是「注册实体 + 显式建链」逐步搭出来的。

Capture 侧则证明 Entity 不只属于 Subdev：`vimc_capture_add()` 直接初始化 `video_device.entity`、设 `MEDIA_ENT_F_IO_V4L`、Pad 标 SINK、调 `pads_init()`，注册 video_device 时把这个 Entity 接入 Media Controller。

## 六、真实摄像头链路与平台差异

典型链路：IMX335 SOURCE Pad 0 → CSI Receiver（SINK 0 / SOURCE 1）→ CIF/ISP（SINK/SOURCE）→ Capture Entity（SINK 0）→ `/dev/videoX`。但原文特意提醒：**这不是所有 Rockchip SoC 的固定结构**——存在 ISP 直连、旁路、多虚拟通道、在线/离线路径等差异，**必须以目标 SoC、DTS 和 BSP 的实际拓扑为准**。

## 七、九条常见误解（精选）

| 误解 | 正确理解 |
| --- | --- |
| Entity 就是 Subdev | Subdev 可携带 Entity，Video 节点也可以有 Entity |
| Pad 就是硬件引脚 | Pad 是逻辑数据端口，不等于封装引脚或 MIPI lane |
| Link 创建后图像就能传 | 还需要格式协商、硬件配置、流启动、缓冲区准备 |
| Link 一定 ENABLED | 可以存在但初始禁用 |
| Backlink 是另一条数据通路 | 只是内核遍历辅助，不向应用重复报告 |
| `pads_init()` 会创建 Link | 只初始化 Pad 关联 |
| Media Controller 负责 DMA | DMA 与像素内存归采集/处理驱动和缓冲区框架 |

## 八、调试：media-ctl

```bash
ls -l /dev/media*                # 有哪些媒体设备
media-ctl -p -d /dev/media0      # 打印拓扑
media-ctl -d /dev/media0 --print-dot   # 导出图形
```

重点核对六项：Entity 名称与 function；每个 Entity 的 Pad 数量/编号/方向；Link 的 source/sink 端点；Link 是否启用、是否不可变；Video Interface 是否关联到预期 Capture Entity；有没有缺失 Link、方向反接。最后一条边界：**`media-ctl -p` 显示的是内核媒体图状态，不等于硬件正在输出有效像素**——拓扑正确但无图，继续查格式、链路时钟、接收错误、中断、DMA 地址与 VB2 完成路径。

## 写在最后

三个对象 + 三个函数，就是「一条媒体链路怎样从驱动私有对象变成 `/dev/mediaX` 可查询拓扑」的完整路径。和站内[《对象模型》](/posts/linux/v4l2-driver-model/)对照着看最清楚：那篇讲 V4L2 自己的设备对象（video_device/v4l2_fh/VB2），这篇讲 Media Controller 的图对象——**同一个摄像头，两套对象体系在协同**：MC 负责「链路长什么样」，V4L2/VB2 负责「数据怎么流」。

## 参考资料

- 原文：[从 Entity 到 Pad、Link——Linux 怎样描述一条图像处理链路？ — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/kFalJmHEDFU--DN5IrFL1A)（《V4L2 源码解析》第二十篇）
- 原文基于 Linux 内核 `drivers/media/mc/` 与 VIMC 测试驱动源码
- 站内相关：[《V4L2 驱动对象模型精读》](/posts/linux/v4l2-driver-model/)、[《V4L2 文件句柄精读》](/posts/linux/v4l2-fh/)、[《V4L2 STREAMOFF 精读》](/posts/linux/v4l2-streamoff/)

## V4L2 系列导航

[对象模型](/posts/linux/v4l2-driver-model/) · [文件句柄](/posts/linux/v4l2-fh/) · [STREAMOFF](/posts/linux/v4l2-streamoff/) · [Media Controller](/posts/linux/media-controller/) · [编解码](/posts/linux/v4l2-codec/)
