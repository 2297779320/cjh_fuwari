---
title: DeepSeek Harness 进阶：profile/bundle/patch 与插件开发契约
published: 2026-10-08
description: '精读云朵君《DeepSeek Harness 保姆级使用教程》（基于官方 0.1.2-alpha.1 源码）：profile/bundle/patch 组装模型、插件开发契约（inject/effect/defineTool）、seam 三角色、headless 与 Python SDK，以及六条真实边界。'
image: 'https://www.loliapi.com/bg/'
tags: [DeepSeek, AI Agent, DSH, TypeScript, 插件开发]
category: 'AI'
draft: false
lang: 'zh-CN'
---

装插件（见[《插件生态精读》](/posts/ai/dsh-plugins/)）是用户视角，这篇切到开发者视角——精读云朵君@数据STUDIO 的《DeepSeek Harness 保姆级使用教程》。它是五篇 DSH 文章里最硬核的一篇：基于官方源码快照 `0.1.2-alpha.1`（开发者预览），目标是走通"**装 → 配 → 跑 → 写插件 → 加载 → 批处理**"的完整闭环。观点归原作者，原文见文末。

## 四个核心概念：一切皆插件

一台跑起来的 dsh，本质是一棵"插件树"，启动时按固定层叠顺序组装：

```text
profile 中的每个 bundle（按声明顺序）
  → profile 自己的 cordis.patch.yml
  → home 级 $DSH_HOME/cordis.patch.yml
  → 命令行 --patch 覆盖层
```

- **profile**：具名组合，内置五个模板——`web`（浏览器 UI）、`headless`（一次性任务）、`sdk`、`sdk-minimal`、`acp`
- **bundle**：分发包，如 `@deepseek-ai/dsh-base`（模型接入 + 工具集 + 会话 + 沙箱）、`@deepseek-ai/dsh-web-app`（追加浏览器应用）
- **patch**：按 id "改一行/插一行"的 YAML——插件路径必须绝对路径，替换的是目标行的整个 config 而非深度合并

用 `dsh --profile web --dump-config` 能打印这台机器实际装配出的插件树，每一行都是"id + 包名 + config"——**模型、工具、会话、agent 循环全是一排可以 patch 的插件行**，这就是"一切皆插件"最直观的现场。

## 插件开发：三条设计规则

一个插件就是导出 `apply(ctx)` 的 TypeScript 模块。原文里最有价值的是三条约定：

1. **inject 声明依赖**：Cordis 会等声明的 service（如 `tools`、`llm`）全部就绪才加载你的插件——apply 里**不用判空**
2. **ctx.effect 自动清理**：凡经 ctx 注册的工具、监听、定时器，插件卸载时自动 unwind，不用手动 `removeListener`；需要显式释放的资源（网络连接等）在 effect 里返回 disposer
3. **defineTool 的 parameters 一个 schema 干三件事**：推断 args 的 TypeScript 类型、在执行前校验模型生成的参数、自动注入 system prompt

## execute 的五条契约（写之前必读）

1. **args 已校验**——拿到的参数一定过了 schema
2. **返回一个 canonical JSON 值**——不是内容块，更别让调用方解析一段散文
3. **只有基础设施故障才 throw**——非理想的业务结果（如进程非零退出）放进返回值表达
4. **尊重 `exec.signal`**——用它取消进行中的工作（读文件场景直接透传给 `readFile`）
5. **UI 卡片与 `output.render` 分离**——`presentCall`/`presentResult` 必须是纯函数，不能做 I/O

长任务不要走前台 execute，用 `ctx.jobs.start(...)` 走后台 job。工具注册是 effect 式的：插件卸载，工具自动注销，不留"还挂在那儿但没人管"的孤儿状态。

## 架构级亮点

**seam（能力缝）三角色**：Service Definition（声明契约）+ Service Provider（实现并挂到 ctx 的 key 上）+ Consumer（按 key 取用，不 import 具体实现）。原文强调"只写一个角色不算 seam，加一个能力要把三个都设计全"。硬依赖用 `inject` + 直接属性访问（缺了起不来），可选依赖用 `ctx.get(...)`（可能 undefined）。最值钱的设计是**共享执行世界**：文件系统和子进程 provider 共享同一个执行世界——沙箱 provider 指到远程环境，Bash、PTY、LSP 会一起跟着搬。

**headless 模式**：无 GUI、无 server、一次一个任务、跑完退出。输出契约写死——推理增量到 stderr（带 `dsh: reasoning:` 前缀）、最终答案到 stdout、正常 exit 0。适合脚本和 CI。但官方**未做安全审计**：等于把未审计能力放在无人值守模式，先拿它做可回滚的实验，别让它跑不可逆的批量写操作。

**Python SDK**：`deepseek-harness-sdk` 自动带上原生 runtime wheel，不需要系统 Node.js。关键坑：`dsh_home` 必须显式传——**故意不读 `~/.dsh`**，防止污染手动安装的环境。

**"Model-visible means logged"**：会话日志是 append-only 的架构级硬约束，不是事后补的仪表盘——模型看到的一切必须能从日志重建，fork、回放、telemetry 全部从这条日志流派生，运行时不变式会断言它。排查 agent 为什么犯蠢时，trace 不会被"没记"或"记不全"卡死。

## 六条真实边界（都有出处）

1. 开发者预览版（0.1.2-alpha.1），官方明示未来会有破坏兼容性变更
2. 官方自标**未接受安全审计**——"不得视为安全或可用于生产环境的软件"，沙箱、审批与权限控制**不保证隔离**
3. 没有终端 TUI，交互式使用要开浏览器（或走 headless）
4. key 和 provider 自己管；本地 Ollama/LM Studio 不在开箱路径，要走自定义 provider 配 OpenAI 兼容端点
5. 插件按包拆分，安装体积不小；迭代快，API 可能很快变
6. headless 一次只跑一个任务，不是多轮交互代理

结论：**装起来玩、读它的架构、在可回滚的环境里做实验，是对的；现在直接接生产、或对它跑不可逆批处理，时机还没到。**

## 写在最后

把 DSH 与站内几篇对照着看挺有意思：它的"一切皆插件 + Cordis 元框架"路线，比 Claude Code 的 harness 更激进——连 agent 循环本身都是可 patch 的插件行。想深挖的下一步，官方仓库的 `docs/architecture.md`、`docs/cordis-primer.md` 和 `docs/cookbook/` 是入口。

## 参考资料

- 原文：[DeepSeek Harness 保姆级使用教程 — 云朵君@数据STUDIO（微信公众号）](https://mp.weixin.qq.com/s/vykj6Tigcu2NSHABbTaSTA)
- 原文基于官方源码 `deepseek-ai/deepseek-harness` 0.1.2-alpha.1 快照，参考 `docs/architecture.md` / `docs/cordis-primer.md`
- 站内相关：[《DeepSeek Harness 插件生态精读》](/posts/ai/dsh-plugins/)、[《DeepSeek Harness 安装入门精读》](/posts/ai/deepseek-harness/)、[《Claude Code 应用与实践精读》](/posts/ai/claude-code-playbook/)
