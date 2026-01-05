---
title: pat（节目关联表）
published: 2026-01-05
description: ''
image: 'https://t.alcy.cc/fj'
tags: [协议]
category: '软件'
draft: false 
lang: 'zh-CN'
---
## 什么是pat
在 MPEG-2 Transport Stream (TS) 中，PAT（Program Association Table） 是一个关键的数据结构，它用于提供有关流中不同节目的信息。它是 MPEG-2 Transport Stream 中的一个重要元素，通常用于广播和流媒体传输。PAT 位于 TS 数据包的开头部分，通常通过解析 PAT 来获取节目和相应 PID（Packet Identifier）等信息。

## PAT 的基本作用：
PAT 是一种表格结构，包含了关于 节目（Program）的信息，尤其是节目与其对应的 PID（Packet Identifier）。PAT 的主要作用是将不同的节目和它们所用的 PID 进行关联，使解码器或接收端能够根据 PAT 来提取并正确解析相关的音频、视频和其他数据流。
## PAT 的结构：
PAT 本身是一个固定格式的表，它在 TS 中定期进行广播或传输。一个典型的 PAT 包含以下字段：
* Table ID (8 bits)：表的标识符，值为 0x00，表示它是 PAT 表。
* Section Syntax Indicator (1 bit)：指示数据部分是否符合语法规范。
* Section Length (12 bits)：表的长度。
* Transport Stream ID (16 bits)：指示该 PAT 所属的传输流的 ID。
* Version Number (5 bits)：表示 PAT 的版本号。
* Current/Next Indicator (1 bit)：指示当前传输流的 PAT 版本。
* Section Number (8 bits)：用于标识此表部分的编号。
* Last Section Number (8 bits)：指示此表的最后部分编号。
* Program Information：
* 每个节目会有一个条目，包含 Program Number 和 Program Map PID (PMT PID)。
* Program Number (16 bits)：表示节目编号，通常为 1 对应主节目，2 对应其他附加节目等。
* Program Map PID (16 bits)：该节目所对应的 Program Map Table (PMT) 的 PID，PMT 中包含该节目的视频、音频等相关 PID 信息。
## PAT 的工作原理：
* 当接收端接收到 TS 数据流时，它会首先解析 PAT。根据 PAT 中提供的 PID 信息，接收端能够知道如何找到每个节目的具体内容。
* PAT 定期广播并且循环更新，通常每几秒钟就会发送一次，以确保接收端能够同步更新节目表，特别是在多个节目并行播放的情况下。
* 每个节目有一个对应的 Program Map Table (PMT)，它包含该节目的详细内容，如音频 PID、视频 PID 等。通过解析 PAT，接收端可以获取到对应节目的 PMT PID，然后进一步解析 PMT 来获得节目相关的详细信息。
## PAT 与 PMT 的关系：
* PAT 主要是提供节目与其对应的 Program Map Table (PMT) 的 PID 信息。
* PMT 提供了更详细的内容信息，包括该节目所使用的音频、视频流以及其他数据流的 PID。
* 在整个传输流中，PAT 和 PMT 是配合使用的，PAT 用于找到节目，PMT 用于详细解析节目内容。
## PAT 的示例：
假设一个传输流中有两个节目，节目 1 和节目 2。PAT 可能包含如下信息：
* 节目 1：Program Number = 1, PMT PID = 0x100
* 节目 2：Program Number = 2, PMT PID = 0x101
通过 PAT，接收端知道：
* 节目 1 对应的 Program Map Table 存储在 PID = 0x100 的数据流中。
* 节目 2 对应的 Program Map Table 存储在 PID = 0x101 的数据流中。
接收端解析 PAT 后，可以通过 PMT 获取每个节目的详细信息，如视频 PID、音频 PID 等。
## 总结：
PAT（Program Association Table） 是 MPEG-2 Transport Stream 中用于将节目信号与其对应的 PID 进行关联的表格。它是多节目的传输流中不可或缺的一部分，使接收端能够正确地找到各个节目的数据流，并进一步解析出相关的音视频内容。PAT 与 PMT（Program Map Table） 配合使用，提供了全面的节目信息解析机制


