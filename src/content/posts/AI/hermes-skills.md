---
title: Hermes 技能与插件精读：版本没来，先把本事装上
published: 2026-11-14
description: '精读 One 掌柜《Hermes Agent 先装这 53 个技能》：53 套营销技能、Google Workspace 插件、/steer 中途插话、X 书签与白板插件，以及版本节奏的判断。'
image: 'https://www.loliapi.com/bg/'
tags: [AI Agent, Hermes, 技能, 插件]
category: 'AI'
draft: false
lang: 'zh-CN'
---

AI 分类的 Hermes 系列第四篇——精读 One 掌柜（One的AI工具箱）的《Hermes Agent 先装这 53 个技能，升级没来也能干活》。这篇抓住了一个反差：**版本号没动，技能生态已经堆到能直接干活了**。观点归原作者，原文见文末。

开头的事实核对：最新稳定版还是 v0.23.1，v0.24 没出；桌面和网页的大改版在路上，手机版排队中；官方发过一张没写字的预告图（手握发光的剑），至今没有下文——作者提醒先别当已发布。

核心观点一句话：**Agent 真正拉开差距的，往往不是版本号多跳了一位，而是你给它装了哪些会干活的技能。** 以前写小红书、改淘宝详情页、排公众号，品牌、受众、语气每次都要重讲一遍；现在有人把整套办法装进去，让它按手册走，而不是每次从零编。

## 一、53 套营销技能：先装这个

作者 Corey Haines 做的开源技能库，MIT 协议，给 Hermes 的说明在 marketing-skills.com/for/hermes。要点：**不是 Nous 官方技能包**，也不是只给 Hermes 用——同一套库能装进其他支持同一标准的 Agent；GitHub 上约 6 万星是跨平台总数，别理解成 Hermes 的数据。

```bash
npx skills add coreyhaines31/marketingskills -a hermes-agent -g
```

装完先跑 `/product-marketing`，让它记下你的产品、人群和语气——后面写文案、做 SEO、看定价、做转化都读同一份笔记。写封面句、改详情页、排公众号开头，先让它按手册出一版再自己改。注意：网上传的另一条 tap 命令与作者页不完全一致，**以作者页为准**。

## 二、Google Workspace 插件：不是一键授权

作者 Franco Leff，已进官方社区插件目录，需要 v0.22.3 以上：

```bash
hermes plugins install google-workspace
```

装上后 Gmail、日历、云盘、文档、表格、通讯录在同一处处理，写操作要你点头。但必须讲清楚：**这不是一键授权**——要自己在 Google Cloud 建桌面客户端、打开对应 API、把账号加成测试用户，再 `hermes auth add google-workspace:google` 登录。作者也声明与 Google 无隶属关系。愿意配的人日常会少切好几个窗口，嫌步骤长先跳过完全没问题。

## 三、/steer：干活别打断

官方文档写得很直白：Agent 做到一半，你想起一句补充，用 `/steer` 丢进去，它会**等下一次工具调用结束后再读到**——不中断，也不新开一轮。

和另外两种操作的区别值得记：`/queue` 是排到下一轮再做；直接打断是停下来重说。`/steer` 是「顺路加一句话」。例子：它正在改一篇公众号，你补一句「开头写短一点，先给外行看」，不用重来。

（粉丝号称手机测试包 Build 44 已能用 /steer——这不是官方更新说明，先当预告听。）

## 四、X 书签插件：把收藏夹从坟场里捞出来

社区插件，作者 winch：把你收藏了却再也没打开的 X 帖子做成每周摘要，还能转成待办或技能，同步到 Notion、文档或本地。安装名 `hermes-x-bookmarks`：

```bash
hermes plugins install hermes-x-bookmarks
```

坑：**得自己准备 X 开发者应用和密钥**，不是装上就能拉书签。

## 五、白板插件：一句带过

Hermes Whiteboard 已能在桌面用：你说计划，它把路线铺开，再一站站执行。原文之前写过安装和用法，这里不重复——想先看计划长什么样，装上试即可。

## 版本节奏怎么判断

v0.23.1 官方说明里最贴近普通人的改动：**插件目录体积上限从 2 MB 提到 16 MB**（之前装插件可能悄悄用了内置的旧目录）；桌面安装包这版还没一起更新，要等下次打包。手机版官方口径还是圣诞节前「快了，但不是今天」，大改版未宣布上线。

所以这几天只盯版本号会觉得没动静；把上面几样装上，它已经能帮你写、帮你理、帮你在做到一半时听你一句。

## 写在最后

原文那句话值得抄下来：**版本是官方的节奏，技能是你自己的节奏。** 这也解释了站内几篇 Hermes 内容的互补关系——[生态五项目](/posts/ai/hermes-ecosystem/)是「装什么基础设施」，[多 Agent 方案](/posts/ai/hermes-multi-agent/)是「怎么组队」，[OMH](/posts/ai/omh/)是「怎么编排大任务」，本篇是「单个 Agent 怎么装本事」。四篇合起来才是一个完整的 Hermes 使用面。

## 参考资料

- 原文：[Hermes Agent 先装这 53 个技能，升级没来也能干活 — One 掌柜@One的AI工具箱（微信公众号）](https://mp.weixin.qq.com/s/2jZe2M4pJ0kYz8uEL0wmZw)
- 站内相关：[《Hermes 生态五项目精读》](/posts/ai/hermes-ecosystem/)、[《Hermes 多 Agent 方案精读》](/posts/ai/hermes-multi-agent/)、[《Oh My Hermes 编排精读》](/posts/ai/omh/)

## Hermes 系列导航

[生态五项目](/posts/ai/hermes-ecosystem/) · [多 Agent 方案](/posts/ai/hermes-multi-agent/) · [技能与插件](/posts/ai/hermes-skills/) · [自动化十配置](/posts/ai/hermes-automation/) · [OMH 编排](/posts/ai/omh/)
