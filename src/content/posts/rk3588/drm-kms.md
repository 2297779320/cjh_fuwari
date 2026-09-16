---
title: Rockchip DRM/KMS 显示驱动精读
published: 2026-09-16
description: '精读 txp《Rockchip 平台 DRM/KMS 显示驱动入门教程》：从像素到屏幕的完整链路、DRM 核心对象、Atomic KMS 原理、设备树点屏移植七层路线与调试诊断方法。'
image: 'https://www.loliapi.com/bg/'
tags: [DRM, KMS, Rockchip, linux, 驱动]
category: '瑞芯微'
draft: false
lang: 'zh-CN'
---

前阵子精读了 txp 的 V4L2 驱动对象模型一文（见[上篇笔记](/posts/linux/v4l2-driver-model/)），这次是他的续作——Rockchip 平台 DRM/KMS 显示驱动入门教程。原文五篇三十六节，依据六份 Rockchip 官方开发指南写成，从显示链路一路讲到点屏调试。这篇笔记覆盖全部五篇的骨架，观点归原作者，原文链接见文末。

## 一、总架构：从像素到屏幕

显示链路分五个阶段：**图像生产**（CPU/GPU/RGA/解码器生成 RGB/YUV）→ **内存承载**（DDR Buffer，线性或 AFBC 压缩布局）→ **扫描合成**（VOP/VOP2 按 Pixel Clock 持续读取图层，做缩放、Alpha 合成、CSC、HDR）→ **协议输出**（HDMI/DP/eDP/DSI/LVDS/RGB 控制器把像素流转成协议）→ **电气传输**（PHY 出信号，屏端还原图像）。

调试时必须区分两条路径：**数据面**是像素流经的硬件路径，**控制面**是 Mode、Property、时钟、电源、GPIO、HPD、EDID、Atomic 状态这些"幕后开关"。点屏踩坑最常见的误区是只查数据面——背光亮了、D-PHY 有波形，却栽在 CRTC Mode 或 Panel 上电时序上。另一对要分清的角色是图像生产模块（可突发执行）和 VOP（必须按节拍连续扫描），两者之间靠 Fence 同步，VOP 的 FIFO 取不到数据就会下溢、出横条。

DRM 子系统三大职责：

| 子系统 | 职责 | Rockchip 对应 |
| --- | --- | --- |
| KMS | 模式设置、扫描输出、Atomic 提交 | VOP/VOP2、VP、显示接口 |
| GEM | Buffer 分配、映射、生命周期 | Rockchip GEM、IOMMU、CMA |
| PRIME | 跨驱动 Buffer 共享 | DMA-BUF 导入导出、零拷贝显示 |

### 核心对象

- **`drm_device`**：完整 DRM 设备的根，聚合 Mode Config、CRTC/Plane/Encoder/Connector 列表。用户态表现为 `/dev/dri/cardX`——编号随驱动加载顺序变化，不能写死，可靠做法是 `drmOpen("rockchip")` 或用 `drmIsKMS()` 过滤
- **CRTC**：一条独立扫描输出流水线的抽象。Rockchip 映射：VOP 1.0（RK3288/RK3399）是一个 VOP 对应一条 CRTC；VOP 2.0（RK3588）是一个 **Video Port（VP）** 对应一条——所以 VP0~VP3 是四条扫描通道，不是四个完整 VOP
- **Plane**：可被扫描合成的图层，分 Primary（主画面）/ Overlay（视频、OSD）/ Cursor。关键属性两套坐标：`SRC_*`（16.16 定点，位于 Framebuffer）和 `CRTC_*`（整数像素，位于屏幕），尺寸不同即触发硬件缩放
- **Framebuffer**：不是"一块内存"，而是对可扫描图像布局的完整描述——宽高、FourCC 格式、每个内存 Plane 的 GEM Handle、Pitch、Offset、Modifier。NV12 有 Y/UV 两个 Plane，Pitch 或 Offset 错了会错行、偏色甚至 IOMMU fault
- **Encoder / Connector / Bridge / Panel**：Encoder 是接口编码过程的逻辑对象；Connector 是链路终点连接关系（承载连接状态、Mode 列表、EDID、DPMS）；Bridge 描述中间的转换芯片（如 DSI 转 HDMI）；Panel 抽象屏端本体（电源、复位、prepare/enable/disable/unprepare 时序、固定 Timing）
- **GEM / PRIME**：视频零拷贝的路径是解码器导出 DMA-BUF FD → `drmPrimeFDToHandle()` → `drmModeAddFB2WithModifiers()` → Overlay Plane 提交 → VOP 直接扫描同一块内存

对象间还有三个"掩码"约束硬件路由（如 `possible_crtcs`）：某 Connector 始终绑不上某个 VP 时，先查掩码和 SoC 显示通路表，再怀疑代码。

VOP 1.0 和 2.0 的本质差异：前者靠多个独立 VOP 实现多屏（资源关系直观、共享能力弱），后者是统一 VOP 内部维护一个 **Window（图层硬件单元）资源池**，按策略分配给多个 VP（受路由矩阵、带宽、AFBC 支持等共享约束）。DRM 映射关系记一句：**Window → Plane，VP → CRTC**。

## 二、显示原理与 Atomic KMS

### 扫描时序：点屏的第一性原理

接口传输的不只是有效像素，每行每帧都带同步和消隐区间：

```text
htotal = hsync_len + hback_porch + hactive + hfront_porch
vtotal = vsync_len + vback_porch + vactive + vfront_porch
fps ≈ pixel_clock / (htotal × vtotal)
```

1080p@60 的 CEA 标准时序即 148.5MHz ÷ (2200 × 1125) = 60Hz。设备树里的 `hsync-active`/`vsync-active`/`de-active`/`pixelclk-active` 决定极性和采样边沿——极性错了可能完全无图、画面滚动或颜色抖动。

### 带宽：Mode 正确也可能花屏

理论读带宽 `宽 × 高 × 帧率 × 每像素字节数`，1080p60 XRGB8888 就有约 498 MB/s；多 Plane 叠加、缩放、DDR 竞争还要往上加。接口侧同样有账：DP/eDP 要求有效视频带宽小于 Lane 数 × Link Rate × 编码效率。Pixel Clock 不等于 Lane Rate。

### 合成与颜色

"图层存在但看不见"常见原因是 zpos、Alpha（全局/每像素、预乘与否）、目标坐标或 FB_ID 配错。颜色发灰、黑位抬高多半不是屏的锅，而是 CSC 配置不一致——BT.601/709/2020、Full/Limited Range 要两端对齐。

### Atomic KMS：为什么需要 check 和 commit 两阶段

Legacy KMS（`drmModeSetCrtc/SetPlane/PageFlip`）分步修改多个对象，中间态可能短暂不一致。Atomic 把所有对象的新状态（Connector 的 CRTC_ID、CRTC 的 MODE_ID/ACTIVE、Plane 的 FB_ID/坐标等）**一次性复制成候选状态**，先跑 `atomic_check`（校验路由、带宽、缩放、共享资源，VOP2 在此阶段做 Plane 分配），再按序 commit（等 Fence → 关旧路径 → 配时钟 PHY → 配 Mode → 配 Plane → 安全时刻生效 → 发 VBlank 事件）。

两个实用标志：`TEST_ONLY` 只校验不改硬件，是定位 EINVAL 的利器；`NONBLOCK` 异步提交要配合 `PAGE_FLIP_EVENT` 处理，否则 Buffer 回收和帧节奏会失控。Page Flip 在 VBlank 消隐期切换 Buffer，避免上下半屏新旧帧撕裂。

## 三、Rockchip 驱动与设备树

### 源码阅读地图

推荐顺序：`rockchip_drm_drv.c`（主设备、component 绑定）→ `rockchip_drm_vop2.c`/`rockchip_drm_vop.c`（CRTC/Plane/Atomic）→ 各接口驱动（HDMI/DP/eDP/DSI/LVDS）→ `panel-simple.c` → Bridge → `rockchip_drm_gem.c`（内存与 IOMMU）→ Binding YAML 与板级 DTS。

### Component Framework 与 -EPROBE_DEFER

Rockchip DRM 由多个组件（VOP、接口、PHY、Bridge、Panel）共同绑定初始化。启动早期看到 `Failed to find panel or bridge: -517` **不是最终故障**——它只是依赖未就绪、稍后重试。判断是否收敛：看后续是否成功 bind、`/dev/dri/cardX` 是否出现；始终不收敛才去查 compatible、remote-endpoint、regulator/GPIO 或依赖驱动是否编进内核。

### 设备树 Graph

显示通路用 `port`/`endpoint`/`remote-endpoint` 描述拓扑，**两端必须互相引用**——只配一端会导致 Graph 遍历失败、Panel 找不到。Panel 驱动遵循 prepare（上电释放复位）→ enable → disable → unprepare（断电拉复位）状态机，`panel-simple` 的各级 delay-ms 要按屏规格书填，不能抄模板。背光在视频稳定后才开、下电时先关，避免白闪残影。

各接口的调试抓手差异很大：HDMI 盯 EDID/HPD/SCDC；DP/eDP 盯 AUX/DPCD/Link Training；DSI 盯 Lane Rate/初始化命令/TE；LVDS 盯 Bus Format（JEIDA/VESA 映射、单双通道、奇偶像素——dual channel 两路顺序接反会锯齿交错，优先交换 odd/even 属性而不是改 Timing）；RGB 反而最依赖电气基础：Pinmux、极性、采样边沿、驱动强度。

## 四、点屏移植与实验

点屏 Bring-up 的**七层路线**（逐层递进，每层拿到证据再往上走）：

1. **硬件静态检查**：电压、复位电平、HPD 是否浮空、差分对 P/N 与 Lane 顺序、Pinmux 与原理图一致性、屏线方向
2. **驱动加载**：`dmesg` 里确认 VOP/接口/Panel bind 成功、-517 收敛、cardX 出现
3. **对象与路径**：`modetest -M rockchip` + debugfs 的 `summary`/`state`，确认 Connector 状态、Mode 列表、possible_crtcs、Primary Plane 分配
4. **Mode/Clock 校验**：时序参数、DCLK 是否落在要求
5. **自测图案**：VP 彩条排除 Buffer 来源问题
6. **最小 KMS 输出**：先 `modetest` 出彩条，再上复杂图形系统——避免 compositor、GPU、视频栈同时引入变量
7. **稳定性验证**：长时间运行、休眠唤醒、热插拔

三个递进实验：

- **枚举 DRM 资源**：libdrm 打开设备（`drmOpen` + `drmIsKMS` 过滤）→ `drmModeGetResources` → 遍历 Connector 打印状态和 Mode 列表
- **Dumb Buffer 纯色画面**：CREATE_DUMB → AddFB2 → mmap 填色 → `drmModeSetCrtc`。绕过 GPU 和 compositor，直接验证从 Buffer 到屏幕的整条数据面
- **Overlay Plane + DMA-BUF**：验证零拷贝显示路径，视频帧不经过 CPU 拷贝直接上屏

## 五、调试方法与故障定位

debugfs 工具箱（需 `CONFIG_DEBUG_FS=y`）：

```bash
mount -t debugfs none /sys/kernel/debug
cat /sys/kernel/debug/dri/0/summary        # VP/CRTC/Connector/Mode/Plane 一览
cat /sys/kernel/debug/dri/0/state          # 完整对象状态
echo 1 > /sys/kernel/debug/dri/0/video_port0/color_bar   # VP 自测彩条
cat /sys/kernel/debug/clk/clk_summary | grep -Ei 'vop|dclk'   # 时钟树
cat /sys/class/drm/card0-HDMI-A-1/edid | edid-decode          # EDID 解析
dmesg | grep -Ei 'iommu|page fault|vop|drm'                   # IOMMU 故障
```

**屏幕不亮的诊断树**：先分背光不亮还是背光亮但无图。前者查 PWM 输出、Enable GPIO、背光电源、极性、亮度表和 Panel 时序；后者沿数据面逐级验证——Connector 状态 → Mode → CRTC ACTIVE → Plane FB_ID → VP 彩条（彩条出得来说明 VOP 正常，问题在 Buffer/应用侧）→ 接口控制器 → PHY → 屏端 Timing。HDMI/DP 报 disconnected 则查 HPD 电平、DDC/AUX、线缆和 Sink 电源；Mode 列表为空多半是 EDID 读取失败、Panel 没配固定 Timing 或 Clock 超限被 `mode_valid` 拒绝。

画面异常对症下药：整体错位查消隐参数和极性；黑白偏色查 RGB/BGR、Bus Format、CSC 和量化范围；GEM 分配失败查 CMA 容量、Buffer 数量、内存碎片和 IOMMU 开关。休眠唤醒要严格按"停提交 → 关背光 → 关流 → 关接口 PHY → 存状态 → 恢复时钟电源 → 重训练 → 恢复 Mode/Plane → 开背光"的顺序，顺序错了就是唤醒黑屏或 Link Training 失败。

## 写在最后

原文给的学习自检清单很实用，抄几条作为收尾标准：能说清一帧图像从 DDR 到屏幕经过哪些硬件模块、VP/CRTC/Plane/Window 如何对应、Framebuffer 为什么不只是块内存、Atomic 为什么必须 check 加 commit、屏幕不亮时如何定位故障在 Buffer 还是 VOP 还是 PHY 还是屏端。能全答上来，DRM/KMS 的入门就算过关。

结合上一篇的体会：V4L2 和 DRM 这两个子系统套路相通——都是"一组标准对象 + 注册时机 + 用户态入口"的模型，把对象职责和边界先建立起来，再去读平台代码，效率完全不一样。

## 参考资料

- 原文：[Rockchip 平台 DRM/KMS 显示驱动入门教程 — txp@飞一样的成长（微信公众号）](https://mp.weixin.qq.com/s/dAtjyZX9UeO0DmW3TKsjCQ)
- 姊妹篇笔记：[《V4L2 驱动对象模型精读》](/posts/linux/v4l2-driver-model/)
- 站内相关：[《rk3588使用》](/posts/rk3588/rk3588/)（RK MPP 媒体处理）
