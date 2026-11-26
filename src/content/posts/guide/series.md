---
title: 系列索引：全部精读笔记的导航
published: 2026-11-26
description: '按主题系列组织的全站文章索引：V4L2/摄像头、Rockchip 媒体栈、显示与颜色、内核基础设施、音频、嵌入式开发、AI Agent 平台、安全工具与边缘 AI。'
image: 'https://www.loliapi.com/bg/'
tags: [索引, 导航]
category: '索引'
draft: false
lang: 'zh-CN'
---

站内文章按「系列」组织：同一个作者、同一条技术主线的精读笔记串在一起读，比单篇跳读收获大得多。这页是全部系列的入口，会随新文章持续更新。

## V4L2 / 摄像头源码系列

txp《V4L2 源码深度解析》系列（站内收录部分）+ 同域精读：

- [V4L2 驱动对象模型精读](/posts/linux/v4l2-driver-model/)——video_device / v4l2_fh / VB2 的对象地图
- [V4L2 文件句柄精读](/posts/linux/v4l2-fh/)（系列第三篇）——同一 /dev/videoX 多次打开，状态归谁管
- [V4L2 STREAMOFF 与退出路径精读](/posts/linux/v4l2-streamoff/)（第十篇）——停止、取消、释放三层依赖链
- [V4L2 Media Controller 精读](/posts/linux/media-controller/)（第二十篇）——Entity / Pad / Link 怎样描述一条链路
- [V4L2 视频编解码驱动精读](/posts/linux/v4l2-codec/)——M2M、Stateful/Stateless 与 Request API

## Rockchip 媒体栈

- [Rockchip DRM/KMS 显示驱动精读](/posts/rk3588/drm-kms/)——KMS 对象模型与原子提交
- [Rockchip 零拷贝技术精读](/posts/rk3588/zero-copy/)——DMA-BUF 对象链、导出导入与所有权状态机
- [rk_libs 设计解析与复现指南](/posts/rk3588/rk-libs/)——链路式媒体中间件与从零复现
- [编译支持 RK3568 硬编码的 ffmpeg](/posts/rk3588/ffmpeg-mpp/)——MPP 录屏实录

## 显示与颜色

- [RV1126B 显示硬件全景精读](/posts/rk3588/rv1126b-display/)——VOP、RGA、DSI 与 RGB 各管什么
- [从 NV12 到 RGB888：视频颜色表示精读](/posts/linux/nv12-rgb-color/)——矩阵、量程、寻址与字节序陷阱

## 内核基础设施

- [Linux DMA 驱动框架精读](/posts/linux/dma-framework/)——DMA Mapping / DMAEngine / DMA-BUF 的职责边界
- [mmap 内存映射精读](/posts/linux/mmap/)——文件、共享内存、匿名内存的统一

## 音频

- [ALSA/TinyALSA 与内核音频驱动精读](/posts/linux/alsa-tinyalsa-asoc/)——ASoC 三层、DAPM 与 DMA 环形缓冲
- [嵌入式音频对讲技术精读](/posts/audio/intercom/)——选型、AEC、RTP/WebRTC 与弱网
- [音频开发（备忘录）](/posts/linux/alsa/)——ALSA-lib 用户态基础

## 嵌入式开发

- [回调函数与钩子函数精读](/posts/rt/callback-vs-hook/)——关系 vs 位置，接口设计的两把尺子
- [CMake 交叉编译构建系统精读](/posts/rt/cmake-cross-compile/)——工具链文件、target_* 与产物生成
- [C 语言去样板代码十技巧精读](/posts/rt/c-tips/)——指定初始化器、X-Macro 与链接段自注册
- [嵌入式 Linux 启动流程精读](/posts/linux/boot-flow/)——BootROM 到 init 的逐级排查

## AI Agent 平台

**DeepSeek Harness（DSH）**

- [安装入门精读](/posts/ai/deepseek-harness/)——Harness 概念与上手
- [插件生态精读](/posts/ai/dsh-plugins/)——六篇实测榜单交叉整理
- [进阶精读](/posts/ai/dsh-dev-guide/)——profile/bundle/patch 与插件开发契约

**Hermes**

- [生态五项目精读](/posts/ai/hermes-ecosystem/)——驾驶舱、货架、编排器、手册、仪表盘
- [多 Agent 方案精读](/posts/ai/hermes-multi-agent/)——一个 profile 一个 Bot，含五步实操与协作手册
- [技能与插件精读](/posts/ai/hermes-skills/)——版本没来，先把本事装上
- [自动化十配置精读](/posts/ai/hermes-automation/)——让它睡觉时也在干活
- [Oh My Hermes 编排精读](/posts/ai/omh/)——DAG 编排与证据化验收

**其他**

- [Claude Code 应用与实践精读](/posts/ai/claude-code-playbook/)
- [Octop 托管 CodeBuddy 精读](/posts/ai/octop-codebuddy/)——7×24 在线的 AI 程序员
- [Voltip 项目精读](/posts/ai/voltip/)——跨四端语音听写的架构

## 安全工具

- [Sherlock 使用指南](/posts/linux/sherlock/)——按用户名普查 400+ 社交账号

## 边缘 AI

- [SOPHGO CV84x6 上的 LLM 应用](/posts/linux/p8-meeting-minutes/)——P8 会议纪要复盘

## 其他笔记

- [pybind11 入门实战](/posts/ai/pybind11/)——C 工程师的 Python 绑定指南
- [openclawA 股助手](/posts/ai/openclawa/)、[openclaw 技能使用](/posts/ai/skill/)
- [rk3588 使用](/posts/rk3588/rk3588/)

---

> 说明：站内的 Hermes 五篇与 V4L2 系列文末都带系列导航，可以顺着一路读；新文章会同步补进本页。
