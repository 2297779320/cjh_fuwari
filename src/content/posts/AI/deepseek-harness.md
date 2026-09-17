---
title: DeepSeek Harness 安装入门精读
published: 2026-09-17
description: '精读杨比耶《DeepSeek Harness 安装入门教程》：AI Agent = 大模型 + Harness 的核心概念、三种安装方式怎么选、API Key 配置与权限设置要点。'
image: 'https://www.loliapi.com/bg/'
tags: [DeepSeek, AI Agent, Harness]
category: 'AI'
draft: false
lang: 'zh-CN'
---

AI 分类再添一篇——杨比耶@比耶Ai落地的《DeepSeek Harness 安装入门教程》。这是一篇面向零基础的短教程（原文配大量截图），核心是讲清 Harness 概念并带读者装好一个可定制的 AI Agent。本篇提炼骨架，观点归原作者，原文链接见文末。

## Harness 是什么：骑马比喻

原文的核心概念一句话：**AI Agent = 大模型 + Harness**。大模型是野马，负责思考和生成；Harness（工具、技能、操作权限这一整套驾驭系统）是缰绳和马鞭，让 AI 在真实任务里不跑偏。

为什么这个概念值得单独强调？因为**同一个模型装不同 Harness，Agent 的能力差距很大**——模型决定下限，Harness 决定上限。与 Codex、Workbody 这类成熟 Agent 产品的区别在于：后者是"骑平台训练好的马"，而 DeepSeek Harness 把"跑马场"也开放了，支持用户自己定制专属 Agent。这和站内[《Claude Code 应用与实践精读》](/posts/ai/claude-code-playbook/)里"harness 比模型重要"的结论完全相通——外围系统的搭建正在取代模型选型，成为 Agent 效果的主要变量。

## 三种安装方式怎么选

| 方式 | 门槛 | 适合人群 |
| --- | --- | --- |
| 命令行安装 | 需要 Node.js 环境 | 有开发基础 |
| 交给已有 AI Agent（Codex/Claude Code 等）代装 | 有现成 Agent | 想省事的进阶用户 |
| **桌面客户端（DSH Desktop）** | 最低 | **新手首选** |

## 桌面客户端流程要点

三步：官网（dshdesktop.cn）下载 Mac/Windows 安装包 → 首次启动走设置向导（可跳过后补）→ 配置 API Key。

API Key 是唯一有实质门槛的环节，两条必须记住的提醒：

- Key 在 DeepSeek 开放平台（platform.deepseek.com）注册创建，**只显示一次**，当场保存好
- API 调用**产生真实费用**，注意充值与用量

## 界面与权限

主界面三块：左侧工作区和会话列表、中间对话输入区；使用前需要先选择一个本地工作区文件夹——Agent 的文件操作都限定在这个范围内。

权限设置是安全的核心，等级大致从低到高：**Read Only**（只读，查看代码/分析文档）→ **Workspace Write**（可修改工作区内文件）→ 更高的系统级权限。原则是按需给权：纯阅读分析任务用只读，确认可信后再放写权限。

## 写在最后

这篇教程本身很轻，但概念立得住：装完只是起点，真正的价值在"自己驯马"——定制技能、调权限、喂上下文。两点客观提醒：DSH Desktop 是第三方客户端，选择前自行评估其更新维护状况；API Key 等同钱包，不要提交进代码仓库（本站此前就处理过令牌泄露事件，教训是通用的）。

## 参考资料

- 原文：[DeepSeek Harness 安装入门教程 — 杨比耶@比耶Ai落地（微信公众号）](https://mp.weixin.qq.com/s/PaQjDkqqI57uyFf8inm3rw)
- 站内相关：[《Claude Code 应用与实践精读》](/posts/ai/claude-code-playbook/)
