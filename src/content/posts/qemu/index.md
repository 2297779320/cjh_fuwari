---
title: QEMU 运行 ARM64 Windows：SeawayEdge 安装教程
published: 2026-09-10
description: '在 QEMU 中安装 ARM64 Windows 系统镜像 SeawayEdge，涵盖 Windows 与 Linux 两种宿主机环境，重点讲解 virtio 驱动的加载。'
image: 'https://www.loliapi.com/bg/'
tags: [QEMU, 虚拟化, ARM64]
category: '虚拟化'
draft: false
lang: 'zh-CN'
---

在 QEMU 里跑 ARM64 Windows，最大的坑有两个：一是磁盘用了 virtio 控制器，Windows 安装器默认不认识，必须手动加载驱动；二是全系统模拟（TCG）速度慢，参数给不对更是慢上加慢。本文以 SeawayEdge 系统镜像为例，分别记录 Windows 和 Linux 两种宿主机下的完整流程。

## 准备工作

| 文件 | 说明 | 下载地址 |
| --- | --- | --- |
| QEMU for Windows | 模拟器本体（仅 Windows 宿主机需要） | [官方构建点](https://qemu.weilnetz.de/) |
| virtio-win.iso | Windows 的 virtio 驱动包 | [fedorapeople](https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso) |
| QEMU_EFI.fd | AArch64 UEFI 固件 | [edk2-nightly](https://github.com/retrage/edk2-nightly/raw/master/bin/RELEASEAARCH64_QEMU_EFI.fd) |
| SeawayEdge ISO | ARM64 Windows 系统镜像 | 现成镜像，自行获取 |

注意：从 edk2-nightly 下载的固件文件名为 `RELEASEAARCH64_QEMU_EFI.fd`，需要重命名为 `QEMU_EFI.fd`，与下面的命令对应。

创建虚拟硬盘（qcow2 格式，按需调整大小）：

```shell
qemu-img create -f qcow2 seawayedge.qcow2 20G
```

## Windows 宿主机

### 首次安装

将以下命令保存为 `.bat` 批处理（或在 cmd 中执行），注意 `^` 为续行符：

```batch
qemu-system-aarch64.exe ^
  -M virt,virtualization=true ^
  -m 4096 ^
  -cpu max,pauth-impdef=on ^
  -smp 4 ^
  -bios ./QEMU_EFI.fd ^
  -accel tcg,thread=multi ^
  -device ramfb ^
  -device qemu-xhci ^
  -device usb-kbd ^
  -device usb-tablet ^
  -nic user,model=virtio-net-pci ^
  -device usb-storage,drive=install ^
  -drive if=none,id=install,format=raw,media=cdrom,file=./SeawayEdge-V3.3_ARM_64.iso ^
  -device usb-storage,drive=virtio-drivers ^
  -drive if=none,id=virtio-drivers,format=raw,media=cdrom,file=./virtio-win.iso ^
  -drive if=virtio,id=system,format=qcow2,file=./seawayedge.qcow2
```

几个关键参数：

- `-accel tcg,thread=multi`：x86 宿主机上跑 ARM64 属于全系统模拟，`thread=multi` 开启多线程 TCG，性能差别明显
- `-cpu max,pauth-impdef=on`：启用宿主机支持的全部 CPU 特性，指针认证（PAuth）用软件模拟实现，缺了它部分 ARM64 Windows 版本无法启动
- `-device ramfb`：QEMU 内置的简易显示设备，装系统阶段够用
- 系统盘走 `if=virtio`，配合 `format=qcow2`

QEMU 窗口出现后，UEFI 引导管理器会提示按键选择启动项，**迅速按任意键**从 SeawayEdge ISO 启动，超时后会进入 UEFI Shell。

### 加载 virtio 驱动（关键步骤）

这是全文最重要的一步，跟着做：

1. **启动引导**：QEMU 窗口出现后，迅速按任意键从 ISO 镜像启动。
2. **进入安装界面**：按照提示选择语言、点击"现在安装"等。
3. **加载驱动程序**：当安装程序提示"您想将 Windows 安装在哪里？"时，磁盘列表是空的——安装程序不认识 virtio 磁盘。此时：
   - 点击"加载驱动程序"
   - 在弹出的窗口中点击"浏览"
   - 找到并展开 virtio-win.iso 对应的光驱（通常显示为 `virtio-win-...`）
   - 依次展开 `viostor` > `w11` > `ARM64` 文件夹
   - 选中该文件夹，点击"确定"，安装程序会自动找到并安装 viostor 驱动
4. **继续安装**：驱动加载成功后，虚拟磁盘就会出现在列表中，选中它，像普通电脑一样完成安装即可。

> [!TIP]
> 网卡驱动安装器不带：装完系统后会发现没有网络，此时挂载 virtio-win.iso，在设备管理器或安装包里补装 `NetKVM`（virtio 网卡）驱动即可。

### 后续启动

安装完成后，下次直接从虚拟硬盘启动，无需再挂载 ISO：

```batch
qemu-system-aarch64.exe ^
  -M virt,virtualization=true ^
  -m 4096 ^
  -cpu max,pauth-impdef=on ^
  -smp 4 ^
  -bios ./QEMU_EFI.fd ^
  -accel tcg,thread=multi ^
  -device ramfb ^
  -device qemu-xhci ^
  -device usb-kbd ^
  -device usb-tablet ^
  -nic user,model=virtio-net-pci ^
  -drive if=virtio,id=system,format=qcow2,file=./seawayedge.qcow2 ^
  -boot order=c
```

## Linux 宿主机

Linux 下可以用 KVM 加速——前提是宿主机本身就是 ARM64 机器（如树莓派、Apple Silicon 虚拟机等），x86 主机上仍需把 `-accel kvm` 换成 `-accel tcg,thread=multi`。

先复制一份 UEFI 变量文件到当前目录（安装过程会写入此文件）：

```shell
cp /usr/share/AAVMF/AAVMF_VARS.fd .
```

启动命令：

```shell
qemu-system-aarch64 \
  -M virt,gic-version=3 \
  -m 4096 \
  -smp 4 \
  -cpu max \
  -accel kvm \
  -serial mon:stdio \
  -device virtio-gpu-pci \
  -device qemu-xhci \
  -device usb-kbd \
  -device usb-tablet \
  -drive if=pflash,format=raw,unit=0,file=/usr/share/AAVMF/AAVMF_CODE.fd,readonly=on \
  -drive if=pflash,format=raw,unit=1,file=AAVMF_VARS.fd \
  -drive if=none,file=seawayedge.qcow2,format=qcow2,id=VIRTIO1 \
  -device virtio-blk,drive=VIRTIO1,bootindex=1 \
  -drive if=none,file=SeawayEdge-V3.3_ARM_64.iso,format=raw,readonly=on,id=VIRTIO2 \
  -device virtio-blk,drive=VIRTIO2,bootindex=2 \
  -net nic,model=virtio \
  -net user
```

与 Windows 宿主机版本的差异：

- UEFI 固件通过 `if=pflash` 双文件方式挂载（`AAVMF_CODE.fd` 只读代码 + `AAVMF_VARS.fd` 可写变量），而不是 `-bios` 单文件
- 显示设备用 `virtio-gpu-pci` 代替 `ramfb`
- `bootindex` 指定启动顺序：硬盘优先，ISO 兜底
- 安装完成后删掉 ISO 那两行即可日常启动

> [!NOTE]
> Debian/Ubuntu 上 AAVMF 固件由 `qemu-efi-aarch64` 包提供；路径因发行版可能不同，找不到时用 `dpkg -L qemu-efi-aarch64 | grep AAVMF` 确认。
