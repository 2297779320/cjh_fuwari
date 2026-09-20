---
title: mmap 内存映射精读
published: 2026-09-17
description: '精读 leaffei《mmap 内存映射详解》：文件映射、共享内存、匿名内存三种用法，mmap 与 read/write 的性能对比，madvise/mprotect，以及 SIGBUS、MAP_FIXED 等六个常见坑。'
image: 'https://www.loliapi.com/bg/'
tags: [mmap, linux, 系统编程]
category: '系统编程'
draft: false
lang: 'zh-CN'
---

换一篇口味——leaffei 的 Linux 系统编程系列（这是第十一篇）里的《mmap 内存映射详解》。读它的动机很直接：站里[《V4L2 驱动对象模型》](/cjh_fuwari/posts/linux/v4l2-driver-model/)和[《Rockchip 零拷贝精读》](/cjh_fuwari/posts/rk3588/zero-copy/)反复出现 mmap，那是在内核侧看它；这篇回到用户态，把这个"一个系统调用解决三件事"的基础设施彻底讲透。观点归原作者，原文见文末。

## 一个系统调用，三件事

把磁盘文件当数组直接读写、跨进程共享一块内存、给 malloc 拿大块连续内存——Linux 用同一个 `mmap` 解决。最直观的体验：

```c
int fd = open("data.bin", O_RDWR);
struct stat st; fstat(fd, &st);
char *p = mmap(NULL, st.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
p[100] = 'X';   /* 直接改第 101 字节，没有 read/write 调用 */
```

文件像数组一样被访问，修改透明落盘。

## 核心 API 与关键参数

配套的还有四个：`munmap`（解除）、`mprotect`（改保护）、`msync`（刷盘）、`madvise`（给内核建议）。两个参数值得单独记：

**prot**（可组合）：`PROT_READ/WRITE/EXEC/NONE`——NONE 段访问直接 `SIGSEGV`，这个特性后面有妙用。

**flags** 决定映射语义，核心是三组：

| 标志 | 语义 |
| --- | --- |
| `MAP_SHARED` | 写入同步到底层文件，多进程共享同一物理页 |
| `MAP_PRIVATE` | 写入触发 COW（写时复制），不影响文件 |
| `MAP_ANONYMOUS` | 匿名映射，`fd` 必须为 -1 |
| `MAP_FIXED` | 强制用指定地址（**危险**，会覆盖已有映射） |
| `MAP_POPULATE` | 立即 page-in，不做 lazy |

## 三种主要用法

**文件共享映射**：page cache 直接映射进进程地址空间，零拷贝、多进程共享同一物理页、100GB 大文件也能整个映射按需 page-in。限制是不能映射 pipe/socket。

**匿名共享映射**（`MAP_SHARED | MAP_ANONYMOUS`）：没有文件的一段共享内存。关键细节是 **fork 语义**——fork 本身不共享内存，但 MAP_SHARED 的匿名映射会跨 fork 共享，这是父子进程间最轻量的共享内存方式。

**匿名私有映射**（`MAP_PRIVATE | MAP_ANONYMOUS`）：大块内存分配。glibc malloc 对默认 ≥128KB 的请求底层就是 mmap。优势：free 后立即归还 OS（brk 的小块往往不还）、不污染主堆、大对象隔离碎片更少。

## mmap vs read/write：拷贝路径决定一切

`read` 每次都要从 page cache 拷一份到用户 buffer；mmap 则是把 page cache 的**页表项**映射进进程地址空间——没有用户/内核间的内存拷贝。

| 场景 | read/write | mmap |
| --- | --- | --- |
| 小文件随机读 | 快（cache 热） | 略慢（首次缺页开销） |
| 大文件顺序扫描 | 慢（多次拷贝） | 快（零拷贝） |
| 大文件随机访问 | 慢（每次 syscall + 拷贝） | **快**（页表直接定位） |
| 多进程共享同一文件 | 各自一份 buffer | **共享同一物理页** |
| 短小文件 / 一次性 | 简单 | 开销不划算 |

经验法则一句话：大文件、随机访问、多进程共享 → mmap；小文件、顺序读写、一次性 → read/write。

## madvise 与 mprotect

`madvise` 告诉内核你的访问模式：`MADV_SEQUENTIAL`（顺序读，内核激进预读）、`MADV_RANDOM`（随机，别预读）、`MADV_WILLNEED`（马上要用，提前换入）、`MADV_DONTNEED`（用完了，释放物理页）、`MADV_HUGEPAGE`（透明大页）。顺序扫大文件加 `MADV_SEQUENTIAL` 比默认快几倍。

`mprotect` 运行时改保护标志，三个经典场景：JIT 编译（先 RW 写机器码，再改 RX 执行）；对象生命周期保护（标记只读防误改）；guard page（首尾段改 PROT_NONE 防溢出）。

## 同步语义：page cache 是真正的数据源

`MAP_SHARED` 写入后：其他进程**立即可见**（共享同一 page cache 物理页）；落盘由内核异步 writeback 策略控制；要立即持久化必须显式 `msync`（数据库场景）。`msync` 三个 flag：`MS_SYNC` 同步等待完成、`MS_ASYNC` 触发即返、`MS_INVALIDATE` 失效其他映射的缓存。

共享内存的两种搭法：文件映射（`open` + `ftruncate`，可持久化）或 POSIX `shm_open`（对象在 `/dev/shm` 的 tmpfs 上，纯内存不落盘，推荐用于纯共享场景）。

## 真实应用

- **数据库 buffer pool**：PostgreSQL/InnoDB 把数据文件 mmap 进来，内核管 page 替换，多进程共享物理页
- **Redis RDB/AOF 加载**：大快照 mmap 进来按需 page-in，启动比一次性 read 快
- **LMDB**：整个数据库就是一个 mmap 的大文件，B+ 树直接在映射区上操作
- **动态库加载**：.so 的代码段 `PROT_READ|EXEC`、数据段 `PROT_READ|WRITE`，多进程共享同一份代码物理页
- **零拷贝**：`sendfile` 是 mmap+write 的优化版，更专业的方案是 splice

## 六个真实的坑

1. **SIGBUS：映射区超出文件实际大小**。mmap 8KB 但文件只有 4KB，访问第 5000 字节就是 SIGBUS——要么映射长度与文件一致，要么先 `ftruncate` 撑大文件。反过来，mmap 之后文件被别的进程缩短，再访问同样 SIGBUS
2. **munmap 后访问**：SIGSEGV。C 没有 RAII，建议每个 mmap 包成 helper struct 跟踪生命周期
3. **跨进程可见性取决于读法**：写方 mmap 修改后，读方用 mmap 或普通 read 都能立即可见（都走 page cache）；但读方用 **O_DIRECT** 会绕过 page cache 直接读盘，可能与 writeback 进度不一致。关键点：page cache 是真正的"数据源"，要么大家都走它，要么用显式 `msync` 协议
4. **MAP_FIXED 别乱用**：地址已被占用时会**覆盖已有映射**（栈、库代码），进程直接崩。5.1+ 内核用 `MAP_FIXED_NOREPLACE` 更安全：被占就失败，不覆盖
5. **32 位地址空间限制**：只有 2~3GB，映射超大文件会失败；64 位用户态 128TB 无此忧
6. **mmap 不等于零拷贝**——呼应站内[零拷贝精读](/cjh_fuwari/posts/rk3588/zero-copy/)的误区一：mmap 之后再来一次 memcpy，仍然是一次整帧复制。mmap 消除的是 read/write 的那次拷贝，不是所有拷贝

## 总结速查

| 用法 | flags | 场景 |
| --- | --- | --- |
| 文件共享 | `MAP_SHARED` | 大文件随机访问、多进程共享 |
| 文件私有 | `MAP_PRIVATE` | 加载只读段（可执行文件、.so） |
| 匿名共享 | `SHARED \| ANON` | 父子进程共享内存 |
| 匿名私有 | `PRIVATE \| ANON` | 大块内存分配（malloc 底层） |

## 写在最后

mmap 的价值不在"快"这个笼统印象，而在它把**文件、共享内存、匿名内存统一成同一套页表机制**——理解了 page cache 是数据源、COW 是私有语义的实现、缺页是延迟加载的手段，V4L2 的 mmap 采集、数据库的 buffer pool、动态库的加载就全都是同一个故事的不同章节。

## 参考资料

- 原文：[linux系统编程（十一）：mmap内存映射详解 — leaffei@音视频修炼之旅（微信公众号）](https://mp.weixin.qq.com/s/eJBOWjz2Ej_xCsVSUb27Iw)
- 站内相关：[《Rockchip 零拷贝技术精读》](/cjh_fuwari/posts/rk3588/zero-copy/)（内核侧视角的 mmap/DMA-BUF）、[《V4L2 驱动对象模型精读》](/cjh_fuwari/posts/linux/v4l2-driver-model/)
