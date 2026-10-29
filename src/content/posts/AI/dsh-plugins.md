---
title: DeepSeek Harness 插件生态精读：20 个插件的分类整理
published: 2026-10-08
updated: 2026-10-29
description: '综合六篇 DSH 实测文章：插件按功能域分类整理（市场、效率、上下文、回退、能力扩展、观测），含实测勘误、装了又卸的三类反例、隐私风险提醒与选装建议。'
image: 'https://www.loliapi.com/bg/'
tags: [DeepSeek, AI Agent, DSH, 插件]
category: 'AI'
draft: false
lang: 'zh-CN'
---

接上篇[《DeepSeek Harness 安装入门精读》](/posts/ai/deepseek-harness/)——装完只是裸奔，这篇是源宝@Git源宝对 20 个 DSH 社区插件的实测评测，我按功能域重新分组整理，观点归原作者，原文见文末。

先抄三条前置风险提醒，都是实话：**DSH 还是预览版**，部分插件兼容性没保证；**插件是在你电脑上跑的真代码**，不是玩具；**社区插件普遍早期**——没有 Release、没有 CI、作者单人维护，出 bug 正常。

> **2026-10-29 修订**：这一版不是转发，是实装后的勘误。我在一台 Windows 机器上（DSH 桌面版 44.7.0、运行时 0.2.1-rc.3、profile 为 `desktop`）照着原文清单逐条装了，用 `npm view` 逐个核对了包名与版本。结论是：**原文有不少条目在 npm 上根本查不到，还有一处命令的 profile 写错了**。下面每个条目都补了实装结论（✅ 可装 / ❌ 查无此包 / ⚠️ 有兼容问题），并新增了[实测勘误表](#实测勘误表)和[实装踩到的六个坑](#实装踩到的六个坑)两节。原文观点仍归原作者。

## 一、先装它：插件市场

原文写的 **dsh-market**，这个包名在 npm 上**不存在**。实测能用的是四个名字相近的包，用途各有侧重：

| 包 | 版本 | 作用 |
| --- | --- | --- |
| `dsh-marketplace` | 0.1.3 | 设置页里的插件市场：搜索、安装、卸载 |
| `dsh-plugin-shop` | 0.9.0 | 插件商店 + 目录 |
| `dsh-plugin-install` | 0.4.12 | 不经过市场，按包名直接装 |
| `dsh-plugin-mgr` | 0.2.12 | 列出、启停、检查更新、卸载已装插件 |

装之前先说清 profile——这是原文最容易误导人的地方：

```bash
# 桌面版（官方桌面客户端）
dsh plugin --profile desktop add dsh-marketplace

# 命令行 web 版
dsh plugin --profile web add dsh-marketplace
```

**原文统一写 `--profile web`**，但桌面客户端管的是 `desktop` profile，装进 `web` 只是另建一套，桌面版不会加载。

## 二、输入效率：消除来回切换

- **dsh-at-file** `0.6.3` ✅ 输入框打 `@` 直接选工作区文件附进来，省掉"切出去复制路径再切回来"的折腾
- **dsh-message-edit** `0.2.3` ✅ 直接编辑历史消息并从该处重新生成分支，原内容保留、可从时间线找回
- **dsh-plugin-appshot** `0.4.2` ✅ 全局快捷键截屏，图片直接进输入框（macOS / Windows）
- ❌ **dsh-client-auto-retry**：npm 查无此包。原文说它能在网络抖动、输出触顶时自动续跑——目前没有可装的实现

## 三、上下文与 Token：看得见才管得住

- **dsh-context** `0.77.0` ✅ 网页端加一个 Context 面板，每次请求的 Token 构成（系统提示词、工具 Schema、历史消息、压缩内容、缓存命中）全部可见
- **dsh-context-guard** `0.2.1` ✅ 先把任务要求写明（做什么、不做什么、什么算完成），模型做完后拿要求对照，没完成就继续
- ❌ **dsh-tool-squeeze**：npm 查无此包
- ❌ **dsh-context-doctor**：npm 查无此包。原文说的"项目体检——文件重复、指令冲突、闲置 Skill"目前没对应实现

## 四、状态回退：作者最推荐的一个

**dsh-filesnap** `0.4.2` ✅ 把**对话和工作区文件一起打包快照**，可指定退回某个版本——在新分支里同时恢复文件和对话，不改历史版本，回退前还自动建救援点。对"跑了一半改乱了想回头"的场景，这一个插件可能就值回票价。

## 五、能力扩展：补齐 DSH 的短板

- ❌ **ModSearch**：npm 查无此包
- ❌ **dsh-browser**：npm 查无此包（Chrome 侧边栏那套目前可能是仓库直装或未发布）
- ❌ **dsh-vision-toolkit**：npm 查无此包。另有 `dsh-vision` `0.2.0`，但它需要自备 OpenAI 兼容的多模态端点，不是同一个东西
- **dsh-genui** `0.3.1` ✅ 模型回复里直接渲染图表、表单、Mermaid 流程图甚至 3D 场景，组件上的交互能反馈回模型——分析 CSV 不再是"一段结论"，而是"一张能点的图"

## 六、通知与远程

- **dsh-notification** `0.1.2` ✅ 任务完成、报错或命中关键词时弹桌面通知
- ⚠️ **dsh-im** `1.0.5`：**装不上**。DSH 在安装前会做兼容性门禁，它声明只支持 `@deepseek-ai/dsh-agent ^0.1.0-rc.6`，而当前运行时是 `0.2.1-rc.3`，门禁直接拒绝并给出 `dsh plugin allow-version` 的强装提示。强装的后果是不保证能跑，不建议。替代品 `@xmanrui/dsh-im` `5.7.0` 只声明 `web` profile，桌面版同样不适用

## 七、观测与统计

- **dsh-whale-report** `0.6.1` ✅ 从会话日志生成日报/周报/月报——跑了几个会话、花多少 Token、折合多少钱、哪个会话最贵、哪个工具最常超时
- **Token Monitor**：严格说不是插件，是独立桌面应用，按回合展示 DSH 会话的 Token 消耗

## 八、杂项

- ❌ **dsh-noema**：npm 查无此包。同类的记忆插件见下面「记忆插件实测」一节
- **dsh-win32** `0.17.15` ✅ Windows 用户专用的诊断修复工具（koffi 加载失败这类历史遗留问题）
- ❌ **dsh-deep-whale**：**这不是包名**，是一个皮肤系列。真身是 `@smalltailqwq/dsh-client-ui-skin-*`，实测可用的是三件套：`maid-atelier` `0.1.9`（深海女仆工坊）、`orca-link` `0.1.9`（虎鲸链路）、`deep-whale-manager` `0.1.8`（皮肤管理器）。两套皮肤同时启用会互相打架，管理器会在启动时把两套都关掉退回官方界面，等你去「设置 → 皮肤管理」选一套

## 记忆插件实测

原文的 `dsh-noema` 查不到，`dsh-engramory` 又声明不兼容 0.2.x。实测下来这条路最乱，单列一节：

| 包 | 版本 | 实测结论 |
| --- | --- | --- |
| `dsh-plugin-memory` | 0.10.0 | ✅ 纯 markdown + git，零依赖，不常驻、不改接线；代价是版本号还早 |
| `dsh-engramory` | 0.2.5 | ⚠️ 声明 `>=0.1.0-rc.7 <0.2.0-0`，**即不支持 0.2.x**；但缺 peer 声明，门禁没拦住，实测技能能注册上——属于"能跑但没人承诺"，后来还是卸了 |
| `memory-eternal` | 0.18.2 | ⚠️ 声明兼容 0.2.x，功能也最全（知识库、知识图谱、审核中心），但会拉起独立常驻进程（`web.js` + watchdog，占 7999 端口），并在宿主生命周期之外改写接线。实测期间 profile 的插件列表被清空过，**不建议装** |
| `dsh-memo` | 0.13.2 | ❌ 作者把仓库设为私有，npm 已标 `deprecated`（unmaintained），能跑但不会再有人修 |

结论还是原文那句：**记忆系统只留一个。**

## 实测勘误表

| 原文写法 | 实况 | 正确包名 / 说明 |
| --- | --- | --- |
| `dsh-market` | 查无此包 | `dsh-marketplace` / `dsh-plugin-shop` / `dsh-plugin-install` / `dsh-plugin-mgr` |
| `dsh-client-auto-retry` | 查无此包 | 无可用替代 |
| `dsh-tool-squeeze` | 查无此包 | 无可用替代 |
| `dsh-context-doctor` | 查无此包 | 无可用替代 |
| `dsh-vision-toolkit` | 查无此包 | `dsh-vision` 0.2.0（需自备多模态端点，非同一项目） |
| `ModSearch` / `dsh-browser` | 查无此包 | 可能是仓库直装或未发布 |
| `dsh-noema` | 查无此包 | 见「记忆插件实测」 |
| `dsh-deep-whale` | 不是包名 | `@smalltailqwq/dsh-client-ui-skin-*` 三件套 |
| `dsh-web-ui`（6.4k 星那套） | 名称不符 | npm 上 `dsh-webui` 是另一款「Liquid Glass 插件管理器」；那套界面全家桶一般以 `@linxin666/dsh-web-all` 聚合包分发 |
| `dsh-im` | 装上被拒 | 只声明支持 0.1.x；`allow-version` 可强装但不建议 |
| `--profile web` | 桌面版不适用 | 桌面版用 `--profile desktop` |
| `DSH-better-sidebar` | 名称不符 | npm 上是 `dsh-better-sidebar` `0.28.2` |

其余核实到能装的版本：`dsh-office-tools` 1.0.8、`dsh-workbench` 0.16.1、`dsh-extension-hub` 0.2.19、`dsh-plugin-console` 0.3.2、`dsh-dafeiyu` 0.1.22。

## 实装踩到的六个坑

**1. profile 写错，装完没反应**
桌面版是 `desktop`，命令行 web 版是 `web`。原文一律写 `web`，照着抄在桌面版上会装进另一套 profile。

**2. pnpm 11 拦构建脚本**
`ssh2`、`node-pty` 这类带原生依赖的包，默认构建脚本会被拦，表现为安装命令以非零码退出、插件没注册。两种处理：`pnpm approve-builds` 放行，或者在 profile 的 `pnpm-workspace.yaml` 里显式声明 `ignoredBuiltDependencies`（`ssh2` 的 `cpu-features` 只是可选加速，跳过照样跑）。

**3. 大包别走 npmjs**
`dsh-dafeiyu` 的 tarball 有 **179 MB**（7007 个文件），npmjs 的 CDN 能卡十几分钟不动；换 `--registry=https://registry.npmmirror.com` 十几秒下完。

**4. 杀软会拦 PyInstaller 自解压**
同一个桌宠包在 Windows 上是 PyInstaller 单文件 exe，启动时要把 PySide6 解压到临时目录，360 这类软件会拦掉 `MSVCP140.dll` 的写入，日志里是 `Failed to extract PySide6\MSVCP140.dll: Permission denied`，连崩 5 次后放弃。绕法是给插件目录加信任区，或者改名打包 exe、改走 `helper.py` + 系统 Python + PySide6。

**5. `dsh plugin add` 只在"新增依赖"时注册 bundle**
注册逻辑只处理本次新增的依赖。如果上一次安装被打断（依赖已写进 `package.json` 但没完成注册），之后再 `add` 同一批包不会补注册——插件在 `node_modules` 里，却永远不加载。解法是先 `remove` 再 `add`。

**6. profile 的插件列表会被重写**
实测期间 `package.json` 里的 `dsh.profile.bundles` 被清空过好几次（有两次只剩 `@deepseek-ai/dsh-base` 和 `dsh-web-app`）。表现是重启后插件全部消失，但 `dependencies` 和 `node_modules` 完好。改 profile 前先备份 `package.json` 和 `cordis.patch.yml`；出事后比对这两个文件就能恢复。

## 装了又卸：三类反例比清单更有价值

1. **记忆插件装两个以上**：两套记忆系统互不知道对方存了什么，模型拿到的上下文反而更乱——记忆系统只留一个
2. **可观测插件默认开着内容采集**：会把 Prompt、回复、工具参数全量发到外部后端——**隐私直接泄漏**，装任何带"上报"性质的插件前先查它的数据流向。这次实测也遇到一个：`@linxin666/dsh-ssh` 的浏览器半区每个 UTC 日会向 `dsh-market.com` 发一次匿名心跳（随机 ID + 包名，不含内容），介意的话要权衡
3. **功能重叠的工具集**：时间/编码/JSON/正则一把抓的工具合集本身不错，但已经装了 shikitor 和 genui 再装 dsh-toolkit 就是重复——插件多了互相打架

## 另一份榜单：五大必装的交集与增量

生活所随后也发了《DSH 必装的五大插件》，与源宝这份对照着看信息量更大。

**交集（两份都推，信号强）**：`dsh-marketplace`——该文提到市场收录已超 4200 个插件，"先装市场，再装一切"；`dsh-at-file`——"用了就回不去"，且较新版本只在上下文里引用文件路径，不再把整份文档灌进提示词，省 Token。

**增量（源宝没提的三个）**：

- ❌ **ModLens**：npm 查无此包。原文说它是"给纯文本模型装眼睛"，图片经 OCR + 版面分析转成结构化文本再喂给模型，还强调要锁版本号——这些都无从验证了
- ❌ **dsh-web-ui**：npm 上不是这个名字。见勘误表
- **dsh-better-sidebar** `0.28.2` ✅ 把左侧栏改造成 IDE——文件树、真实终端、Git 状态、子代理状态监控。**提醒**：它依赖 `node-pty`，会踩上面第 2 个坑；主用 TUI 的可以直接跳过

**选装建议（生活所给的，值得抄）**：DSH 界面有 Desktop/TUI/Web 三个版本，**选定一个常用就够了**，三套一起折腾容易把配置弄乱。确定界面后再加市场 + better-sidebar + at-file 这一档；视觉类遇到看图场景再装，better-sidebar 开始认真写代码再补。社区每周冒出上千个新仓库，**注意力别跟着星标跑**——先把五个装稳，已经比 90% 的用户快了。

> 想自己写插件、搞懂框架是怎么组装的？源码级内容已独立成篇：[《DeepSeek Harness 进阶：profile/bundle/patch 与插件开发契约》](/posts/ai/dsh-dev-guide/)。

## 彩蛋：B 站大肥鱼——养一条替你刷 B 站的 Agent

源宝后来又出了一篇续作，讲的是前段时间很火的"B 站鱼灾"背后的玩法。原理不复杂：社区插件 **dsh-bili-whale**（❌ npm 查无此包）让 DSH Agent 替你搜索视频、读取字幕、分析内容，按你的兴趣筛选出值得看的，再通过评论区 @ 或私信汇报。配套的 **dsh-dafeiyu** `0.1.22` ✅ 桌宠插件则让一条蓝色大肥鱼出现在桌面上，随 Harness 的工作状态切换动画（思考、改文件、执行、等待、完成）。

配置要点（完整教程见原文）：装完插件**必须完全重启** Harness 才生效；注入"鱼设"和兴趣偏好（喜欢什么、讨厌标题党、推荐时要说清内容与不足）；**主人号与鱼号必须分离**，鱼号单独扫码授权；跑一次依赖体检（缺 ffmpeg 只影响看画面，字幕/简介/评论功能正常）。

三条安全提醒，是"鱼灾"争议换来的教训，比玩法本身更值钱：

1. **先保守再放开**：初期关闭自动评论、公开 @、陌生人互动，保持低频运行
2. **分享方式选私信，别选公开评论区 @**——大规模自动化账号跑到公开评论区汇报工作，就是这次鱼灾引起争议的直接原因
3. **不要购买来源不明的 B 站账号**，容易暴露隐私

配套生态还有个 **dafeiyu-cleaner** 浏览器扩展：识别评论区里疑似 AI 驱动的账号（给理由，可申诉"是人类"），一键隐藏或"响指清场"。注意它只在**你自己的浏览器**里隐藏评论，别人照常能看到；AI 评论识别也不是百分百准确——有些真人写的就是很像 AI。

教程最后是整活环节：用即梦（Seedance 模型）先原创生成大肥鱼角色立绘，再与真实书桌照片合成，最后做 15 秒短剧——大肥鱼嫌写作麻烦，"叫来两个外援"：Claude 小狐狸负责整理思路，Codex 负责执行，本鱼负责摸鱼。想整活的直接看原文抄提示词。

## 运维视角：验证过的版本、组合建议与故障排查

舒文的这篇更偏运维手册——前面榜单告诉你装什么，这篇告诉你装了之后怎么管理、怎么排查。原文给出的已验证版本里，`dsh-extension-hub` `0.2.19` 与 `dsh-message-edit` `0.2.3` 实测都能装上；`dshmarket` 的名字对不上，见勘误表。

**增量插件（前文未提的）**：

- **dsh-extension-hub** `0.2.19` ✅ Skill、MCP Server、Plugin 三类扩展的统一可视化管理——创建/启停/编辑，还能**导入 Claude Code、Codex 的配置**
- **@hytime/dsh-thinking-effort**：用 `llm-pi-ai` 接第三方模型时的刚需——模型没声明 `reasoningEfforts` 会报 `UNSUPPORTED_REASONING_EFFORT` 或没有思考强度选择器。注意三环节链：**DSH 档位 → 网关值 → 模型能力**
- **dsh-engramory**：见「记忆插件实测」，声明不兼容 0.2.x
- **dsh-any-background**：主题/背景/透明度全家桶，配置存在 `~/.dsh/.dsh-any-background-data/` 而非 localStorage——迁移环境时记得连目录一起搬

**已覆盖插件的补充细节**：dsh-better-sidebar 依赖 `node-pty`，pnpm 11 会拦截其构建脚本——安装流程是 add 之后 `cd ~/.dsh/profiles/desktop && pnpm approve-builds --all && pnpm rebuild node-pty` 再硬刷新（Ctrl+Shift+R）。页面出现两个侧边栏、日志报 `duplicate loader entry id`，查 `cordis.patch.yml` 删重复 Loader，**不要重复安装**。dsh-message-edit 的两种重试策略值得知道：`truncate`（从编辑处重新生成）与 `preserve`（保留后续输入依次重跑），采用事件溯源保存。

**按场景的组合建议**：基础环境（`dsh-marketplace`）/ 开发环境（better-sidebar + message-edit）/ 长期使用（一个记忆插件 + message-edit）/ 第三方模型（thinking-effort）。以及原文最有价值的一句话：**插件数量只是结果，能不能把几个插件组合成稳定的工作流，才是实际使用价值。**

**通用故障排查清单**（安装没生效按序查）：插件版本与 DSH 兼容性 → 当前 Profile → 是否启用 → `package.json` 的 `bundles` 里有没有它 → `cordis.patch.yml` → 浏览器缓存 → 是否需要重启 Host。修改 Profile 配置前先备份。

## 重量级与场景化：两份新榜单的增量

生态跑得比想象快。智东西（媒体视角，综合 GitHub 星数与社区热度）和灵动Ai幻界（下篇 10 个）又各出了一份清单，重叠很小，带来一批真家伙。两条生态动向先记下：**DSH 在 GitHub 已拿下 25 万 Stars**；官方已上线**实验性的 Discover 插件发现功能**，官方插件市场在路上。另外 DeepSeek 产品负责人**崔添翼公开推荐了 `dsh-better-sidebar` 和 `dsh-context`**——与本文前两份榜单的重叠项互相印证。

### 办公与文档

**dsh-office-tools** `1.0.8` ✅ 给模型装了八个读写 Word/Excel/PPT 的工具，一句话在工作区落下完整的 .docx/.xlsx/.pptx（标题、段落、表格、多 sheet、幻灯片备注），本机装没装 Office 都不影响。细节坑：PPT 里的图片是链接而非内嵌，挪动要连图一起带。

### 远程与自动化

- **@michengai/dsh-im-connect**：接入飞书、钉钉、企业微信、QQ、Telegram——人不在电脑前也能派活，每个聊天对应一个独立会话
- **@michengai/dsh-automation**：与官方"到点只提醒"的日程不同，它到点**真的开一个独立会话执行任务**

### 模型与订阅

**dsh-plugin-subscriptions**：手上有 ChatGPT、Claude、Grok、GitHub Copilot 的订阅，可以直接 OAuth 登录把它们**当模型用**。注意：要配代理时在启动环境或 `$DSH_HOME/.env` 里配，**插件自带的代理关掉，两套同开会互相绊**。

### 扩展管理进阶

- **dsh-mcp-connector**：管 MCP 的连接器目录、一键授权（OAuth2.0 PKCE 或 API Key）、跨连接搜工具、连不上时给出诊断
- **@michengai/dsh-agency-agents**：321 个专业角色、22 个分类
- **dsh-plugin-console** `0.3.2` ✅ 插件门控中心——升级前全树检查点、失败自动全树回滚、新框架带不动的插件强制禁用并等适配解锁。DSH 一两周一个版本，撞上"插件跟不上本体"是迟早的事，这一个是保险丝
- **dsh-config-manager**：配置搬家——模型/插件/MCP/技能/AGENTS.md 打包成 zip，新机器导入即恢复；密钥默认**不**打进包里

### 长任务与记忆的外挂

- **Planning with Files**：把任务计划、研究发现、执行进度写进文件，会话中断或上下文压缩后靠文件恢复进度
- **OpenViking**：火山引擎开源（约 4 万 Stars）的 Agent 记忆与知识检索系统，提供 DSH 专用插件（`@openviking/dsh-memory-plugin` `0.5.31`）；接入门槛较高，需要额外配置服务端

### 重量级外部项目接入

- **OpenDesign**：10.3 万 Stars 的开源 AI 设计工作台，通过运行时适配组件调用本机已装的 DSH
- **Reactive Resume**：4 万+ Stars 的开源简历工具，经 MCP 接入
- **DeepSeek Reasonix**：独立 AI 编程 Agent，经 ACP 协议以**子代理**身份接受 DSH 分配的任务
- **DSH Desktop**：社区独立做的桌面客户端，兼容性取决于所搭载的运行时版本

风险提醒（灵动篇的原话精神）：这几个动得更深的插件——写工作区文件的、打包整套环境的、能改框架版本的——装之前看一眼**出自谁手、最近更新是什么时候**。

## 写在最后

三点整理时发现的事，装之前值得知道：

1. **原文的安装命令有笔误，而且不止一处**——除了 profile 写成 `web`、包名对不上，还有把 notification 的 URL 抄到 auto-approval 命令里的情况。**装之前一律去 npm 搜包名**，或者用 `dsh-marketplace` 搜着装；别照着文章抄命令
2. **权限分级要自己定**：作者的建议是读操作自动允许、写操作主动询问、删除直接拒绝——这与上篇安装教程里的权限等级设置一脉相承
3. **别信"装上就能用"**：这次实测里，20 个条目有 9 个在 npm 上根本查不到，还有 1 个被兼容性门禁拒绝。生态跑得快，文章的时效性比想象中短

另一个感受没变：DSH 的插件生态形状和 VSCode/OBS 很像——一个框架 + 社区填空。真正解决"日常高频痛点"的，还是 filesnap（状态回退）、context（Token 可见）和 at-file（输入效率）这类"顺"字诀工具，而不是那些炫的。

## 参考资料

- 原文一：[DeepSeek Harness 必装 20 个插件 — 源宝@Git源宝（微信公众号）](https://mp.weixin.qq.com/s/s5lKCNVKR5W4bEwiG0M4QQ)
- 原文二：[DSH必装的五大插件，装完直接起飞 — 生活所（微信公众号）](https://mp.weixin.qq.com/s/Dprbvn4-Xyi3NSVI44hOvQ)
- 原文三：[Deepseek Harness 大肥鱼【完整版教程】 — 源宝@Git源宝（微信公众号）](https://mp.weixin.qq.com/s/zDfpNN6z5Diqi8c6dXRo4w)
- 原文四：[DeepSeek Harness 插件推荐与使用说明 — 舒文@编程拾录（微信公众号）](https://mp.weixin.qq.com/s/sTcdmeHJgkIcNu3ZqkL-tg)
- 原文五：[DeepSeek Harness 不可错过的 12 款神器 — 江宇@智东西（微信公众号）](https://mp.weixin.qq.com/s/k9qYa9aeKMVZc0vvV45_gw)
- 原文六：[DeepSeek Harness 进阶使用指南｜二十个必装插件（下） — 灵动Ai幻界（微信公众号）](https://mp.weixin.qq.com/s/Ovrkbtx7VqQrY3NjbPDvug)
- 站内相关：[《DeepSeek Harness 安装入门精读》](/posts/ai/deepseek-harness/)、[《Claude Code 应用与实践精读》](/posts/ai/claude-code-playbook/)
