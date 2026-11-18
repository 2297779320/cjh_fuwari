---
title: Hermes 自动化十配置精读：让它睡觉时也在干活
published: 2026-11-04
description: '精读《让Hermes全自动工作的10个配置》：网页变化监控、无模型健康检查、晨报与备份、邮件分流、continuity、按任务绑模型、备用链与凭证池、审批建议。'
image: 'https://www.loliapi.com/bg/'
tags: [AI Agent, Hermes, 自动化, cron]
category: 'AI'
draft: false
lang: 'zh-CN'
---

Hermes 系列第五篇——精读搞机小帅的《让Hermes全自动工作的10个配置》。开头那句判断很准：**大多数人把 Hermes 当聊天应用用**——打开、问、等、关掉。它本可以在你睡觉时干的事（检查、观察、备份、绘图）全得等你想起来问。

这十个配置的共同哲学更值得先记：**大多数设置根本不调用模型**。能用脚本解决的用脚本，能先比对再决定要不要叫模型的先比对——只在必要时花钱。前提：Hermes v0.22+，已连接一个聊天应用（原文示例用 Telegram）。

## cron 语法速读

命令里引号开头的五段依次是：分钟、小时、日、月、星期几。`0 8 * * *` 每天 8:00；`0 9 * * 1` 每周一 9:00；`0 */6 * * *` 每 6 小时一次。

## 01 网页变化监控：没变就不花钱

```bash
hermes cron create "0 */6 * * *" "Tell me what changed" \
  --monitor-url https://example.com/pricing --deliver telegram
```

**原理**：每次运行先抓页面，与上次**逐字节比对**；相同就结束，不计模型成本；只有变了才唤醒模型并把差异交给它。适合：产品价格页、GitHub Release 页、签证/预约时段、竞对定价。

**坑**：每次加载都会变的页面（时钟、"最后更新"时间戳、轮换广告）会永远显示"变了"——用 `--monitor-script` 只提取你关心的部分，且**输出里不要含时间戳**。

## 02 手机上的晨间简报

```bash
hermes cron create "0 8 * * *" "Brief me: calendar, email that needs me, weather" \
  --skill google-workspace --deliver telegram
```

每天 8 点，用挂载的技能重新开一次会话，把日历、真正需要处理的邮件、天气汇成一条简短消息（替代起床后连开四个 App 的 15 分钟）。

**坑**：提示要短而具体（"3 个要点，80 字以内"），模糊的提示等于让它早上 8 点写论文。

## 03 免费的健康检查（完全不调模型）

```bash
hermes cron create "10 9 * * *" --script check_keys.py --no-agent --deliver telegram
```

`--no-agent` 意味着**没有模型**，Hermes 只是调度器：运行 `~/.hermes/scripts/` 下的脚本（.sh 用 bash，其余用 Python），把输出原样发给你。**空输出 = 静音**——脚本平时保持沉默，出问题时才打印一句话。

适合：API 密钥过期、磁盘空间、本该返回 200 的网站、夜里该生成却没生成的产物。**坑**：脚本里别打印任何"成功"字样，否则每天收到一条废话。

## 04 每晚备份

```bash
hermes cron create "0 3 * * *" --script backup.py --no-agent
```

和 03 同款无模型模式，不写 `--deliver` 结果就留在本地，`hermes cron list` 查看每次运行。**坑**：信任之前先手工跑一次——**悄悄没备份的备份任务比没有备份更糟**。

## 05 邮件分流：只起草，不发送

```bash
hermes cron create "0 9 * * 1" "Who's still waiting on me? Drafts only." \
  --skill email-inbox-triage --deliver telegram
```

每周一 9 点，读最近的邮件线程（**读整个线程而不是最新一封**），区分"我欠别人的"和"我在等别人的"，每条结论附上出处引用方便核对，草稿留在聊天里——**从不发送**。

**坑**：需要一个邮件连接（Himalaya 或 Google Workspace），且邮件正文会发送给模型提供商；发送前逐条读草稿。

## 06 --continuity：记得上次的任务

```bash
hermes cron create "0 18 * * *" "Update my project log from today" --continuity
```

每次运行时，**上一次的输出会被加进提示**，任务可以跳过已报告过的内容、从中断处继续——修掉"每天重复同样的新发现"这个通病。

**坑**：只记住该任务的最后一次产出，不是你的全部历史；长期事实要靠 Hermes 记忆或任务自己写文件。

## 07 按任务绑定模型（省钱）

```bash
hermes cron create "0 * * * *" "Summarize new issues" --model your-cheap-model
```

默认所有任务都用你的主模型——主模型是高端货的话，所有例行摘要都按高端价计费。`--model` 把该任务锁在指定模型上（必要时加 `--provider`），正常聊天仍用主模型；`--pin` 则是把当前主模型固定下来，以后换主模型这任务不受影响。

**坑**：太小的模型在难任务上会漏东西，难的活儿留给高端模型。

## 08 备用模型链（凌晨 3 点没人重试）

```bash
hermes fallback add      # 交互式添加
hermes fallback list     # 看链
```

主模型因限流、过载或连接错误失败时，按顺序尝试备用链里的下一个。**坑**：备用是不同厂商，答案风格会有差异——把**你信任的**型号放第二位，而不是只挑最便宜的。

## 09 凭证池：同厂商多密钥轮换

```bash
hermes auth add openrouter   # 每个额外密钥执行一次
hermes auth list             # 查看各池中的密钥
```

同一厂商的多个 API key 组成一个池，某个碰到限流或配额上限就轮换到下一个健康的，池全用完才走 08 的备用链。

**坑**：**提示缓存属于单个 key**——会话中途换 key，下一个请求会以全价重读整个历史。轮换让你不停摆，但不是免费的。

## 10 审批建议：不再重复点"同意"

```bash
hermes approvals suggest            # 默认扫过去 90 天
hermes approvals apply 1,3          # 按编号批量应用
```

扫描会话历史，把**你批准过至少两次**的同类命令列成编号清单；破坏性类型（递归删除、sudo、磁盘写入、凭据编辑）**永远不会被建议**。

**坑**：只批"闭着眼睛也敢批"的那些，其余继续走询问——那正是设计目的。

## 从这三个开始

1. **01 网页监控**：让 Hermes 为你干活最便宜的方式
2. **03 健康检查**：零模型，只在坏了时说话
3. **08 备用模型**：让其他一切不至于因一次限流全停

平时用 `hermes cron list` 看全部任务，每周跑一次 `hermes cron doctor` 抓有问题的任务。

## 写在最后

这篇的价值不在十个命令，而在那条成本纪律：**能用脚本就不用模型，能先比对就先比对，钱只花在"真的变了"这件事上**。这比任何"全自动"话术都实在。

对照站内 Hermes 系列：[生态五项目](/posts/ai/hermes-ecosystem/)是基础设施，[多 Agent 方案](/posts/ai/hermes-multi-agent/)是组队，[技能与插件](/posts/ai/hermes-skills/)是装本事，[OMH](/posts/ai/omh/)是编排大任务，本篇是让它在无人值守时保持运转——五篇合起来，Hermes 从聊天工具到"数字同事"的路径就完整了。

## 参考资料

- 原文：[让Hermes全自动工作的10个配置 — gjxs@搞机小帅（微信公众号）](https://mp.weixin.qq.com/s/T49H9pRjLghK1EuJewjQcg)
- 站内相关：[《Hermes 技能与插件精读》](/posts/ai/hermes-skills/)、[《Hermes 多 Agent 方案精读》](/posts/ai/hermes-multi-agent/)、[《Hermes 生态五项目精读》](/posts/ai/hermes-ecosystem/)、[《Oh My Hermes 编排精读》](/posts/ai/omh/)