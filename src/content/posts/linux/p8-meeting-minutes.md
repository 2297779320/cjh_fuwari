---
title: SOPHGO CV84x6 上的 LLM 应用：P8 会议纪要复盘
published: 2026-11-25
description: '从 morphedge 的 P8 会议纪要出发，复盘 CV84x6 边缘芯片上跑 LLM 应用的真实工程账：LLM-TPU bmodel、单路重资源与模型切换、与 ASR 抢 NPU 的串行化、HTTPS 单入口与落盘依赖。'
image: 'https://www.loliapi.com/bg/'
tags: [SOPHGO, CV84x6, LLM, 边缘AI, 会议纪要]
category: '边缘AI'
draft: false
lang: 'zh-CN'
---

边缘AI 分类开篇——聊聊在 SOPHGO（算能）CV84X6 上跑 LLM 应用的真实工程账。素材来自 morphedge 项目的 P8 形态：**会议纪要**。morphedge 本身是一套模块化边缘设备软件（控制面内核 + 网关 + 按角色域拆分的服务进程，四层 Manifest 驱动），P8 只是其中一个 Manifest——但它是观察「边缘 LLM 应用到底难在哪」最好的切片。

## 一、先认识这块板子：LLM 应用不是"调个 API"

CV84X6 是**纯算能 SoC**：算力与编解码都在算能芯片上，没有第三方解码器。关键接口就三样：

- **模型推理**走算能 TPU：`bmrt_load_bmodel` / `bmrt_launch_tensor_ex`
- **编解码**走 VPU：`bmvideo` / `bmvpuapi`
- **设备内存**走算能基础库：`bm_dev_request` / `bm_malloc_device_byte` / `bm_mem_mmap_device_mem`

工程上有个刻意的硬约束：`FindSophon.cmake` 要求 TPU + VPU 解码 + VPU 编码**三者都在**，缺任一会直接构建失败。也就是说在这块板子上，"能跑 LLM"和"能解码视频"是同一个 SDK 里的事——**LLM 应用的第一课不是 prompt 工程，而是显存与设备句柄管理**。

## 二、LLM 服务怎么设计

`llm-server` 是一个 text-only 的本地大模型服务，跑 **LLM-TPU chat 格式 bmodel**（结构：`embedding` / `block_i` / `block_cache_i` / `lm_head`[`/greedy_head`]），主档 qwen3-4b int4（seq 8192），另有 qwen1.5-7b、qwen3-8b、GLM-4-9b 等对照档。几个设计决定值得记：

**只听回环**：`127.0.0.1:8803`，不经网关 `/api/v1` 路由（数据不出域原则）。

**两套端点并存**：

| 端点 | 用途 |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI 兼容**非流式**（`stream=true` 回 400）——ASR 的纪要转发客户端就解析这条 |
| `POST /v1/task` | 任务化提示词：`{"task":"summary","text":...}` → 任务注册表查模板 → 渲染 → 生成 |
| `POST /v1/summary` | 上述的别名 |
| `GET /v1/tasks` · `/v1/health` | 任务清单 / 引擎与模型状态（加载失败降级时的出口） |

任务化提示词是边缘 LLM 应用的关键抽象：**提示词不进业务代码，进注册表**。加一个「纪要」「摘要」「润色」任务 = 加一份模板，而不是改调用方。

## 三、单路重资源：常驻、动态加载与模型切换

`channel_capacity() = 1`——**一份 LLM 权重独占显存，只允许一路**。这条约束直接决定了三个机制：

1. **常驻 / 动态加载两模式**：默认 on_start 加载常驻；设 `MORPH_LLM_RESIDENT=0` 则首请求 load → 推理 → 完成后 unload——显存受限、需要和 ASR 分时复用时用这个
2. **模型切换走 Manifest + 通用切换器**：`services[].switchable` 决定前端是否显示切换卡，候选来自服务返回的 `groups`；切换请求经网关到 `switch_port`（LLM 是 8808）的 `/api/model`，校验候选名与 bmodel 文件后写入选择文件（缺省 `/var/lib/morphedge/llm_model`），重启持久生效。**新增模型或新服务都不需要改前端**
3. **调试开关都藏在环境变量里**：`MORPH_LLM_DUMP_PROMPT=1` 打 prompt 首尾 token id 与官方 tokenizer 对拍（定位 prompt 编码漂移）；`MORPH_LLM_DEDUP` 只有严格等于 `off` 才关闭退化早停与去重——边界写得很死，避免"以为关了其实没关"

## 四、和 ASR 抢 NPU：串行化是硬要求

这是整套实现里最"边缘"的一课。P8 有两个 NPU 重资源服务：ASR 和 LLM，各自建 bmrt 加载数 GB 的 bmodel。**同时加载会互相踩设备内存**——现象很诡异：ASR 输出 400 多个 `!`，每次约 10 秒。

解法不是调参，是**启动纪律**：`run-p8.sh` 严格按 `NPU_ORDER`（默认 `asr,llm`）先后启动，等前一个「模型加载完成 + 服务端口监听」后才起下一个。就绪判定用**日志哨兵 + 端口双保险**：

- ASR：日志「模型就绪」+ `:8801`（哨兵不跟模型名，切换 bmodel 后仍有效）
- LLM：日志「本地大模型就绪」+ `:8803`
- store / decoder：无模型，只看端口

还有一个务实的降级路径：**只跑 gatewayd + morphedge-llm 就能开页面、写纪要**；要采麦克风再起 ASR——把"LLM 应用"和"语音采集"解耦成可分别验收的两步。

## 五、P8 的五个模块

| 模块 | 内容 | 端口 |
| --- | --- | --- |
| F-ASR | VAD（fsmn）+ 说话人分离（cam++）+ ASR 主模型（Qwen3-ASR 0.6B/1.7B w4bf16、SenseVoice） | 8801（切换 8809） |
| F-LLM | 本地大模型（qwen3-4b int4 seq8192 等），提示词任务化 | 8803（切换 8808） |
| F-STORE | NVMe 持久化 + 检索：会话列表/详情、转写 jsonl、单条 wav、已读标记 | 8804 |
| F-EXPORT | 受控二维码本地导出 + 审计 | 8805 |
| F-DECODE | VPU 流解码 + 内置拉流播放 | 8806 |

注意 Manifest 的一条设计：**声明路数 ≠ 能力上限**。`channels.count` 是部署时起几路，服务另有 `channel_capacity()` 作热加载守卫（VPU 最多 16 路、LLM 只允许 1 路）——配置写多大都不会把硬件撑爆。

## 六、会议纪要这条业务链

1. **麦克风在浏览器里**：采集只允许在安全上下文——所以网关用 **HTTPS 单一入口 8000**，同一端口出静态页 + `wss /asr` + `/api/v1/llm/*`（https 页面也会拦掉 `ws://` 与 `http://`），自签证书首次需信任
2. **ASR 流式转写 + 说话人分离**，一边说一边出文字
3. **转写完成 → 转发给 LLM**：asr-server 把纪要文本发给 llm-server 生成摘要（HTTP 转发为缺省，也可走文件交换解耦）
4. **落盘**：asr 把结果 `POST` 给 store-server（8804）写 NVMe；网页经网关同源反代 `/api/v1/sessions*` 读——**写入方与读取方都在 store，网关不直读磁盘**
5. **导出**：受控二维码本地下载 + 审计记录（数据分类里 `meeting-transcript` 属于敏感类，出域要过管控）

## 七、几条容易被忽略的工程纪律

- **store 必须最先起**：它自持 8804 会议历史服务，既是 asr 落盘目标，也是网关 sessions 反代目标——缺了会降级成"不落盘"、历史页 503
- **端口三处一致**：store 的监听、网关反代、asr 落盘客户端用同一个 `MORPH_STORE_HTTP_PORT` 统一导出，避免三份配置漂移
- **停止顺序是启动的逆序**：脚本里服务名倒序停止，保证 asr 先于 store 退出，收尾的 `POST /api/v1/store/close` 才不会打到已关闭的服务上
- **与 systemd 互斥**：手动脚本与 systemd 单元不能同时跑，否则端口冲突——运维脚本要显式声明这个边界
- **无 root 运行**：进程全后台、日志与 PID 落在临时目录，不写系统目录
- **单域独立构建**：改 ASR 只重编 ASR 域与该可执行，其它角色二进制不受影响

## 写在最后

在云端"LLM 应用"的难点在提示词和评测；在 CV84x6 这样的边缘芯片上，难点前移到了另外四件事：**显存够不够、启动顺序对不对、安全上下文满不满足、落盘链路断没断**。P8 的价值就在于把这几件事都摊开成文档和脚本——包括那个"400 个感叹号"的怪现象，最终落在一条启动顺序上。

对照站内相关内容：[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)讲的是另一颗芯片上的流水线分层，[《零拷贝精读》](/posts/rk3588/zero-copy/)讲的是同一类设备内存问题的通用解法——边缘 AI 应用的架构，本质上都是"把硬件的约束写成软件的结构"。

## 参考资料

- 项目：morphedge（私有仓库，CV84X6 边缘设备软件）
- 关键文件：`apps/p8_meet_minutes/manifest.json`（P8 形态）、`docs/llm.md`（LLM 服务）、`docs/sophon-hal.md`（算能 HAL）、`run-p8.sh`（全栈启动脚本）、`docs/api.md`（接口）
- 站内相关：[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)、[《Rockchip 零拷贝技术精读》](/posts/rk3588/zero-copy/)、[《嵌入式 Linux 启动流程精读》](/posts/linux/boot-flow/)
