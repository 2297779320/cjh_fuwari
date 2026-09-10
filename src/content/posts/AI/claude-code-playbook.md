---
title: Claude Code 应用与实践：图解专栏精读笔记
published: 2026-09-10
description: '精读小林coding《图解 Claude Code》专栏实践技巧方向的 5 篇文章，提炼 CLAUDE.md、大代码库、Skill、SDD、需求盘问工具的精华要点。'
image: 'https://www.loliapi.com/bg/'
tags: [Claude Code, AI编程]
category: 'AI'
draft: false
lang: 'zh-CN'
---

最近精读了小林coding的《图解 Claude Code》专栏里"实践技巧"方向的 5 篇文章。这个系列的特点是一手信源扎实（基本都是对 Anthropic 官方博客和 Claude Code 创始人 Boris Cherny 分享的解读），配上实测数据。

这篇笔记把 5 篇文章的干货按我自己的理解重新组织，观点和实测数据归原作者，原文链接统一放在文末。想看完整论述的建议直接读原专栏，这里只留精华。

## 一、CLAUDE.md：给 Agent 的入职手册，不是给人的 README

写 CLAUDE.md 之前先问自己：这句话是给人看的，还是给模型看的？给人看的留给 README。

**行数与遵守率的关系是反直觉的**：

| 配置 | 规则遵守率 |
| --- | --- |
| 单文件 200 行以内 | ~92% |
| 单文件 400 行以上 | 明显下滑 |
| 拆成多个 30 行模块放 `.claude/rules/` | ~96% |

原因有二：一是 token 经济——CLAUDE.md 每次会话启动都全文进上下文，写越长越挤压有效工作空间；二是注意力稀释——规则越多，每条规则分到的权重越少。

三类典型的"负资产"内容，见到就删：

- **复述型**：把项目架构文档整段搬进来。架构会过时，正确做法是一行指针："架构详见 docs/architecture.md"
- **愿望型**："希望测试覆盖率达到 90%"。模型没法判断愿望与现实的差距，只会写规则："提交前必须跑 npm test"
- **术语表型**：Repo、PR 这种通用术语它本来就知道，真正要解释的是团队黑话，但黑话也建议放 docs 里

三条铁律：**具体可验证、说明 why、持续更新**。工作流上用 `/init` 起步、`/memory` 维护，判断标准是"Claude 同一个错犯两次以上就加一条规则"。作者建议项目根文件控制在 80 行以内。

## 二、大代码库：harness 比模型重要

Context 频繁爆掉，多数人的第一反应是换更强的模型——官方答案是不管用，问题出在"怎么找代码"。

Claude Code 不走 RAG 路线（没有 embedding、没有向量库），而是让模型像人一样探索：看目录 → grep → 读文件 → 决定下一步。官方管这叫 **agentic search**，选它的理由：索引永远不过期、零冷启动、精确匹配比向量召回可靠。代价是它严重依赖一个好的起点 context——所以"context 爆"的本质是起点没给好。

由此引出全文核心论点：**The harness matters as much as the model**。围绕模型搭的外围基建（CLAUDE.md → Hooks → Skills → Plugins → MCP，外加 LSP 和子 agent）对最终效果的影响不亚于模型本身。

如果只做三件 ROI 最高的事：

1. **CLAUDE.md 砍到 200 行以内**，根目录只放指针和关键的坑，模块细节下沉到子目录的 CLAUDE.md（启动时会自动向上加载）
2. **在子目录启动 Claude**，而不是仓库根目录——context 直接聚焦到要改的领域
3. **装 LSP 插件**——从字符串 grep 升级为按符号搜索，多语言大代码库里这是官方认证的"最高价值投资之一"

跨几十个文件的大改动，解法不是写更长的 prompt，而是**拆会话 + 子 agent**：派 subagent 去探索并回传简短报告，主 agent 保持干净 context 动手；更大规模的迁移用 `/batch`，并行子 agent 各自在独立 git worktree 里跑完自测开 PR。

团队推广的正确顺序：好实践做成 skill → plugin 打包分发 → 最后才接 MCP（顺序别反，地基没打好 MCP 只会带来噪音）→ 必须有人维护（官方观察到的新角色叫 Agent Manager）。

也要泼冷水：Claude Code 擅长的是"Git + 工程师 + 标准目录结构"这个最大公约数。大量二进制资产的游戏项目、Perforce/SVN 等非常规版本控制、非工程师主导的代码库，都不在它的舒适区。

## 三、Skill：是文件夹，不是文件

对 Skill 最大的误解是"就是一份 markdown"。官方定义它是一个**文件夹**：SKILL.md 是唯一必需品，周围可以放参考资料、可执行脚本、输出模板——模型干到哪一步需要什么，自己去文件夹里翻。

**为什么你写的 Skill 从来不被触发？** 答案在源码里：会话启动时只把每个 skill 的名字和 description 注入上下文，正文要等调用时才懒加载（渐进式披露）。两个苛刻的预算——整张 skill 清单只占 context 的 **1%**，单条 description 上限 **250 字符**，超了直接截断。所以 description 不是写给人的摘要，是写给模型的触发条件："当用户要做数据库迁移、改表结构或遇到 migration 报错时使用"，而不是"帮助处理数据库相关工作"。

正文的黄金法则：**只写模型从代码里推断不出来的信息**。含金量最高的是坑点清单（Gotchas）——"这个字段在网关叫 @request_id，在计费服务叫 trace_id，是同一个值"这种只有踩过坑才知道的东西。反过来，"写完代码要跑测试"这种它默认就会的事，写了纯属噪音。但也别把步骤写死到把模型锁死在轨道上，给足信息、留足自由。

三个高阶玩法：

- **自带记忆**：把执行历史存在 skill 自己的文件夹里（升级不丢失），日报类 skill 就能只汇报增量
- **预制脚本**：底层操作封装成现成函数，模型的每一回合花在"组合哪几个函数"而不是重新造轮子
- **临时 hook**：只在 skill 激活期间生效——比如激活后才拦截危险命令、或冻结指定目录之外的文件修改

如果只能做一件事，Anthropic 内部实测的结论是：**先做验证类 skill**。让 Claude 能自己确认工作成果（跑无头浏览器逐步断言、看 UI 实际效果），是对输出质量提升最明显的投入。

## 四、SDD：先把要做成什么样讲清楚，再动手

vibe coding（想到哪说到哪）做小玩具很爽，但项目一大就开始"越改越乱"——根子不是模型笨，是你从来没给过它一张完整的图，它手里只有一堆碎片。

规约驱动开发（SDD）就是把对齐过程拆成台阶，每步产物都看得见、能拦：

```
/speckit-specify   # 只谈需求：做什么、为什么，不提任何技术词
/speckit-plan      # 再谈技术：基于需求文档产出实现方案
/speckit-tasks     # 拆任务：方案变成一条条可执行的小活
/speckit-implement # 最后才写代码
```

工具是 GitHub 官方的 spec-kit。两条兜底命令值得单独记住：`/speckit-clarify` 在定方案前把需求文档里的含糊点逐个反问清楚；`/speckit-analyze` 在写代码前交叉比对需求、方案、任务清单，找出互相打架的地方。

这不是瀑布流复辟：瀑布流的文档是一次定死扛着往前走，SDD 的规约是随时能回去改的活共识，改完几秒钟就能重新生成后续产物。判断要不要用的标准很简单——**这个东西你打算长期维护吗？是就值得立规约，一次性脚本就 vibe coding 一把梭**。

作者实测一个团队看板项目四步一次跑通零 bug，但提醒项目大了要分阶段 implement，别指望一条命令全撸完。

## 五、superpowers vs grill-me：问完之后，活归谁

同一句模糊需求（网页版地铁跑酷小游戏）丢给同一个模型，只换需求盘问工具，结果差了一个次元——根因不在模型能力，在**关键决定谁来做主**。

| | grill-me | superpowers (brainstorming) |
| --- | --- | --- |
| 提问方式 | 12 问，一次一问，每问带推荐答案 | 4 问选项卡片，其余用合理默认值补齐 |
| 美术风格 | 专门问一轮，作者否了一次推荐 | 打包进选项说明的半句话，替你定了 |
| 留下的东西 | 只有代码，设计共识只活在对话里 | 设计文档 + 任务计划 + TDD 测试 + 14 个 git 提交 |
| 耗时 | 32 分钟 | 约 2 小时 |

grill-me 是手术刀：把每个决定逼到你面前亲手拍板，问完就走不留痕，轻、不侵入、不改你的习惯。superpowers 是工程经理：问完才刚开始，spec 文档、实施计划、强制测试先行、子代理实现再派子代理审查一整条流水线，代价是改个小东西也要走全套流程。

作者的结论：**大多数人先装 grill-me**，日常"grill-me 捋清想法 + Plan Mode 开干"够用；正经项目、返工代价高、需要 paper trail 的时候上 superpowers。

一句话总结：**grill-me 问完，活还是你的；superpowers 问完，活就是它的了。**

## 写在最后

5 篇读下来有一条暗线：AI 编程的瓶颈正在从"模型够不够强"转移到"你能不能把事情讲清楚、把环境搭好"。CLAUDE.md 要瘦、harness 要搭、skill 要少而精、规约要先立——全都是在给模型一个能发力的起点。

对照自己：这个博客根目录的 AGENTS.md 我刚精简过（构建链路 + 架构要点 + 坑点），正好踩中"200 行黄金线"；grill-me 这个 skill 我自己也在用，上面的 Q&A 流程就是它跑出来的。

## 参考资料

- 专栏索引：[图解 Claude Code | 小林面试笔记](https://xiaolinnote.com/claudecode/)
- [CLAUDE.md 指南](https://xiaolinnote.com/claudecode/playbook/cc_claude_md.html)
- [Claude Code 大型代码库实战](https://xiaolinnote.com/claudecode/playbook/cc_large_codebase.html)
- [Claude Code Skill 揭秘](https://xiaolinnote.com/claudecode/playbook/cc_skills.html)
- [SDD 规约驱动开发实战](https://xiaolinnote.com/claudecode/playbook/spec_driven_dev.html)
- [superpowers vs grill-me 实测](https://xiaolinnote.com/claudecode/playbook/superpowers_vs_grillme.html)

专栏所引用的一手信源（Anthropic 官方博客、Boris Cherny 分享等）在上述原文的参考资料区均可找到。
