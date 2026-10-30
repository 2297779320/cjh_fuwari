---
title: Voltip 项目精读：跨四端的语音听写工具是怎么搭的
published: 2026-10-08
description: '精读开源项目 sunerpy/voltip：Tauri 双壳 + Rust 核心的分层与依赖纪律、trait 端口化、单契约 UI 状态流、文本注入的平台差异、三条降级链，以及可迁移的工程借鉴点。'
image: 'https://www.loliapi.com/bg/'
tags: [Rust, Tauri, 语音识别, 开源项目]
category: 'AI'
draft: false
lang: 'zh-CN'
---

这篇不是公众号精读——是直接读 GitHub 开源项目 [sunerpy/voltip](https://github.com/sunerpy/voltip) 的源码文档后整理的笔记。它是最近少有的一类项目：**一个把"按住热键说话、松开即输入"做到产品级的跨平台听写应用**——Windows、macOS、Linux、Android 四端，Rust 核心 + Tauri 双壳，端侧推理跑 Qwen3-ASR 这类本地模型，还能让手机通过加密通道变成电脑的麦克风和键盘。

按之前的习惯，功能只占一节（压缩版），重心放在它**怎么搭**：分层、边界、降级策略。AGPL-3.0（0.0.20 及更早是 Apache 2.0），项目处于活跃开发期，文档相当扎实——`docs/` 里有 architecture、dictation、pairing、protocol、threat-model、acceptance 六份设计文档，这篇的素材全部出自它们在仓库中的公开版本。

## 一、功能全景（压缩版）

- **输入方式**：全局热键 `Ctrl+Alt+Space`，支持按住说话 / 按一下开始再按停止 / 短按锁定长说三种激活方式，悬浮胶囊实时显示音量、转写和结果
- **三路识别**：内置默认服务（开箱即用）／云端 8+ 家（OpenAI、Groq、SiliconFlow、阿里云百炼实时模型、任意 OpenAI 兼容端点）／端侧本地模型（Qwen3-ASR 0.6B/1.7B 走 transcribe.cpp，SenseVoice 与 Paraformer 走 sherpa-onnx；有 GPU 走 Vulkan/Metal，否则 CPU）
- **文本加工**：LLM 润色（含 Google AI Studio、DeepSeek、Kimi、GLM、火山方舟、混元、MiMo、OpenRouter、本地 Ollama）、个人词典纠正识别错词、字面/正则替换规则、简繁转换
- **语音编辑**：选中文字后按住 `Ctrl+Alt+E` 说"改正式一点 / 翻译成英文"，改写结果替换选区
- **Scenes**：开始听写时报前台应用决定润色风格、输出方式、语言和附加指令
- **长录音**：麦克风、系统声音或两者混音，单次最长两小时，边说边分段转写；导出 SRT 字幕或纯文本
- **手机当外设**：扫码或 6 位码配对 Android 手机，手机端按住说话走端到端加密 + Opus 压缩，电脑端光标处出字；手机离线时自己也能识别润色
- **协议能力**：本地 OpenAI 兼容 `/v1/audio/transcriptions`，供其他程序复用它的识别、词典与预设；还能一条命令在自建 NVIDIA GPU 服务器上部署 vLLM + Qwen3-ASR

## 二、架构：目录结构就是依赖图

```text
apps/desktop      Tauri 2 壳（Win/macOS/Linux）+ 悬浮胶囊窗口
apps/mobile       Tauri 2 壳（Android），同一套 React 前端
apps/server       无头 voltip-server（Linux x64），只有命令行
packages/ui       设计系统（六套主题令牌 + 原子组件）
packages/shared   TS 侧协议类型 / IPC 契约（镜像 Rust 的 serde 输出）

crates/voltip-protocol    版本化线协议（tagged enum、CBOR/JSON、PairingTicket）
crates/voltip-crypto      Noise_XX_25519_ChaChaPoly_SHA256 + Safety Code
crates/voltip-identity    长期设备身份、SecretStore trait（keyring/内存/加密文件）
crates/voltip-pairing     配对状态机（sans-IO：会话、二维码票据、6 位短码）
crates/voltip-transport   连接状态机、重连、WebSocket、SecureChannel
crates/voltip-relay      可选的中继服务（只转发密文）
crates/voltip-core        外观层：identity+pairing+transport+trusted store → CoreCommand/CoreEvent
crates/voltip-audio       cpal 采集（WASAPI/CoreAudio/ALSA/AAudio），DSP 可脱离硬件测试
crates/voltip-cloud       云端识别与润色客户端
crates/voltip-serve       本机 OpenAI 兼容服务的 HTTP 层
crates/voltip-net         代理（系统/不使用/手动，HTTP CONNECT、SOCKS5）
crates/voltip-reply       解析各服务商错误体（遮盖密钥后展示）
crates/voltip-tauri-bridge webview 看到的唯一契约（UiCommand/UiEvent/UiState）
```

真正值得学的是那条纪律：**依赖方向只允许向下**——`apps → core → {pairing, transport, identity} → {crypto, protocol}`；`voltip-net` 和 `voltip-reply` 在最底层，谁都不依赖；最妙的一笔是 **relay 只依赖 protocol、不依赖 crypto**——中继服务在代码结构上就拿不到会话密钥，"中继看不到内容"不是承诺，是类型系统保证的。

## 三、三个关键设计

### 1. trait 端口化：核心不依赖任何具体实现

`voltip-core` 只依赖 `AudioSource`、`Capture`、`Transcriber`、`StreamingTranscriber`、`Refiner`、`Injector`、`ModelManager` 这些 trait（ports），**不依赖 cpal、reqwest、enigo、sherpa**——真实实现由桌面壳注入，测试用假实现（`FakeAudio`/`FakeStreaming`/`FakeModels`）驱动完整状态机。

这带来的直接好处：听写状态机（Idle → Listening → Processing → Done/Failed/Cancelled）可以在没有麦克风、没有网络、没有模型的 CI 里全链路测。对照站内[《回调与钩子精读》](/posts/RT/callback-vs-hook/)里"驱动只依赖约定、不依赖实现"的原则，这是同一思想在应用层的放大版。

### 2. 原生优先 + 单一契约来源

- **系统能力全在 Rust**：全局热键、音频设备、文本注入、窗口管理、剪贴板——webview 只渲染和收集输入。浏览器 API（getUserMedia 等）只允许作为降级
- **Rust→webview 按语义选通道**：离散状态变化走事件总线并折叠进 `UiState`；连续流（音频电平 30Hz、识别流）走 `tauri::ipc::Channel`，随 command 生命周期结束；一次性查询走 command 返回值。**事件总线不承载 30Hz 以上的数据**
- **壳自产的状态也并入同一条流**：热键注册结果这类 shell 自己产生的状态经 `Bridge::publish` 进 `UiState`——webview 永远不维护第二份真相

### 3. 安全边界写进构建流程

- 服务商密钥只进系统钥匙串（Windows Credential Manager / macOS Keychain / Secret Service / Android Keystore），界面只见 `SecretState`，且有回归测试 `regression_keys_never_leave_their_provider`
- 内置服务的 URL/Token 编译期用 `option_env!` 注入，源码里不出现主机名；CI 扫描整棵树，打包时扫描 `sk-…`/`gsk_…` **拒绝出包**
- 配对走 Noise XX 握手 + 两端对比 Safety Code，中继只转发端到端加密字节

## 四、听写管线与平台差异

一句话流水线：**按住热键 → Rust 录音 → 松开 → 识别 → 词典纠正 → 可选 LLM 润色 → 替换规则 → 剪贴板 + 粘贴键注入前台应用 → 历史落盘 → 胶囊显示结果**。

最见功力的是**注入环节的平台差异**：

| 平台 | 关键处理 |
| --- | --- |
| Windows | 先找 Z 序中 Voltip 下方的第一个普通窗口激活，再最小化自己；前台落回 WebView 自己就再抢一次；错误码细分 `secure_input` / `elevated_target`（UIPI 阻断） |
| macOS | 隐藏整个应用；`window` 用前台进程 pid（承认分不清同一应用的两个窗口）；未授权辅助功能返回 `no_permission` 并给跳转入口 |
| Linux | 纯 Wayland 探测不了前台 → **立即只复制**（`no_probe`）；缺粘贴工具 / 连不上显示服务各有错误码 |

还有一条容易忽略的保护：**注入前再查一次前台**，应用变了（`target_changed`）就只复制不粘贴——宁可让用户按一次粘贴，也不把内容打进错误的窗口。

## 五、三条降级链

失败处理遵循一个明确原则：**只在明确信号下切换，其余只降级不阻断**。

1. **流式 → 整段**：WebSocket 出错就改走整段识别，`Done.live_error` 记录原因
2. **润色失败 → 原文**：用 ASR 原文注入，界面标"· 未润色"，失败原因分类七种
3. **候补模型只在额度用完时切换**（`AllocationQuota.FreeTierOnly` / `insufficient_quota`）——限流、网络错误、缺模型、无权限**都不切换**。这是用户明确要的：随意切换会造成不可预期的成本跳变。额度用尽的模型进 `QuotaLedger`，24 小时后再试

另外两个边界值：空录音（<300ms 或全静音）直接 `Failed{NoSpeech}`，**不上传**；上传体积限制 10MB。

## 六、两个有数据支撑的决策

**① 上传用 Ogg Opus 而不是 WAV**（dictation §3.9）。37.7 秒语音从 1.2MB 压到约 98KB；跨境弱网下 WAV 的拥塞窗口会塌到 45KB/s，慢请求从 3/16 降到 0/16。作者还测了编码复杂度：降到 5 时字符差异从 0.5% 涨到 1.3%，所以维持 9。**这是产品级决策的完整闭环：指标 → 实测 → 参数回退**。

**② 节时系数 1.9×**（引 Ruan 等 2016，arXiv:1608.07323）：语音输入比键盘快约 2.9 倍，作者按保守值折算成"节省时间"挂到产品叙事里——工程文档里出现引文，说明作者在不靠感觉说话。

## 七、工程质量：把"测得过"写进门槛

- **三端覆盖率门均 ≥90%**：Rust `cargo llvm-cov`、TS `vitest --coverage`、RN `jest --coverage`，各自排除启动胶水后按行/分支/函数/语句四项卡
- **契约夹具由实现生成**：`packages/shared/src/fixtures/ipc/*.json` 由 Rust 的契约测试产出，TS 侧用 zod 校验——类型镜像不是手抄的，是产出的
- **`docs/acceptance.md` 把每个功能映射到代码与测试**——功能清单不是宣传语，是验收表
- **改契约先改文档**：文档是单一事实源，代码向它对齐

## 写在最后

读下来有三条可以直接搬回自己项目的东西：

1. **ports + 假实现**：核心只依赖 trait，把"没有硬件也能测完整状态机"变成常态
2. **单一契约来源**：前端不维护第二份真相（`Bridge::publish` 那个设计），跨壳复用才不至于分叉
3. **降级只在明确信号下发生**：其余情况宁可降级不阻断——这条对任何有外部依赖的服务端/端侧系统都适用

对照站内：[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)里"依赖方向只允许向下"的分层纪律、[《CMake 交叉编译》](/posts/RT/cmake-cross-compile/)里的构建收敛，都是同一种工程审美的不同侧面——**把边界写在结构里，而不是写在注释里**。

## 参考资料

- 仓库：[sunerpy/voltip](https://github.com/sunerpy/voltip)（AGPL-3.0-or-later）
- 设计文档（仓库内）：`docs/architecture.md`、`docs/dictation.md`、`docs/pairing.md`、`docs/protocol.md`、`docs/threat-model.md`、`docs/acceptance.md`
- 用户手册：[voltip.firlab.app](https://voltip.firlab.app)
