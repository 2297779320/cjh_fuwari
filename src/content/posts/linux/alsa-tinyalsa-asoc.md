---
title: ALSA/TinyALSA 与内核音频驱动精读
published: 2026-09-17
description: '精读深研集《ALSA/TinyALSA 与内核音频驱动》：Android 音频栈的最后一公里，ALSA 架构、TinyALSA 选型逻辑、ASoC 三层模型、DAPM 声明式电源管理与两个实战排障案例。'
image: 'https://www.loliapi.com/bg/'
tags: [ALSA, ASoC, DAPM, TinyALSA, linux, 驱动]
category: '音频开发'
draft: false
lang: 'zh-CN'
---

站里那篇[《音频开发》](/posts/linux/alsa/)记的是 ALSA-lib 用户态的基础用法，这篇往下走一层——精读深研集的《ALSA/TinyALSA 与内核音频驱动》，把"PCM 数据交给硬件"这个动作在内核里的最后一公里拆开看：ASoC 三层模型、DAPM 声明式电源管理、DMA 环形缓冲，外加两个实战排障案例。观点归原作者，原文见文末。

## 先分清两个世界：桌面 Linux 与 Android

桌面 Linux 的音频栈上头还有 PulseAudio/PipeWire 做用户态混音，应用经 ALSA-lib 的插件间接访问硬件。Android 把中间层全砍了：AudioFlinger 在框架层做完混音，直接通过一个极简用户态库操作内核 ALSA 接口——这个库就是 TinyALSA。

## TinyALSA vs ALSA-lib：8 万行 vs 3 千行

为什么 Android 不用现成的 ALSA-lib？答案在代码量里。ALSA-lib 超过 8 万行，插件体系（dmix、softvol、pulse 插件）、配置解析器一应俱全——这些是桌面多应用共享声卡的产物。但 Android 只有一个 HAL 流写设备，AudioFlinger 已经混完音了，插件体系反而成了累赘。

作者的实测很能说明问题：试图用 ALSA-lib 替代 TinyALSA 借 softvol 做音量控制，结果仅解析 `/usr/share/alsa/` 下的配置文件就花了 200ms，Android cold boot 路径上完全不可接受。还有一条常被忽视的理由：TinyALSA 是 Apache 2.0，ALSA-lib 是 LGPL——对不想开源的 OEM HAL 更友好。

TinyALSA 的设计哲学是**直接封装 ioctl，不做任何抽象**：约 3000 行 C，无配置文件、无插件、无线程。`pcm_write()` 的核心就是一个 `ioctl(SNDRV_PCM_IOCTL_WRITEI_FRAMES)`。

API 极其直觉，核心三类操作：

```c
struct pcm_config config = {
    .channels = 2,
    .rate = 48000,
    .period_size = 1024,   /* 每次传输的帧数 */
    .period_count = 4,     /* ring buffer 含几个 period */
    .format = PCM_FORMAT_S16_LE,
};
struct pcm *pcm = pcm_open(card, device, PCM_OUT, &config);
pcm_write(pcm, buffer, size);
```

Mixer 同样简洁：`mixer_open(card)` → `mixer_get_ctl_by_name(mixer, "Speaker Volume")` → `mixer_ctl_set_value()`。这些控件名是内核 Codec 驱动注册的。调试利器：adb shell 里用 `tinymix` 直接查看和修改所有控件，绕过 HAL 快速验证 mixer 问题。

`period_size` 的权衡值得记住：越小延迟越低但 CPU 唤醒越频繁。Android FastMixer 路径用 192（4ms @48kHz），普通路径用 1024（约 21ms）。

## ASoC 三层模型：一个依赖注入框架

嵌入式 SoC 的音频硬件散落在多个 IP 模块：CPU 侧 I2S 控制器、外挂 Codec 芯片、DMA 引擎。ASoC 用三层解耦：

- **Machine Driver**：只描述连接关系——哪个 CPU DAI 接哪个 Codec、I2S/TDM 格式、主从谁说了算。代码最少，出问题最多
- **Platform Driver**：DMA 引擎 + CPU DAI 控制器
- **Codec Driver**：最复杂。一颗 Codec 200+ 寄存器（DAC/ADC/PGA/Mixer/EQ/路由矩阵），要映射成 mixer 控件和 DAPM widget

价值在量产：同一颗 SoC 配不同 Codec 的几十种组合，Platform 和 Codec 驱动各写一次，Machine 几十行描述绑定即可。代价是调试复杂度——音频不出声时，三层任何一层都可能是嫌疑人。

## DAPM：被低估的声明式电源管理

Codec 里几十个模拟模块（DAC、PGA、Mixer、Speaker Amp），不用时应关掉省电，但手写上下电时序太复杂。DAPM 的方案是**声明式**：开发者只描述 widget（音频处理单元）之间的 route（连接），框架自动推断谁该开谁该关。

核心概念四件套：Widget（单元）、Route（source→sink 连接）、Path（完整链路）、Endpoint（路径终点，如 Speaker/Mic）。用户空间打开一个 mixer 开关时，DAPM 从 endpoint 向上游图遍历，按拓扑排序逐个上电。

两个精妙之处：

- **不粗暴关电**：DAC 同时连 Speaker 和 Headphone 时，关 Speaker 不会动 Headphone 正在用的 DAC——框架会检查其他活跃路径
- **上电时序自动推断**：模拟电路有严格顺序（先 VMID 偏置、再 PGA、最后 DAC 输出），DAPM 按 widget type（SUPPLY/DAC/PGA 等）自动排对，开发者不用手写时序

## DMA 环形缓冲：速率转换器

48kHz/16bit/双声道每帧仅 4 字节但每秒 48000 帧，CPU 逐帧喂 FIFO 意味着每 20.8 微秒响应一次——中断和调度延迟随便哪个都能造成 underrun。DMA 的方案是批量：CPU 准备好一个 period，让 DMA 自己按 I2S 节奏匀速喂。

ring buffer 的设计：period_count=4 给了 3 个 period 的调度余量（约 64ms），足以吸收 HAL 线程被延迟一个 period 的抖动；2 个是理论最小值但容错太薄。Android 按场景分层配置：

| 路径 | period_size | period_count | 延迟 | 场景 |
| --- | --- | --- | --- | --- |
| DEEP_BUFFER | 1920 | 4 | 160ms | 音乐（省电优先） |
| LOW_LATENCY | 192 | 4 | 16ms | 游戏音效 |
| MMAP | 192 | 2 | 8ms | 专业音频（AAudio） |
| VOICE | 160 | 2 | 20ms | 通话（8kHz） |

一个容易忽略的点：ring buffer 必须是 DMA coherent 的（`dma_alloc_coherent()` 或 uncached）——DMA 直接读物理地址不走 CPU cache，普通 cached 内存会让 DMA 读到 L1 里的旧数据。

## PCM 设备节点：一条 DAI link 一个 device

`/dev/snd/` 下 `pcmC0D0p` 的命名规则是 `pcmC{card}D{device}{p|c}`。常见误解：一个 PCM device 对应一个物理输出——**不是**。它对应 Machine driver 里的一条 DAI link（CPU DAI ↔ Codec DAI 的绑定）；同一物理输出可被多个 PCM device 经 Codec 内部 mixer 共享。用 `tinypcminfo` 可查看每个 device 支持的参数范围（由 Platform driver 的 `snd_pcm_hardware` 定义），超范围 `pcm_open` 直接返回 `-EINVAL`。

## 实战案例一：通话无声

现象：媒体播放正常，通话时对端听不到。排查两步：`tinypcminfo` 确认通话 PCM device 存在且参数正常 → `tinymix contents` 发现 `AIF1 Capture` 这个 DAPM switch 是 Off。

根因在 Machine driver：通话 DAI link 只定义了 playback stream name，没有 capture 的。ASoC 靠 stream name 匹配 Codec 侧 DAPM widget 来建立路径，名字对不上 DAPM 就**静默地不使能路径**——没有编译期检查，也没有明确报错。修复就是补全 capture stream name。这个案例暴露了 ASoC 的隐式约定风险：约定靠字符串精确匹配，错了无声无息。

## 实战案例二：周期性 pop 声

现象：播放音乐每隔几秒一声"啪"。`tinycap` 抓 PCM 发现每个 period 尾部几帧异常——DMA burst 一次 16 word，但 I2S TX FIFO 只有 8 word 深，FIFO 满了 DMA 还在写，溢出丢数据。

修复：Platform driver 里把 burst length 限制为 FIFO 深度的一半（`maxburst = fifo_depth / 2`）。教训：DMA 和 I2S 分属两个硬件模块，经 FIFO 耦合，内核不会自动检查两边配置的一致性——Platform driver 开发者必须自己知道目标控制器的 FIFO 深度并显式约束。

## I2S 与 TDM

I2S 是基础数字音频接口（BCLK + LRCK + Data，最多 2 声道）；TDM 用时分复用在同一根 Data 线上跑 4/8/16 声道，多麦克风阵列场景常用。驱动层面共享同一个 CPU DAI，区别只在寄存器配置（slot 数/宽度/映射）。常见的坑：配了 TDM 8 声道但 BCLK 不够——**BCLK = 采样率 × slot 数 × slot 宽度**，算不够就数据溢出。

## 源码导航

| 模块 | 内核路径 | 关键文件 |
| --- | --- | --- |
| ASoC Core | `sound/soc/` | `soc-core.c`、`soc-pcm.c` |
| DAPM 框架 | `sound/soc/` | `soc-dapm.c`（~4000 行，最值得读） |
| Platform 示例 | `sound/soc/rockchip/` | `rockchip_i2s.c` |
| Codec 示例 | `sound/soc/codecs/` | `wm8994.c` |
| Machine 示例 | `sound/soc/samsung/` | `snow.c`（简单清晰） |

调试最有用的开关是 dynamic debug——打开后每次 DAPM 上下电都会在 dmesg 里输出哪些 widget 被激活/关闭及触发原因，比 `tinymix` 看静态状态更能理解动态行为：

```bash
echo 'file soc-dapm.c +p' > /sys/kernel/debug/dynamic_debug/control
```

## 写在最后

这条链路上每一层都在做减法：AudioFlinger 混音完给 HAL 干净的 PCM buffer，HAL 经 TinyALSA 写入内核 ring buffer，DMA 按节奏搬运，I2S 推到 Codec。作者对 DAPM 的评价我很有共鸣——声明式设计让驱动开发者只说"我有哪些模块、怎么连接"，框架自动推断最优电源状态，这在 Linux 内核子系统里是做得最好的之一。

对照站内音频相关的内容：[《音频对讲精读》](/posts/audio/intercom/)里的 ALSA 参数调优（period/buffer/XRUN）正是本文 ring buffer 设计的应用侧；[《音频开发》](/posts/linux/alsa/)则是 ALSA-lib 用户态入口。三篇凑齐从用户态到内核的音频链路。

## 参考资料

- 原文：[ALSA/TinyALSA 与内核音频驱动 — 深研集（微信公众号）](https://mp.weixin.qq.com/s/sldtYIDYLgyAU5-Qc6PDSA)
- 原文引用的一手信源：[kernel.org ALSA 文档](https://www.kernel.org/doc/html/latest/sound/index.html)、[ASoC 设计文档](https://www.kernel.org/doc/html/latest/sound/soc/index.html)、[TinyALSA 仓库](https://github.com/tinyalsa/tinyalsa)
- 站内相关：[《音频开发》](/posts/linux/alsa/)、[《嵌入式音频对讲技术精读》](/posts/audio/intercom/)
