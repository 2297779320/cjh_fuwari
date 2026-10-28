---
title: DeepSeek Harness 插件生态精读：20 个插件的分类整理
published: 2026-10-08
description: '综合六篇 DSH 实测文章：插件按功能域分类整理（市场、效率、上下文、回退、能力扩展、观测），含装了又卸的三类反例、隐私风险提醒、重量级项目盘点与选装建议。'
image: 'https://www.loliapi.com/bg/'
tags: [DeepSeek, AI Agent, DSH, 插件]
category: 'AI'
draft: false
lang: 'zh-CN'
---

接上篇[《DeepSeek Harness 安装入门精读》](/posts/ai/deepseek-harness/)——装完只是裸奔，这篇是源宝@Git源宝对 20 个 DSH 社区插件的实测评测，我按功能域重新分组整理，观点归原作者，原文见文末。

先抄三条前置风险提醒，都是实话：**DSH 还是预览版**，部分插件兼容性没保证；**插件是在你电脑上跑的真代码**，不是玩具；**社区插件普遍早期**——没有 Release、没有 CI、作者单人维护，出 bug 正常。

## 一、先装它：插件市场

**dsh-market**——DSH 自带装插件的方式是敲命令 `dsh plugin --profile web add <包名>`，前提是你得知道包名。dsh-market 提供搜索、安装、更新、卸载的完整市场体验，装完还会汇报本次新增的依赖和风险。第一个装它，后面一切都方便。

## 二、输入效率：消除来回切换

- **dsh-at-file**：输入框打 `@` 直接选工作区文件附进来，省掉"切出去复制路径再切回来"的折腾
- **dsh-message-edit**：直接编辑历史消息并从该处重新生成分支，原内容保留、可从时间线找回
- **dsh-plugin-appshot**：全局快捷键截屏，图片直接进输入框
- **dsh-client-auto-retry**：长任务遇到网络抖动、输出触顶（max-tokens）自动续跑，带冷却时间和连续次数上限，不会无脑烧 Token

## 三、上下文与 Token：看得见才管得住

- **dsh-context**：网页端加一个 Context 面板，每次请求的 Token 构成（系统提示词、工具 Schema、历史消息、压缩内容、缓存命中）全部可见
- **dsh-tool-squeeze**：按输出结果做针对性压缩，原文保留，给模型的是压缩版，需要时可翻原文
- **dsh-context-doctor**：项目体检——文件重复、指令冲突、Skill 里长期吃 Token 却没被用过的部分
- **dsh-context-guard**：先把任务要求写明（做什么、不做什么、什么算完成），模型做完后拿要求对照，没完成就继续

## 四、状态回退：作者最推荐的一个

**dsh-filesnap**：把**对话和工作区文件一起打包快照**，可指定退回某个版本——在新分支里同时恢复文件和对话，不改历史版本，回退前还自动建救援点。对"跑了一半改乱了想回头"的场景，这一个插件可能就值回票价。

## 五、能力扩展：补齐 DSH 的短板

- **ModSearch**：DSH 默认不能上网，这个补上 Web 搜索、X 搜索和网页正文抓取（部分通道需自备 API Key）
- **dsh-browser**：Chrome 侧边栏扩展，让 DSH 直接操作你眼前打开的网页——看文档时侧边栏让它整理参数成表，它读的就是当前页
- **dsh-vision-toolkit**：图片全家桶——图片问答、长截图 OCR、UI 截图还原成代码、双图逐像素对比；模型不支持图片输入时可配 modlens 走模型路由
- **dsh-genui**：模型回复里直接渲染图表、表单、Mermaid 流程图甚至 3D 场景，且组件上的交互能反馈回模型——分析 CSV 不再是"一段结论"，而是"一张能点的图"

## 六、通知与远程

- **dsh-notification**：任务完成、报错或命中关键词时弹桌面通知
- **dsh-im**：把 DSH 接进 IM（Bundle 支持多渠道，飞书/QQ 等）——手机发一句"把昨天那个 PR 的测试跑一下"，它跑完把结果发回来

## 七、观测与统计

- **dsh-whale-report**：从会话日志生成日报/周报/月报——跑了几个会话、花多少 Token、折合多少钱、哪个会话最贵、哪个工具最常超时
- **Token Monitor**：严格说不是插件，是独立桌面应用，按回合展示 DSH 会话的 Token 消耗

## 八、杂项

- **dsh-noema**：给 DSH 加长期记忆，且能从 Claude Code、Codex、Cursor 导入已有记忆文件，换工具不用重新喂
- **dsh-win32**：Windows 用户专用的诊断修复工具（koffi 加载失败这类历史遗留问题）
- **dsh-deep-whale**：鲸鱼娘主题皮肤。原文原话："没有任何实用价值，但我装了"

## 装了又卸：三类反例比清单更有价值

1. **记忆插件装两个以上**：两套记忆系统互不知道对方存了什么，模型拿到的上下文反而更乱——记忆系统只留一个
2. **可观测插件默认开着内容采集**：会把 Prompt、回复、工具参数全量发到外部后端——**隐私直接泄漏**，装任何带"上报"性质的插件前先查它的数据流向
3. **功能重叠的工具集**：时间/编码/JSON/正则一把抓的工具合集本身不错，但已经装了 shikitor 和 genui 再装 dsh-toolkit 就是重复——插件多了互相打架

## 另一份榜单：五大必装的交集与增量

生活所随后也发了《DSH 必装的五大插件》，与源宝这份对照着看信息量更大。

**交集（两份都推，信号强）**：dsh-market——该文提到市场收录已超 4200 个插件，"先装市场，再装一切"；dsh-at-file——"用了就回不去"，且较新版本只在上下文里引用文件路径，不再把整份文档灌进提示词，省 Token。

**增量（源宝没提的三个）**：

- **ModLens**：给纯文本模型装眼睛。图片直接粘贴进输入框，经原生工具转成 OCR + 版面分析的结构化文本再喂给 DeepSeek；GitHub 星 3.7k，生态里最火的视觉插件。**坑**：README 明确要求锁版本号、别用 @latest（pnpm 11 会拖住 24 小时内发布的新版本）。支持复用本机已有的 Claude Code/Gemini 登录，零配置起步
- **dsh-web-ui**：界面全家桶，整个 DSH 生态星数最高（6.4k）——五列任务看板（卡片直接派给真实会话执行、支持 cron 定时）、Git 图谱、实时 Token 统计、鲸鱼娘宠物、皮肤中心。"每天盯着的是聊天框还是驾驶舱，决定了你愿不愿意打开它"
- **DSH-better-sidebar**：把左侧栏改造成 IDE——文件树、真实终端、Git 状态、子代理状态监控（派出去的子代理跑到哪一步一眼可见）。**提醒**：安装脚本会改动本机配置文件，执行前先看一眼源码；主用 TUI 的可以直接跳过

**选装建议（生活所给的，值得抄）**：DSH 界面有 Desktop/TUI/Web 三个版本，**选定一个常用就够了**，三套一起折腾容易把配置弄乱。确定界面后再加 market + web-ui + at-file 这一档；ModLens 遇到看图场景再装，better-sidebar 开始认真写代码再补。社区每周冒出上千个新仓库，**注意力别跟着星标跑**——先把五个装稳，已经比 90% 的用户快了。

> 想自己写插件、搞懂框架是怎么组装的？源码级内容已独立成篇：[《DeepSeek Harness 进阶：profile/bundle/patch 与插件开发契约》](/posts/ai/dsh-dev-guide/)。

## 彩蛋：B 站大肥鱼——养一条替你刷 B 站的 Agent

源宝后来又出了一篇续作，讲的是前段时间很火的"B 站鱼灾"背后的玩法。原理不复杂：社区插件 **dsh-bili-whale** 让 DSH Agent 替你搜索视频、读取字幕、分析内容，按你的兴趣筛选出值得看的，再通过评论区 @ 或私信汇报。配套的 **dsh-dafeiyu** 桌宠插件则让一条蓝色大肥鱼出现在桌面上，随 Harness 的工作状态切换动画（思考、改文件、执行、等待、完成）。

配置要点（完整教程见原文）：装完插件**必须完全重启** Harness 才生效；注入"鱼设"和兴趣偏好（喜欢什么、讨厌标题党、推荐时要说清内容与不足）；**主人号与鱼号必须分离**，鱼号单独扫码授权；跑一次依赖体检（缺 ffmpeg 只影响看画面，字幕/简介/评论功能正常）。

三条安全提醒，是"鱼灾"争议换来的教训，比玩法本身更值钱：

1. **先保守再放开**：初期关闭自动评论、公开 @、陌生人互动，保持低频运行
2. **分享方式选私信，别选公开评论区 @**——大规模自动化账号跑到公开评论区汇报工作，就是这次鱼灾引起争议的直接原因
3. **不要购买来源不明的 B 站账号**，容易暴露隐私

配套生态还有个 **dafeiyu-cleaner** 浏览器扩展：识别评论区里疑似 AI 驱动的账号（给理由，可申诉"是人类"），一键隐藏或"响指清场"。注意它只在**你自己的浏览器**里隐藏评论，别人照常能看到；AI 评论识别也不是百分百准确——有些真人写的就是很像 AI。

教程最后是整活环节：用即梦（Seedance 模型）先原创生成大肥鱼角色立绘，再与真实书桌照片合成，最后做 15 秒短剧——大肥鱼嫌写作麻烦，"叫来两个外援"：Claude 小狐狸负责整理思路，Codex 负责执行，本鱼负责摸鱼。想整活的直接看原文抄提示词。

## 运维视角：验证过的版本、组合建议与故障排查

舒文的这篇更偏运维手册——前面榜单告诉你装什么，这篇告诉你装了之后怎么管理、怎么排查。全部插件给出了已验证版本号（dshmarket 1.21.0、dsh-extension-hub 0.2.19、dsh-better-sidebar 0.16.0、dsh-message-edit 0.2.3 等）。

**增量插件（前文未提的）**：

- **dsh-extension-hub**：Skill、MCP Server、Plugin 三类扩展的统一可视化管理——创建/启停/编辑，还能**导入 Claude Code、Codex 的配置**。管理量大才有必要装
- **@hytime/dsh-thinking-effort**：用 `llm-pi-ai` 接第三方模型时的刚需——模型没声明 `reasoningEfforts` 会报 `UNSUPPORTED_REASONING_EFFORT` 或没有思考强度选择器，它扫模型配置补齐 off/high/max 档位。注意三环节链：**DSH 档位 → 网关值 → 模型能力**，DSH 支持不代表网关和模型接受
- **dsh-engramory**：Markdown 文件做跨会话长期记忆（MEMORY.md 索引 + 每条记忆独立文件），默认限制索引 200 行/25600 字节防止无限膨胀，数据可进私有 Git 同步。**提醒**：它与前文 dsh-noema 是同类——正好印证反例 1，记忆系统二选一；且**敏感上下文千万别提交到公共仓库**
- **dsh-any-background**：主题/背景/透明度全家桶，配置存在 `~/.dsh/.dsh-any-background-data/` 而非 localStorage——迁移环境时记得连目录一起搬

**已覆盖插件的补充细节**：dsh-better-sidebar 依赖 `node-pty`，pnpm 11 会拦截其构建脚本——安装流程是 add 之后 `cd ~/.dsh/profiles/web && pnpm approve-builds --all && pnpm rebuild node-pty` 再硬刷新（Ctrl+Shift+R），Windows 预编译二进制不可用时同样走 rebuild。页面出现两个侧边栏、日志报 `duplicate loader entry id`，查 `cordis.patch.yml` 删重复 Loader，**不要重复安装**。dsh-message-edit 的两种重试策略值得知道：`truncate`（从编辑处重新生成）与 `preserve`（保留后续输入依次重跑），采用事件溯源保存——编辑不覆盖原始事件，而是产生新会话版本。

**按场景的组合建议**：基础环境（dshmarket）/ 开发环境（better-sidebar + message-edit）/ 长期使用（engramory + message-edit）/ 第三方模型（thinking-effort）。以及原文最有价值的一句话：**插件数量只是结果，能不能把几个插件组合成稳定的工作流，才是实际使用价值。**

**通用故障排查清单**（安装没生效按序查）：插件版本与 DSH 兼容性 → 当前 Profile → 是否启用 → `cordis.patch.yml` → 浏览器缓存 → 是否需要重启 Host。修改 Profile 配置前先备份，不要为"清理"一次性删除大量条目。

## 重量级与场景化：两份新榜单的增量

生态跑得比想象快。智东西（媒体视角，综合 GitHub 星数与社区热度）和灵动Ai幻界（下篇 10 个）又各出了一份清单，重叠很小，带来一批真家伙。两条生态动向先记下：**DSH 在 GitHub 已拿下 25 万 Stars**；官方已上线**实验性的 Discover 插件发现功能**，官方插件市场在路上。另外 DeepSeek 产品负责人**崔添翼公开推荐了 better-sidebar 和 dsh-context**——与本文前两份榜单的重叠项互相印证。

### 办公与文档

**dsh-office-tools**：给模型装了八个读写 Word/Excel/PPT 的工具，一句话在工作区落下完整的 .docx/.xlsx/.pptx（标题、段落、表格、多 sheet、幻灯片备注），本机装没装 Office 都不影响。细节坑：PPT 里的图片是链接而非内嵌，挪动要连图一起带。

### 远程与自动化

- **@michengai/dsh-im-connect**：接入飞书、钉钉、企业微信、QQ、Telegram——人不在电脑前也能派活，每个聊天对应一个独立会话，中途要拍板的事在聊天里答。群聊需要 @ 它才回话
- **@michengai/dsh-automation**：与官方"到点只提醒"的日程不同，它到点**真的开一个独立会话执行任务**；不继承创建时的对话所以不会越跑越乱；无人值守时按最严档位审批

### 模型与订阅

**dsh-plugin-subscriptions**：手上有 ChatGPT、Claude、Grok、GitHub Copilot 的订阅，可以直接 OAuth 登录把它们**当模型用**，不必另外充 API，生图和视频工具也能接。注意：要配代理时在启动环境或 `$DSH_HOME/.env` 里配，**插件自带的代理关掉，两套同开会互相绊**。

### 扩展管理进阶

- **dsh-mcp-connector**：DSH 本体本来就能连 MCP，它管后面那一摊——连接器目录、一键授权（OAuth2.0 PKCE 或 API Key）、跨连接搜工具、连不上时给出诊断。需要 Node 20+
- **@michengai/dsh-agency-agents**：321 个专业角色、22 个分类，五个内置专家团开箱可用；主会话汇总交付
- **@noob-stupid/dsh-plugin-console**：插件门控中心——升级前全树检查点、失败自动全树回滚、新框架带不动的插件强制禁用并等适配解锁、支持私有 registry 断网安装。DSH 一两周一个版本，撞上"插件跟不上本体"是迟早的事，这一个是保险丝
- **dsh-config-manager**：配置搬家——模型/插件/MCP/技能/AGENTS.md 打包成 zip，新机器导入即恢复，失效绝对路径自动重映射；密钥默认**不**打进包里

### 长任务与记忆的外挂

- **Planning with Files**：把任务计划、研究发现、执行进度写进文件，会话中断或上下文压缩后靠文件恢复进度——不用每次重新交代背景
- **OpenViking**：火山引擎开源（约 4 万 Stars）的 Agent 记忆与知识检索系统，提供 DSH 专用插件；接入门槛较高，需要额外配置服务端

### 重量级外部项目接入

- **OpenDesign**：10.3 万 Stars 的开源 AI 设计工作台，通过运行时适配组件调用本机已装的 DSH 参与设计工作流
- **Reactive Resume**：4 万+ Stars 的开源简历工具，经 MCP 接入——对话里读简历、按岗位改经历、保存结果
- **DeepSeek Reasonix**：独立 AI 编程 Agent，经 ACP 协议以**子代理**身份接受 DSH 分配的任务（已对 0.2.1-rc.2 验证）
- **DSH Desktop**：社区独立做的桌面客户端（窗口 + 终端集成 + 插件管理），兼容性取决于所搭载的运行时版本

风险提醒（灵动篇的原话精神）：这几个动得更深的插件——写工作区文件的、打包整套环境的、能改框架版本的——装之前看一眼**出自谁手、最近更新是什么时候**。

## 写在最后

两点整理时发现的事，装之前值得知道：

1. **原文的部分安装命令有笔误**——比如第 7 条（auto-approval）的安装命令复制成了第 6 条 notification 的 URL，另一条命令里的版本号也有拼写错误。装之前务必对照插件自己的仓库核实，或者干脆用 dsh-market 搜着装
2. **权限分级要自己定**：作者的建议是读操作自动允许、写操作主动询问、删除直接拒绝——这与上篇安装教程里的权限等级设置一脉相承

另一个感受：DSH 的插件生态形状和 VSCode/OBS 很像——一个框架 + 社区填空。20 个里真正解决"日常高频痛点"的，其实是 filesnap（状态回退）、context（Token 可见）和 at-file（输入效率）这类"顺"字诀工具，而不是那些炫的。

## 参考资料

- 原文一：[DeepSeek Harness 必装 20 个插件 — 源宝@Git源宝（微信公众号）](https://mp.weixin.qq.com/s/s5lKCNVKR5W4bEwiG0M4QQ)
- 原文二：[DSH必装的五大插件，装完直接起飞 — 生活所（微信公众号）](https://mp.weixin.qq.com/s/Dprbvn4-Xyi3NSVI44hOvQ)
- 原文三：[Deepseek Harness 大肥鱼【完整版教程】 — 源宝@Git源宝（微信公众号）](https://mp.weixin.qq.com/s/zDfpNN6z5Diqi8c6dXRo4w)
- 原文四：[DeepSeek Harness 插件推荐与使用说明 — 舒文@编程拾录（微信公众号）](https://mp.weixin.qq.com/s/sTcdmeHJgkIcNu3ZqkL-tg)
- 原文五：[DeepSeek Harness 不可错过的 12 款神器 — 江宇@智东西（微信公众号）](https://mp.weixin.qq.com/s/k9qYa9aeKMVZc0vvV45_gw)
- 原文六：[DeepSeek Harness 进阶使用指南｜二十个必装插件（下） — 灵动Ai幻界（微信公众号）](https://mp.weixin.qq.com/s/Ovrkbtx7VqQrY3NjbPDvug)
- 站内相关：[《DeepSeek Harness 安装入门精读》](/posts/ai/deepseek-harness/)、[《Claude Code 应用与实践精读》](/posts/ai/claude-code-playbook/)
