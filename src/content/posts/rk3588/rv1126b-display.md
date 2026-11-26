---
title: RV1126B 显示硬件全景精读：VOP、RGA、DSI 与 RGB 各管什么
published: 2026-11-23
description: '精读 txp《RV1126B 显示硬件全景》：VOP/RGA/DSI/RGB/Panel 的职责分工、两条显示路径的取舍、三条典型数据路径、DDR 带宽估算与九条分层定位表。'
image: 'https://www.loliapi.com/bg/'
tags: [Rockchip, RV1126B, VOP, RGA, DSI, 显示]
category: '瑞芯微'
draft: false
lang: 'zh-CN'
---

瑞芯微分类又一篇 txp 精读——《RV1126B 显示硬件全景》。前有[《DRM/KMS 精读》](/posts/rk3588/drm-kms/)讲显示框架的对象模型、[《NV12 到 RGB888》](/posts/linux/nv12-rgb-color/)讲颜色换算，这篇补上硬件分工：**谁扫描、谁处理、谁传像素、谁发光**。观点归原作者，原文见文末。

开篇四问很典型：一帧图像已在 DDR，为什么还要 VOP？RGA 能不能直接把图像送到屏幕？DSI 和 RGB 是不是两种显示控制器？摄像头、RGA、VOP、DSI 到底怎么分工？

## 一、五条结论与一张总图

- **VOP**：显示控制器——从内存读待显示图像，按窗口配置完成显示处理与图层合成，按显示时序把像素送给输出接口
- **RGA**：二维图像处理加速器——缩放、旋转、裁剪、格式转换、填充、混合；**通常读写 DDR 缓冲，不负责持续产生扫描时序**
- **MIPI DSI**：显示串行接口协议与 Host/PHY 链路——按 DSI 包格式与电气方式传像素
- **RGB 并行接口**：另一种像素输出方式——像素时钟 + 数据线 + 同步/使能信号
- **Panel**：最终显示器件——接收接口信号、内部驱动、控制像素发光

常见路径是 **DDR → VOP → DSI/RGB → Panel**；只有输入格式/尺寸/方向不满足 VOP 直接扫描条件时，才在前增加 **DDR → RGA → DDR** 的处理步骤。

这里有两种完全不同的「数据处理」：**RGA 处理图像内容**（1920×1080 缩成 800×480 写入另一块缓冲）；**VOP 组织显示输出**（读视频层和 UI 层、按位置/层级/透明度合成、持续按屏幕时序输出）。别把「图像处理」和「显示扫描」混成一件事。

控制路径与像素路径也不同：应用的 DRM/KMS ioctl / Atomic 请求 → DRM 核心 → Rockchip DRM/VOP 驱动配置 Plane/CRTC/模式 → VOP 寄存器；**像素数据则从 DDR 经 DMA 被 VOP 读取**。DRM/KMS 不是图像搬运引擎，VOP 才是执行扫描输出的硬件。

## 二、VOP：真正负责「扫描出画面」的模块

六项职责：读一个或多个 Framebuffer；按窗口配置解释格式/基址/步长/源区域；对支持的窗口做缩放与颜色处理；按位置/层级/Alpha 合成；按显示模式产生有效像素区、行场同步与像素时钟控制；把像素流送到选定输出接口。这里的「显示窗口」是硬件图层/Plane，不是桌面上的可拖动窗口。

**从 DDR 读不等于 CPU 搬**：一张 1280×720 的 NV12，Y 在亮区、UV 交错在色度区；CPU 只配置缓冲地址、格式、stride、源/目标矩形，逐行取数由 VOP 硬件完成。注意 CPU 配的地址不一定是物理地址——启用 IOMMU 时设备访问的是 IOVA，DMA-BUF 导入还要经过映射和同步。

多图层示例：视频 Plane（NV12）+ OSD Plane（透明 UI/检测框），VOP 按坐标/层级/Alpha 合成。但**不是所有图层都能任意放置**——各窗口的格式、缩放范围、对齐、旋转、混合能力可能不同，DRM 通过 Plane 格式列表与 Atomic Check 暴露/限制。

**RV1126B 不能套 VOP2 的结论**：走传统 VOP 路径（`rockchip_drm_vop.c` / `rockchip_vop_reg.c` / `rockchip_drm_vop.h`），不要拿 `vop2` 的 RK3568/RK3588 窗口模型套。重点看 `vop_data`/`vop_win_data`、`rv1126b` 的 match data、窗口支持的 FourCC、scaler/CSC/alpha 能力、`vop_plane_atomic_check/update`、CRTC enable/disable 与中断。还有一条：**Plane 数量 ≠ 可独立显示的硬件窗口数**——支持 multi-area 的窗口会让多个 Plane 共享物理窗口资源。

VOP 不是什么：不是通用图像编辑器、不是 RGA（别假设任意旋转缩放转换都支持）、不是 DSI Host、不是 Panel。

## 三、RGA：处理图像，但输出仍要过 VOP

| 操作 | 用途 |
| --- | --- |
| Crop / Resize | 取矩形区域、改变宽高（电子放大、适配屏幕） |
| Rotate / Flip | 竖屏安装、方向修正、镜像预览 |
| CSC / Format Convert | YUV 与 RGB、像素格式互转 |
| Blend / Fill | UI 合成、背景填充 |

实际能力取决于 RV1126B 集成的 RGA 版本、驱动与用户态库版本——**不能仅凭「RGA 支持某操作」推断所有组合可用**。

两条路径的取舍（1080p NV12 → 800×480 屏为例）：**方案 A** 若 VOP 窗口支持该格式、缩放比例、stride、对齐，直接导入 DRM 由 VOP 缩放扫描；**方案 B** 若 VOP 不支持，先 RGA 处理成目标缓冲（如 RGB），再交给 VOP 扫描。**RGA 处理完成不等于屏幕已显示**。

「RGA 是不是零拷贝」要拆开问：CPU 是否 memcpy？RGA 是否读写源/目标缓冲？是否复用同一 DMA-BUF？是否仍有 DDR 读写流量？RGA 转格式通常至少读源写目标——**CPU 没拷贝，硬件照样读写**。合理分工是优先 VOP 原生能力，遇到限制再上 RGA，是否更快要实测带宽、负载和延迟。

另外 RGA 驱动**不在 DRM/VOP 目录**，先定位配置与设备树：`rg --files drivers | grep -i rga`、查 `CONFIG_VIDEO_ROCKCHIP_RGA`、设备树 `status`、probe 状态、librga/im2d 版本、缓冲对齐与 DMA 映射。

## 四、DSI：送数据，不生成图像

DSI 接收上游像素流或命令，按协议组织传输：**Host** 管协议层（包组织、Video/Command 模式、传输状态）；**D-PHY** 管物理层（Clock Lane、1~4 条 Data Lane、HS/LP 状态与时序）；**Panel** 自己初始化和显示控制。多条 Lane 是并行承载串行数据流，**不是「每条 Lane 一张图」**。

两种工作模式：**Video Mode** 按显示时序持续送像素（常见于持续刷新屏）；**Command Mode** 通过命令更新面板（面板带显存、可局部刷新，常配 TE 信号）。面板是否支持某模式必须查其手册。

驱动分层：`dw-mipi-dsi-rockchip.c`（SoC 适配、时钟/复位/PHY 配合）、`dw-mipi-dsi.c`（Synopsys Host 协议）、`phy-rockchip-inno-dsidphy.c`（D-PHY）、`panel-*.c`（面板初始化）。**点亮 DSI 屏不是只改一个节点**——Host、PHY、Panel、电源、复位、背光、时序、endpoint 全要对。

## 五、RGB：并行接口 ≠ RGB888 格式

三个词必须分开：**RGB 接口**（数据线 + PCLK + HSYNC/VSYNC + DE 的硬件信号）；**RGB888**（每像素 R/G/B 各 8 位的像素格式）；**DRM_FORMAT_XRGB8888**（内存排列的格式描述）。RGB 接口不代表内存是 RGB888——VOP 可以读别的受支持格式、内部处理后按输出配置生成 RGB 时序。

| 对比项 | RGB 并行 | MIPI DSI |
| --- | --- | --- |
| 传输 | 多根并行数据线 | 高速差分串行 Lane |
| 时钟 | PCLK | D-PHY Clock Lane |
| 组织 | 数据线 + 同步/使能 | DSI Packet、LP/HS 状态 |
| 布线 | 线多，控时序偏差 | 差分对，控阻抗与等长 |
| 应用 | RGB LCD、部分 MCU 屏 | 手机屏、MIPI LCD |

**不能笼统说 DSI 一定比 RGB 省电或画质好**——取决于分辨率、刷新率、Lane 数、像素格式、接口实现与面板。

## 六、三条典型路径

1. **NV12 直显**：CIF/ISP 写 DDR NV12 → DMA-BUF 导入 DRM → VOP Plane 取数合成 → DSI/RGB → Panel。不需要 RGA；是否真零 CPU 拷贝取决于能否直接导入扫描以及同步/格式/映射条件
2. **RGA 后显示**：RGA 做 NV12→RGB/Resize 写入目标缓冲，VOP 再扫描——有硬件读写流量
3. **视频 + OSD 多图层**：视频 Plane + ARGB8888 UI Plane 由 VOP 合成，**OSD 不必先由 CPU/RGA 合成整图**——但能否这么做以窗口能力表和 Plane 属性为准

## 七、带宽估算：多图层不是免费的

1080p60 单层理论读流量：RGB888 每帧 6,220,800 字节 → **约 373.25 MB/s**；NV12（1.5 字节/像素）→ **约 186.62 MB/s**。再加一层 ARGB8888 OSD，VOP 又要读约 **497.66 MB/s**。这还只是单层、无额外开销的理论值——实际还要算 stride 对齐、窗口数量、RGA 读写、CIF/ISP 写入、CPU/NPU/编码器争用、总线仲裁与缓存效率。**多图层直显避免了 CPU 合成，但 DDR 带宽成本并没有消失。**

## 八、源码地图与分层定位

DRM/VOP 阅读顺序：`rockchip_drm_drv.c`（主设备与组件组织）→ `rockchip_drm_vop.c`（Plane/CRTC、窗口更新、时钟中断）→ `rockchip_vop_reg.c`（各 SoC 寄存器与窗口能力）→ `rockchip_drm_gem.c`（显示缓冲内存管理）→ `drm_atomic_helper.c`（状态检查/提交/完成）。DSI/PHY/Panel/RGB 分目录如上；RGA 用检索法；DTS 重点看 `display_subsystem`、VOP ports、DSI/PHY/Panel 节点、`remote-endpoint`、时钟/reset/power-domain/IOMMU、pinctrl/regulator/reset GPIO/backlight。

| 现象 | 优先检查 | 不要一上来就 |
| --- | --- | --- |
| 没有 `/dev/dri/card0` | DRM 配置、VOP probe、component bind、DTS | 改 Panel 初始化命令 |
| 有节点无 Connector | 输出接口驱动、endpoint、Bridge/Panel attach | 认定 VOP 硬件坏 |
| 背光亮但黑屏 | VOP 提交、Plane 地址/格式、Mode、链路、初始化 | 只调亮度 |
| 颜色异常 | FourCC、RGB/BGR、YUV 顺序、CSC、总线格式 | 都归罪 DSI |
| 斜纹/错行 | pitch/stride、offset、格式、地址映射 | 先改刷新率 |
| RGA 完成但屏不更新 | 输出同步、FB 导入、Atomic Commit、VBlank/Flip | 认为 RGA 完成=显示完成 |
| 偶发撕裂/花屏 | 缓冲所有权、fence、DMA-BUF 同步、过早 QBUF | 让采集覆盖正在扫描的缓冲 |

## 写在最后

一句话记法：**RGA 把图像处理成需要的样子，VOP 从 DDR 取图并完成合成与扫描，DSI/RGB 把像素送到屏幕，Panel 负责最终显示。**

四条边界常被混淆：RGA 完成 ≠ VOP 已显示；DRM Atomic Commit 返回 ≠ 新帧已扫描；VOP 正在扫描的缓冲 ≠ 采集端可以立即覆盖；芯片支持某输出 ≠ 当前 PCB/DTS 已启用。

这篇与站内[《DRM/KMS 精读》](/posts/rk3588/drm-kms/)（框架对象）、[《NV12 到 RGB888》](/posts/linux/nv12-rgb-color/)（颜色通道）、[《零拷贝精读》](/posts/rk3588/zero-copy/)（缓冲共享）三篇合起来，RK 显示链路的框架、颜色、内存、硬件四层就齐了。

## 参考资料

- 原文：[RV1126B 显示硬件全景：VOP、RGA、DSI 与 RGB 各管什么？ — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/_AmG6xJzssqyifvJGn10GA)
- 原文基于 Rockchip 官方 `develop-6.1` 分支（RV1126B）源码与 DTS 核查
- 站内相关：[《Rockchip DRM/KMS 显示驱动精读》](/posts/rk3588/drm-kms/)、[《从 NV12 到 RGB888 精读》](/posts/linux/nv12-rgb-color/)、[《Rockchip 零拷贝技术精读》](/posts/rk3588/zero-copy/)
