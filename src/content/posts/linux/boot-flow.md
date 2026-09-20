---
title: 嵌入式 Linux 启动流程精读
published: 2026-09-17
description: '精读 Psyducking《Linux启动流程》：BootROM → SPL → U-Boot → 内核 → 根文件系统 → init 的完整链路，每级失败现象与排查手段（earlycon、NFS 隔离、addr2line）。'
image: 'https://www.loliapi.com/bg/'
tags: [嵌入式, U-Boot, Linux, 启动流程, Bring-up]
category: '嵌入式Linux'
draft: false
lang: 'zh-CN'
---

新板 bring-up 最折磨人的时刻：上电后串口一片死寂，或者卡在某个阶段不动。 Psyducking 的《Linux启动流程》把启动链路逐级拆开，每一级给出典型的失败现象和排查手段，是一份可以直接照着用的排障手册。本篇全面整理其骨架，观点归原作者，原文见文末。

## 启动链全景与排查总原则

嵌入式 Linux 的启动是一条层层传递的链：**硬件上电 → 片内 BootROM → SPL → U-Boot → 内核解压启动 → 挂载根文件系统 → init 进程**。每一环都依赖上一环的正确输出。

排查总原则就一句话：**串口打印停在哪一环，问题就在那一环**——从最靠近"有输出"的地方往前推。

## BootROM 与 SPL：最前面的两级

BootROM 是芯片出厂固化的代码，做最基础的初始化：选择启动介质（SD/eMMC/NAND/USB/串口），从介质读前几 KB 到内部 SRAM，跳转执行。这段代码就是 SPL（Secondary Program Loader；TI 平台叫 MLO，Zynq 叫 FSBL）。SPL 的任务很专一：**初始化外部 DDR**——U-Boot 和内核都太大，塞不进 SRAM。

两级各有典型的"死法"：

- **串口完全无输出** = 问题在 BootROM 或更早：电源电压、晶振是否起振、复位电路、BOOT 启动模式引脚电平。BootROM 不打印，失败表现就是板子彻底没反应，只能上电表和示波器
- **只有 SPL 开头几行** = 大概率 DDR 初始化失败：SPL 里的 DDR 时序参数和板上内存颗粒不匹配。用芯片厂商的校准工具（如 i.MX 的 DDR Stress Test）校准参数

## U-Boot 阶段

SPL 把完整 U-Boot 加载进 DDR 后跳转执行。U-Boot 完成更全面的硬件初始化，提供命令行环境，最终加载内核镜像和设备树。最常见的启动方式：`bootz`（zImage + DTB）或 `bootm`（uImage），由 `bootcmd` 环境变量定义自动启动序列：

```bash
setenv bootcmd 'mmc dev 0; fatload mmc 0:1 ${kernel_addr_r} zImage; \
                fatload mmc 0:1 ${fdt_addr_r} myboard.dtb; \
                bootz ${kernel_addr_r} - ${fdt_addr_r}'
setenv bootargs 'console=ttymxc0,115200 root=/dev/mmcblk0p2 rootwait rw'
```

三个常见卡点：

- `Loading Environment... Warning - bad CRC`：环境变量区未初始化，不影响启动，`saveenv` 写一次即消除
- 倒计时结束后无输出：内核没加载成功（fatload 路径错）或加载了但起不来（镜像格式错、地址重叠）
- `Wrong Image Format for bootz`：镜像格式与命令不匹配——bootz 配 zImage，bootm 配 uImage

## 内核解压与启动

`bootz` 执行后，ARM 内核自解压代码先解压（若用压缩 zImage），再跳到真正的内核入口。这一阶段排查重点是 **`console=` 参数**：`ttymxc0` 这类串口设备名各家 SoC 不同（i.MX 是 ttymxc、三星是 ttySAC、全志是 ttyS），必须与设备树 aliases 匹配，否则内核起来了串口也没输出。

"U-Boot 打印 `Starting kernel ...` 后彻底安静"的典型原因：DTB 与内核地址重叠、DTB 损坏、内核没编对应 SoC 的 CONFIG。

## 根文件系统挂载

内核初始化完成后按 `root=` 挂载根文件系统，四种常见写法：设备分区（`/dev/mmcblk0p2`）、NFS（`root=/dev/nfs`）、分区 UUID（`PARTUUID=`）、initramfs（`/dev/ram0`）。挂载失败直接 panic：

```text
VFS: Unable to mount root fs on unknown-block(179,2)
Kernel panic - not syncing: VFS: Unable to mount root fs
```

排查思路：

- `unknown-block(179,2)` 里的 179 是 SD/MMC 主设备号、2 是分区号——确认分区存在且文件系统被内核支持（ext4 需要 `CONFIG_EXT4_FS`）
- 分区识别慢要加 `rootwait`，否则枚举没完成就 panic
- 怀疑根文件系统本身不完整时，用 `root=/dev/nfs` 先走网络根文件系统验证内核——NFS 能起来说明内核和 bootargs 没问题，问题在 rootfs 镜像

initramfs 是另一条路：内核内置的 cpio 归档，解压到内存当初始根文件系统，由其中的 init 脚本挂载真正的根（pivot_root）。发行版常用它加载存储控制器模块——因为根文件系统所在磁盘的驱动未必编进了内核。

## init 进程与用户空间

根文件系统挂好后执行 `/sbin/init`（或 `init=` 指定的程序），PID=1，所有用户进程的祖先。看到 `Run /sbin/init as init process` 就进了用户空间。init 有三档：BusyBox init（最轻量，读 `/etc/inittab`）、systemd（功能全但重）、OpenRC/SysVinit（居中）。

**卡在 `Run /sbin/init` 之后**，通常是 init 或其依赖库缺失/不兼容。杀手锏是绕过 init 直接进 shell：

```bash
setenv bootargs '... init=/bin/sh'
```

进 shell 后手动执行 init 的步骤，观察卡在哪。BusyBox init 解析 `/etc/inittab`（sysinit 系统初始化、respawn 拉起串口终端、shutdown 清理），其中 rcS 脚本挂 proc/sysfs、配网络、起守护进程——rcS 里某条命令卡死（比如死等一个不存在的网络接口）整个系统就停那。逐条注释 rcS 里的命令，能精确定位。

## 调试三板斧

**earlycon——解决 console 初始化前的黑暗期**。内核启动早期串口驱动还没加载，日志看不到。开启 `CONFIG_EARLY_PRINTK` 并在 bootargs 加 earlycon，就能在 console 初始化前输出日志：

```bash
setenv bootargs 'console=ttymxc0,115200 earlycon root=... rw'
# 或指定具体 earlycon（i.MX6 例）
earlycon=ec_imx6q,0x02020000
```

排查"`Starting kernel` 后无输出"类问题的利器。

**NFS 根文件系统——隔离 rootfs 问题**。根文件系统放在开发主机上，改了不用重烧 SD 卡：

```bash
setenv bootargs 'console=ttymxc0,115200 root=/dev/nfs \
                 nfsroot=192.168.1.100:/nfs/rootfs,v3,tcp \
                 ip=192.168.1.200:192.168.1.100:192.168.1.1:255.255.255.0::eth0:off rw'
```

怀疑根文件系统有问题时先 NFS 启动验证，调试周期大幅缩短。

**内核调试配置——让崩溃可读**：

```text
CONFIG_DEBUG_INFO=y     # 保留调试符号，配合 gdb
CONFIG_EARLY_PRINTK=y   # 早期打印
CONFIG_PANIC_ON_OOPS=y  # oops 直接 panic 便于捕获
CONFIG_KALLSYMS=y       # panic 时显示函数名而非地址
```

`KALLSYMS` 让 panic 打印函数名，配合 `addr2line` 直接定位到源码行号：

```bash
arm-linux-gnueabihf-addr2line -e vmlinux 0xc0123456
# 输出: /path/to/kernel/source/mm/slab.c:1234
```

## 写在最后

这篇的方法论内核是"逐级归因"：启动链的每一环都有明确的输出边界，串口停在哪，问题域就缩到哪一级——再用三板斧（earlycon 看更早、NFS 隔离 rootfs、addr2line 定位崩溃）把问题钉死。对照站内内容，RK 平台的 bring-up 会先经过 BootROM 加载 TPL/SPL、再 U-Boot 再内核，与本文链路完全一致；零拷贝和 DRM 文章里跑起来的内核，就是这条链的终点。

## 参考资料

- 原文：[Linux启动流程 — Psyducking@嵌入式软件客栈（微信公众号）](https://mp.weixin.qq.com/s/xMRumYjJFwQ1JVWqAFKCTA)
- 站内相关：[《Rockchip DRM/KMS 显示驱动精读》](/cjh_fuwari/posts/rk3588/drm-kms/)、[《Rockchip 零拷贝技术精读》](/cjh_fuwari/posts/rk3588/zero-copy/)
