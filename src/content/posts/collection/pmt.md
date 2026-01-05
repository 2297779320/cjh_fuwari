---
title: pmt（节目映射表）
published: 2026-01-05
description: ''
image: 'https://t.alcy.cc/fj'
tags: [协议]
category: '软件'
draft: false 
lang: 'zh-CN'
---

## 什么是pmt
PMT Table（Program Map Table，节目映射表）是数字电视广播系统（如DVB、ATSC、ISDB等）中用于描述特定节目和其相关数据流的一种表格结构。它是 MPEG-2 TS（MPEG-2 Transport Stream，传输流）协议的一部分，广泛应用于广播、卫星、地面和有线电视系统中。

### PMT Table 的主要功能
1. 描述节目和数据流的映射关系：PMT表格用于映射每个节目（例如，电视节目、广播频道）内的视频、音频、字幕等数据流的PID（Packet Identifier，包标识符）。这使得接收器或解码器能够正确地提取和解码节目内容。
2. 节目结构的定义：在PMT表中，定义了一个节目（例如某个频道）的各个组成部分，如视频流、音频流、字幕流等。这些流在传输流中的具体PID值都可以通过PMT表格进行查找。
3. 节目切换：PMT表还可以提供节目切换所需的结构信息，比如通过PID指示节目切换的顺序和数据流。这对于卫星和有线电视的节目切换非常重要。
### PMT Table 的内容
* 表头：包括表标识符、版本号、CRC校验值等信息。
* 节目描述：定义每个节目（如频道）的唯一标识符、语言信息等。
* PID映射：列出了与该节目相关的视频流、音频流、数据流等的PID。
* 描述符：提供额外的节目信息，例如字幕、服务信息、服务类型等。

## 典型的PMT表结构：
1. Program ID (PID)：该节目对应的PID值，识别此节目的标识符。
2. Stream PID：每个音视频流的PID，用于传输该流的内容。
3. Stream Type：定义流的类型，例如视频流、音频流或数据流。
4. Descriptors：额外的描述符，用于提供更多关于该节目的信息，例如节目名称、语言、字幕信息等。

## 如何使用pmt
PMT（Program Map Table） 是 MPEG-2 Transport Stream (TS) 中的一个重要表格，它用于描述节目的所有数据流的结构信息，包括视频、音频、字幕等数据流的 PID（Packet Identifier），以及其他与节目相关的元数据。通过 PMT，接收端可以知道如何从传输流中提取出各个数据流，以便正确解码和播放节目内容。
1. PMT 的基本作用：
PMT 的主要功能是告诉接收端节目中的所有数据流的组织结构。例如，它会列出视频、音频和字幕数据的 PID，以及它们的格式和类型。这些信息对于接收端正确地解析和显示节目内容至关重要。
* PMT 让接收端知道视频流、音频流等的 PID。
* 它还可能包含与加密内容相关的信息，例如 CAT（条件访问表）中指定的加密系统的 PID 和解密所需的信息。
2. PMT 的结构：
PMT 的结构相对复杂，包含多个字段，主要包括：
* Table ID (8 bits)：表标识符，PMT 的值为 0x02。
* Section Syntax Indicator (1 bit)：指示该部分是否符合语法规范。
* Section Length (12 bits)：PMT 表的长度。
* Program Number (16 bits)：节目编号，唯一标识节目。
* Version Number (5 bits)：PMT 的版本号。
* Current/Next Indicator (1 bit)：指示当前版本的 PMT。
* Section Number (8 bits)：该 PMT 部分的编号。
* Last Section Number (8 bits)：表示该 PMT 的最后部分编号。
* PCR PID (16 bits)：PCR（Program Clock Reference） PID，用于同步时钟，确保视频和音频数据的正确播放。
* Program Info Descriptor (可选)：描述有关节目的附加信息，例如节目名称等。
* Stream Descriptors (可变长度)：描述节目的各个数据流，包括：
* Stream Type (8 bits)：流类型，指示该流是视频、音频还是字幕等。
* Elementary PID (16 bits)：数据流的 PID，该 PID 是传输流中该数据流的唯一标识符。
* ES Info Length (12 bits)：附加信息的长度，指示是否有额外的流描述符。
* ES Info Descriptor (可选)：与特定流相关的附加描述符信息，例如语言、编码格式等。
3. PMT 的工作原理：
* 数据流标识：PMT 提供了所有与特定节目相关的 PID。接收端通过这些 PID 可以提取节目中的视频、音频、字幕等数据流，并根据这些流进行正确的解码。
* 同步与时钟参考：PMT 中的 PCR PID 用于同步节目的时钟，确保视频和音频流的正确显示。
* 节目结构描述：通过 PMT，接收端能够知道节目中的所有数据流（如视频、音频、字幕）及其格式，帮助接收端做出相应的解码处理。
* 加密与条件访问：如果节目是加密的，PMT 可能会包含指向 CAT（Conditional Access Table） 的 PID，该信息告知接收端如何获取解密所需的信息。
4. PMT 与其他表的关系：
* PAT（Program Association Table）：PAT 中列出了传输流中的所有节目，并指示各节目对应的 PMT PID。接收端通过解析 PAT 获取 PMT 的 PID，从而进一步解析 PMT。
* CAT（Conditional Access Table）：如果节目是加密的，PMT 中会指向 CAT，提供相关的加密信息和解密 PID。接收端需要通过 CAT 来获取解密密钥和相关信息。
5. PMT 的示例：
假设某个传输流中的节目具有以下结构：
* Program Number = 1：节目编号为 1。
* PCR PID = 0x100：PCR 数据流的 PID 为 0x100，用于时钟同步。
* Stream Descriptors：
* 视频流：Stream Type = 0x1 (MPEG-2 视频)，PID = 0x101。
* 音频流：Stream Type = 0x03 (MPEG-1 音频)，PID = 0x102。
* 字幕流：Stream Type = 0x06 (MPEG-2 字幕)，PID = 0x103。
* CA Descriptor：如果节目被加密，PMT 中可能会包含与 CAT 相关的描述符。
通过解析 PMT，接收端可以知道：
* 节目 1 使用了 PID 0x100 来同步时钟。
* 视频流使用 PID 0x101，音频流使用 PID 0x102，字幕流使用 PID 0x103。
* 如果该节目是加密的，接收端还可以根据 PMT 中的 CA 描述符 获取解密信息。
## 总结：
PMT（Program Map Table） 是 MPEG-2 Transport Stream 中一个关键的表格，它为接收端提供了关于节目中各个数据流的详细信息。PMT 包含了视频、音频、字幕等流的 PID、时钟同步的 PCR PID、以及与加密相关的 CAT PID 等信息。通过解析 PMT，接收端可以正确地提取和解码节目中的所有数据流，并确保节目内容的正常播放。PMT 和其他表（如 PAT、CAT）相互配合，帮助接收端实现节目的完整解析和访问控制。

