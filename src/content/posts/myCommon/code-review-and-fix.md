---
title: myCommon 嵌入式 C 框架：一次完整的代码审查与修复实践
published: 2026-08-14
description: 对 myCommon 消息框架的 55 个 C 源码文件做五轴审查，发现并修复 20+ 个严重缺陷（含远程可触发的堆破坏），并在 Docker Linux + ASan/UBSan 环境下验证。
image: 'https://www.loliapi.com/bg/'
tags: [c, 代码审查, 嵌入式, 安全, docker, gcc]
category: 'myCommon'
draft: false 
lang: 'zh-CN'
---

# myCommon 嵌入式 C 框架：一次完整的代码审查与修复实践

## 背景

myCommon 是一个纯 C 的消息驱动嵌入式框架（Linux/POSIX），配套 SampleApp 展示多模块交互：Topic 通配符路由、表驱动消息分发、Request-Response 机制。项目由 myCommon 框架与 rk3588-standalone 合并而来，代码量约 55 个源文件、2 万余行。

这次工作分三个阶段：**全量五轴审查 → 两轮修复 → 三平台验证**。

## 一、全量代码审查

### 审查方法

用 5 个并行审查代理分组深读 + 主代理逐条复核 Critical 声明，覆盖五轴：

| 轴 | 关注点 |
|---|---|
| 正确性 | 空指针、边界、错误路径、竞态、内存泄漏、越界 |
| 可读性 | 命名、控制流、死代码、约定一致性 |
| 架构 | 模块边界、耦合、重复、所有权语义 |
| 安全 | 不可信输入、缓冲区、注入、后门 |
| 性能 | 热路径分配、锁竞争、O(n²) |

### 覆盖对照（诚实结论）

第一轮审查覆盖了 `common/` **根目录** 35/36 个文件，但**漏掉了 7 个子目录的 20 个文件**（jsonrpc、ring、shareMem、uart、log、JsonParse、cjson 扩展）。补审后才发现最严重的问题恰恰在这些子目录里——**越大的缺陷越藏在没被看的地方**。

## 二、两轮修复

### 第一轮：根目录 Critical（8 项）

活跃框架 `framework_v2.c` 存在**两个硬编译错误**（`struct module_v2` 重复定义、`msg.timestamp` 成员缺失），意味着核心代码从未编译通过。其余：

- **UserAgent 消息转发 use-after-free**：浅拷贝后立即释放源消息
- **路由表与 Topic 永不匹配**：7 字段模式对 9 字段 Topic，核心消息路径是死的
- **request_que cancel/超时 UAF + 泄漏**：请求还在队列里就被释放
- **comm_que 销毁竞态**：5ms sleep 后销毁同步原语（UB）
- **common.c argv 越界写**：2 的幂容量时写越界
- **DeviceCtrl sscanf 不可信输入**：解析失败静默开关 0 号设备

### 第二轮：子目录 Critical（11 项，更严重）

补审暴露出**远程可触发**的缺陷：

- **jsonrpc cJSON 节点双释放**：`cJSON_AddItemToObject` 不从原父解除节点，两个 `cJSON_Delete` 释放同一内存 → **潜在 RCE**（已读 cJSON 源码核实）
- **jsonrpc 无 MSG_NOSIGNAL**：对端断开即 SIGPIPE 杀死整个进程（单包 DoS）
- **ring_buffer 写满不置 full 标志**：恰好填满容量时误报"空"，静默丢失全部数据
- **ring_queue peek_back 越界读**：跨回绕边界单段 memcpy
- **share_mem_queue 段大小不校验 + 多生产者槽位冲突**：伪造共享内存段越界读写
- **debugtrace 关闭死锁 + 未认证远程控制后门**：端口 1778 无认证可重置设备；重试循环不检查停止标志导致 `TSK_delete` 永久阻塞
- **cjson_extension 空指针崩溃**：`{"strCodec":123}` 让 `valuestring==NULL` → strncpy 崩溃
- **log.h 枚举级 POSIX 冲突**：`LOG_DEBUG` 等与 `<syslog.h>` 冲突（第一轮只修了宏级，漏了枚举级）

## 三、三平台验证

修复的验证过程本身就是一篇故事——本机最初**没有任何 C 编译器**：

| 环境 | 结果 |
|---|---|
| 静态验证 | 全部 55 文件括号平衡、符号交叉引用、Topic 字段数核对 |
| Windows MinGW gcc 8.1（用户提供路径） | 15/15 核心文件编译通过，队列回归测试通过 |
| **Docker Linux（ubuntu:24.04 + gcc 13.3）** | **24/24 编译通过**，队列/e2e/冒烟测试通过 |
| **ASan/UBSan**（Linux 专属能力） | 队列测试 + e2e + jsonrpc 所有权测试 + ring_buffer 测试 **全部 exit=0 零内存错误** |

### 环境搭建插曲

- 本机无 gcc/clang，winget 装 MinGW 卡死、GitHub 大文件下载 0.04 MB/s
- **用户提供 `D:\test\PainterEngine_make\assets\mingw\bin` 下的 gcc 8.1** —— 第一关突破
- 装 WSL Ubuntu 24.04 成功
- Docker Desktop 已装但 **Docker Hub 不通**；用户配置镜像源后 DNS 全失效，我替换为 4 个可解析的国内源（docker.1panel.live 等）后拉取 ubuntu:24.04 成功
- 容器内 apt 装 gcc 13.3，挂载 myCommon 目录，跑真实 Linux 编译 + ASan

## 四、关键教训

1. **审查范围必须完整**。第一轮漏掉的子目录藏了最危险的缺陷（RCE 级双释放、未认证后门）。根目录"看起来正常"不代表项目健康。
2. **编译错误会连锁隐藏问题**。`framework_v2.c` 编译不过时，所有依赖它的调用方错误都被掩盖；修好编译只是起点。
3. **所有权契约要显式**。C 代码里"谁分配谁释放"不写清楚，cJSON 这种"挂接但不解除"的语义就会导致双释放。
4. **ASan/UBSan 是不可替代的**。静态分析能指出"可能有问题"，sanitizer 能在真实运行中证明"确实修好了"。
5. **用户的力量**。没有用户提供的 MinGW 路径和 Docker 镜像源配置，这次验证可能根本无法完成。

## 五、现状与建议

- 55 个源码文件全部审查完毕，两轮共修复 20+ 项 Critical/Required
- Docker 容器 `mycommon-test` 存活，gcc/make 已装，可随时复用测试
- 遗留：debugtrace 认证令牌是明文常量（`debugtrace-2026`），生产环境应改强认证或编译开关禁用远程调试端口
- 建议在具备 SDK 头文件（soc_errno.h 等海思 SDK）的目标环境跑完整 `make`，并补一个真正的测试框架

---

*工具链：gcc 8.1 (MinGW) / gcc 13.3 (Ubuntu 24.04) / Docker Desktop 4.86 / WSL2 / ASan+UBSan*
