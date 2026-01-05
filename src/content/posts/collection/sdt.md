---
title: sdt（服务信息表）
published: 2026-01-05
description: ''
image: 'https://t.alcy.cc/fj'
tags: [协议]
category: '软件'
draft: false 
lang: 'zh-CN'
---

## 什么是sdt
在 MPEG-2 Transport Stream (TS) 中，SDT（Service Description Table） 是一个用于提供有关传输流中服务（如电视节目）的详细信息的数据表。它通常被广播和流媒体传输中使用，用于帮助接收端更好地识别和访问不同的服务。
## SDT 的基本作用：
SDT 主要提供关于每个服务的名称、服务类型、提供商信息以及该服务所对应的 PMT PID（Program Map Table 的 PID）等信息。通过解析 SDT，接收端能够获取更多关于每个节目的细节，如节目名称和所属的电视台等。
## SDT 的结构：
SDT 的数据结构与 PAT 类似，具有固定的格式。SDT 包含以下几个重要字段：
* Table ID (8 bits)：表的标识符，值为 0x42，表示这是 SDT 表。
* Section Syntax Indicator (1 bit)：指示数据部分是否符合语法规范。
* Section Length (12 bits)：SDT 表的长度。
* Transport Stream ID (16 bits)：指示该 SDT 所属的传输流的 ID。
* Version Number (5 bits)：SDT 的版本号。
* Current/Next Indicator (1 bit)：指示当前传输流的 SDT 版本。
* Section Number (8 bits)：用于标识此 SDT 部分的编号。
* Last Section Number (8 bits)：指示此表的最后部分编号。
* Service Information：
* 每个服务都有一个条目，包含 Service ID 和 Service Name（服务名称）。
* Service ID (16 bits)：服务编号，用于唯一标识每个服务。
* Service Type (8 bits)：服务类型，表示该服务是电视节目、广播、互动服务等。
* Provider Name：服务提供商名称，通常是广播公司或电视台的名称。
* PMT PID (16 bits)：该服务对应的 Program Map Table 的 PID，接收端可以通过这个 PID 获取节目内容。
## SDT 的工作原理：
* 接收端在接收到 TS 数据流时，首先解析 SDT。SDT 提供的信息帮助接收端理解流中的服务内容。
* SDT 定期广播，通常每 30 秒或几分钟会更新一次，以便接收端获取最新的服务信息，特别是在多频道广播的情况下。
* 通过解析 SDT，接收端能够确定该传输流中有哪些可用的服务，以及每个服务的具体信息（如服务名称和节目表 PID）。
## SDT 与 PAT 的关系：
* PAT（Program Association Table） 主要是将节目与其 PMT PID 关联，而 SDT（Service Description Table） 主要是提供关于服务的详细描述，包括服务 ID、服务名称以及提供商信息等。
* PAT 和 SDT 一起配合使用，PAT 用于识别节目，SDT 用于提供节目背后的服务和其他元数据。
## SDT 的示例：
假设一个传输流中有两个服务，服务 1 和服务 2。SDT 可能包含如下信息：
* 服务 1：
* Service ID = 1
* Service Name = "央视新闻"
* Service Type = 1 (电视节目)
* Provider Name = "中央电视台"
* PMT PID = 0x100
* 服务 2：
* Service ID = 2
* Service Name = "央视体育"
* Service Type = 1 (电视节目)
* Provider Name = "中央电视台"
* PMT PID = 0x101

通过解析 SDT，接收端知道：
* 服务 1 对应的节目是 央视新闻，其 PMT PID 是 0x100。
* 服务 2 对应的节目是 央视体育，其 PMT PID 是 0x101。
接收端解析 SDT 后，可以通过 PMT 获取每个服务的详细信息，如视频 PID、音频 PID 等。
## 总结：
SDT（Service Description Table） 是 MPEG-2 Transport Stream 中的重要元素，它用于描述传输流中的各个服务，包括服务 ID、服务名称、提供商信息以及对应的 PMT PID 等。通过 SDT，接收端可以了解各个服务的详细信息，进而进行有效的节目识别和数据流解析。SDT 和 PAT（Program Association Table） 搭配使用，确保接收端能够完整解析节目和服务信息。


