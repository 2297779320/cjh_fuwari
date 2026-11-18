---
title: Hermes 生态五项目精读：驾驶舱、货架、编排器、手册与仪表盘
published: 2026-11-11
description: '精读 AI 小登登《炸场 Hermes 生态，这 5 个项目建议收藏》：Workspace 可视化驾驶舱、Awesome 避坑目录、OMH 编排器、橙皮书中文手册、HUD 仪表盘——按星数排列的生态全景。'
image: 'https://www.loliapi.com/bg/'
tags: [AI Agent, Hermes, 生态, 开源项目]
category: 'AI'
draft: false
lang: 'zh-CN'
---

上一篇精读的 [Oh My Hermes](/posts/ai/omh/) 是单点深挖，这篇补上「面」——精读 AI 小登登的《炸场Hermes生态，这 5 个项目建议收藏》。作者的说法很实在：Hermes 本体功能已经够强，但这些周边项目全是社区自发搞出来的、星数一个比一个高、免费开源。按星数从高到低排（数据截至 2026-11-11），观点归原作者，原文见文末。

## 一、Hermes Workspace：给 Agent 装个可视化驾驶舱（6811 星）

痛点先说透：Hermes 本体是终端 Agent，面对的是黑乎乎的命令行——它记了什么、装了多少技能、接了几个工具，全靠翻文件夹猜；想看记忆还得手写代码改文件。

Workspace 把这一切搬进一个网页工作台：聊天、文件、终端、**记忆可视化编辑**、两千多个技能的超市、MCP 服务管理，一屏收齐。最有意思的是 **Swarm 模式**——一队常驻在 tmux 里的 Agent 工人，按角色派活：写代码的、抓 Bug 的、审 PR 的、查文档的，各干各的，最后统一汇总。

工程上讲究的是**零 Fork**：不动 Hermes 一行代码，克隆下来挂上 Agent 就能跑，Docker 两分钟起飞，手机也能装成 App。

## 二、Awesome Hermes Agent：生态超市的货架清单（5985 星）

生态现在有多夸张？技能几千个、插件几百个，质量参差不齐——**装错一个，轻则白玩，重则把密钥交出去**。

这份目录就是社区做的避坑清单：把技能、插件、记忆方案一个个筛出来，每条标**三级成熟度**（生产级 / 测试版 / 实验性）。更难得的是它专门教你怎么检查**信任边界**——这个技能能执行什么命令、能读你哪些凭证、怎么一键关停。用 Hermes 三个月以上的人，迟早会感谢这份目录。

## 三、Oh My Hermes：单兵变并行团队（5249 星）

站内已有深度精读（[《Oh My Hermes 编排精读》](/posts/ai/omh/)，含 lane 模型链与 `/dag-ulw` 的完整拆解），这里只记作者点出的核心：一条 `/dag-ulw` 把目标拆成并行执行的图，每个节点自动分配合适的模型（重活走大模型、碎活走小模型、互不抢活），跑完有专职验收节点复盘。

**最狠的是它拒绝空话**：每个状态都带证据——计划了没跑、报告完成但没测试、测试真过了才算完。就冲这套证据链设计，值。

## 四、Hermes 橙皮书：中文圈的系统实战手册（5057 星）

官方文档英文、碎片化，看完还是不知道怎么上手——中文用户卡的就是最后一公里。橙皮书是花叔（全网 30 万粉的 AI 博主）写的实战手册，中文版已到第三版、跟着官方版本更新。

全书 21 章分六大板块：**它是什么、怎么自我进化、怎么记忆、怎么连接一切、怎么多 Agent 协作、怎么部署和守住安全边界**。全部配真实设备截图，官方文档没讲透的坑也写了。免费 PDF、MIT 协议。

## 五、Hermes HUD：给 Agent 装行车记录仪（1854 星）

Agent 在后台默默干活，你看不见它干了啥、花了多少钱、记了什么；想找上周那次会话得翻文件。

HUD 是个浏览器仪表盘，19 个标签页把 Agent 翻个底朝天：健康度、记账本、记忆、技能、会话、回放、任务计划。杀手锏叫 **Replay**——每次运行自动生成可分享的证据包，**敏感信息全打码、自带数字签名**，贴进 PR 就是铁证，任何人都能验真。安全上也讲究：默认只监听本地、拒绝一切外来连接。星数不算多，但懂行的明白这东西迟早要火。

## 收尾：五个项目，五个缺口

回头看，这五个项目刚好补齐 Agent 落地的五个缺口：**驾驶舱（Workspace）、货架清单（Awesome）、编排器（OMH）、手册（橙皮书）、仪表盘（HUD）**。原文那句总结我认同：Hermes 最特别的地方不是功能堆得多，而是它的缰绳会自己长——用得越多越懂你，而这些生态项目把每道缝隙都填上了。

还有一句值得抄进备忘录：**AI Agent 框架一年换一茬，追新框架不如吃透一个生态。**

## 参考资料

- 原文：[炸场Hermes生态，这 5 个项目建议在用hermes的小主们收藏起来 — AI 小登登（微信公众号）](https://mp.weixin.qq.com/s/BCUC0lobcjlKHM_N5BJTDg)
- 项目地址（按原文星数排序）：[hermes-workspace](https://github.com/outsourc-e/hermes-workspace)、[awesome-hermes-agent](https://github.com/0xNyk/awesome-hermes-agent)、[oh-my-hermes](https://github.com/rlaope/oh-my-hermes)、[hermes-agent-orange-book](https://github.com/alchaincyf/hermes-agent-orange-book)、[hermes-hudui](https://github.com/joeynyc/hermes-hudui)
- 站内相关：[《Oh My Hermes 精读》](/posts/ai/omh/)、[《DeepSeek Harness 进阶精读》](/posts/ai/dsh-dev-guide/)

## Hermes 系列导航

[生态五项目](/posts/ai/hermes-ecosystem/) · [多 Agent 方案](/posts/ai/hermes-multi-agent/) · [技能与插件](/posts/ai/hermes-skills/) · [自动化十配置](/posts/ai/hermes-automation/) · [OMH 编排](/posts/ai/omh/)
