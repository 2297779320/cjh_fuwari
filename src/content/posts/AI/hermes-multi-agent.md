---
title: Hermes 多 Agent 方案精读：一个 profile 一个 Bot
published: 2026-09-30
description: '精读《Hermes 多Agent方案》：profile-per-Bot 的分工模型、桌面版 Bots 界面、无界面环境的 profile+网关路线、飞书/企微/个人微信群聊协作对比，以及三人视频团队的 5 步实操与 --clone 排坑。'
image: 'https://www.loliapi.com/bg/'
tags: [AI Agent, Hermes, 多Agent, 飞书]
category: 'AI'
draft: false
lang: 'zh-CN'
---

AI 分类的 Hermes 系列再添一篇——精读「人人都在学AI」的《Hermes 多Agent方案》。核心模型一句话：**一个 profile 一个 Bot**。Hermes 同时跑几个 Agent，记忆、技能、模型各归各的；几个 Bot 拉进同一个飞书群，互相 @ 就能搭伙，凑成一个「秘书团」。观点归原作者，原文见文末。

对照站内已有的多 Agent 内容：这篇讲的是**框架原生的多 Bot 分工**，[《Oh My Hermes 精读》](/posts/ai/omh/)讲的是**加在上面的编排层**（DAG 拆任务、按分类路由模型）——一个是「招同事」，一个是「当项目经理」，正好是两个层次。

## 一、什么时候一个 Agent 不够用

单 Agent 适合把一件事快速搞定；多 Agent 适合把它做好、做得可控、也方便协作。理由有三层：

1. **事情做大自然会裂成几段**，每段需要的能力、思维方式和判断标准都不一样，让一个 Agent 从头跟到尾等于让它同时扮演好几种角色
2. **拆开后每个 Agent 只管一件事**，上下文更干净，决策更聚焦
3. **过程透明**：每一步都看得见，你在任何一环都能插手——检查、改掉、重新指派，不必整段推倒重来

## 二、桌面版：Bots 界面（v0.20.3+ 内置）

Bot Mode 只在桌面版里，从 **v0.20.3 起正式捆进桌面应用**——装好就是开着的，不需要单独装插件；开关在 Settings → Plugins → Bots。界面一共几样：

- 左侧 **Bots 花名册**，每个 Bot 都在列
- 能长期保存的 **Bot Chat**
- **Routines 面板**（例程）
- **群聊协作**，Bot 之间 **@mention** 互相发消息
- 每个 Bot 有自己的头像

作者吐槽了一个产品矛盾挺有意思：用 Hermes 图的是 24 小时值守，桌面版偏又跑在你常开的那台电脑上——**人机交互比重最大的形态，偏偏只有桌面版带 Bots 界面**。（Web UI 另算，那是社区方案，后续文章再说。）

## 三、没界面也照样跑：profile + 网关

CLI、VPS、服务器、Docker、任何没有图形界面的机器，都没有 Bots 那套界面——**但能力一块不少**。

关键机制：**一个 Bot 就是一个独立的 profile**，落在 `~/.hermes/profiles/[name]/` 下。记忆、技能、模型、SOUL.md、会话，各是各的，互不打扰。两条路的选择很干脆：

- **桌面版**：有 Bots 界面也有多 Agent 能力，直接用 Bots 标签页
- **CLI / 服务器**：没有界面，多 Agent 能力一样在——靠 profile 加网关，再接飞书

## 四、群聊协作：三平台怎么选

| | 飞书 | 企业微信 | 个人微信 |
| --- | --- | --- | --- |
| 接入方式 | 官方 API | 官方 API | 非官方 iLink |
| 封号风险 | 几乎无 | 低 | **有封号和掉线风险** |
| 多 Bot 群协作 | **最强**，互相 @ 即可 | 一般 | 支持差，不太靠得住 |
| 消息能力 | 卡片/合并/编辑/Markdown/流式全有 | 基础消息、文件、语音不错 | 以纯文本为主，最弱 |
| 配置门槛 | 中等，需管理员权限 | 相对简单（AI Bot 模式） | 扫码即接，最简单 |
| 适合 | 个人、小团队多 Agent 协作首选 | 公司已重度用企微、想快上线 | 仅个人临时试 |

选择逻辑只有两条：**本来用的是哪个平台、打算拉几个人进来**。社区反馈里，飞书的确认机制做得最完善，目前是多 Agent 群聊体验最好的选择。

## 五、个人飞书的边界

个人飞书账号能做的事比想象中少一截，坦白列出来：

| 用法 | 是否够用 |
| --- | --- |
| 自己私聊 Hermes | 完全够用 |
| 自己建内部群加几个机器人 | 基本可用，可拿来自测多 Agent |
| 拉外部朋友/同事进群协作 | **明显受限**，最大不足 |
| 正式长期小团队用 | 勉强，建议升企业/团队版 |
| 以后扩展多用户 | 扩展性差，不建议当长期主通道 |

卡点集中在五处：外部群和外部用户支持受限、应用可见范围受限、多 Agent 与团队协作场景不友好、权限与发布流程不如企业账号、API 调用额度不够——加上管理与扩展性、稳定性的局限。**能走到哪一步清楚了，再决定要不要升级。**

## 六、把 Bot 串进一个群：五步

1. 在飞书里创建机器人
2. 在 Hermes 里创建 profile
3. 把每个 profile 接到对应的飞书机器人上
4. 每个网关都启动起来
5. 建群，把机器人一个个拉进去

原文说得好：五步写下来没几行，真配起来卡人的全在字缝里（原文预告有下一篇逐步骤配置）。

## 七、手把手五步：组一个三人视频团队

原文的续篇把这里走了一遍，目标团队：内容策划（videoplanner）、脚本编剧（scriptwriter）、视频导演（videodirector）。

**第一步：飞书建机器人**。open.feishu.cn/app 创建应用有两条路——从空白开始（权限、事件都要手动配），或从**智能体模板**开始（模板预置了智能体所需的权限和事件，官方列出的例子里就有 Hermes Agent）。点头像、填名称、创建，记下 **App ID 和 App Secret**。照做三遍凑齐三个。

**第二步：建 profile**。`hermes profile create <name>` 空白创建；`--clone` 复制 default 的配置、.env、SOUL.md 和技能。**但作者强烈建议空白创建**——因为 default 连的是微信，clone 会把这些残留全带过来。

**第三步：三个 Bot 分开养**。clone 出来的三份内容一模一样，要改：SOUL.md 改人格（不会写可以让 DeepSeek/Grok 生成）；memories 里的 MEMORY.md 清空（或只留一行记忆标题），USER.md 也可让 AI 生成；skills **别直接删**——进 Web 仪表盘的多 AGENT 配置按角色禁用用不上的；其余文件夹清空。

**第四步：清 --clone 的残留（这篇最值钱的部分）**。要清两处：profile 里的 `weixin/` 缓存目录、`.env` 里的 `WEIXIN_` 字段（`sed -i '/^WEIXIN_/d'`）；启动前还有两处坑——`channel_directory.json` 和 `gateway_state.json` 存着 clone 来的微信连接状态（可放心删，会重建），以及 **api_server 端口和 default 冲突**（改端口，或用不上直接 `platforms.api_server.enabled false`）。

**第五步：接飞书 → 启动 → 配对**。`hermes -p <name> gateway setup` 选飞书，**手动**填已建好的 App ID/Secret（不选扫码新建）；Domain 选 feishu、Connection Mode 选 websocket、私聊选配对模式（都是默认值直接回车），**群聊一定选「@ 时回复」**；打印 `Feishu / Lark configured` 后 `hermes -p <name> gateway start`，用 `hermes gateway list` / `hermes profile list` 查状态。然后去飞书给机器人发消息拿到配对码，回 `hermes -p <name> pairing approve feishu XXXXXXXX` 批准，再按提示输 `/sethome`——之后的定时任务和跨平台消息都会发到这个对话框。

最后在飞书建群，进群设置的群机器人里把三个都加上。**群里必须 @ 对应机器人她才回**；三个 Bot 各带自己的记忆、技能、人格，@ 谁谁答。原文提到多 Agent 协作有两种走法：流水线式，或多智能体同时处理单个文件。

## 写在最后

两种多 Agent 路线现在能一眼分清了：**Hermes 原生方案 = 招一群各管一摊的同事**（profile-per-Bot、群聊协作、人工插手每一环）；**OMH = 给一个目标配项目经理**（DAG 拆解、并行 lane、证据化验收）。前者适合长期值守、职责固定的团队结构，后者适合一次性大任务的并行交付——而且两者可以叠着用。

## 参考资料

- 原文一：[Hermes 多Agent方案 — 人人都在学AI（微信公众号）](https://mp.weixin.qq.com/s/Bc8PbaAq_4DD9cl6OQOQ2w)
- 原文二：[创建Hermes多Agent团队 — 人人都在学AI（微信公众号）](https://mp.weixin.qq.com/s/n82Eu_4XXI33ujbddoqPxg)
- 站内相关：[《Oh My Hermes 编排精读》](/posts/ai/omh/)、[《Hermes 生态五项目精读》](/posts/ai/hermes-ecosystem/)、[《DeepSeek Harness 进阶精读》](/posts/ai/dsh-dev-guide/)