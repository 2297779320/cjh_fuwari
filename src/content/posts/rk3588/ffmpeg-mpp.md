---
title: 编译支持 RK3568 硬编码的 ffmpeg（MPP 录屏实录）
published: 2026-09-17
description: '交叉编译支持 RK3568 VPU 硬编码的 ffmpeg 全流程：libdrm、MPP、ffmpeg-rockchip 三步走，录屏 CPU 占用从 97% 降到 30%。'
image: 'https://www.loliapi.com/bg/'
tags: [RK3568, ffmpeg, MPP, 硬编码, 交叉编译]
category: '瑞芯微'
draft: false
lang: 'zh-CN'
---

照着 YouShun 的教程完整走了一遍「RK3568 上交叉编译支持 MPP 硬编码的 ffmpeg」，过程顺畅，效果立竿见影——录屏 CPU 占用从 97% 降到 30% 左右。这篇整理成可照抄的操作手册，补充每步的原理说明，原文链接见文末。

## 背景：为什么软编码扛不住

用原版 ffmpeg 的 `fbdev` 抓帧缓冲录屏，配 libx265 做 H.265 **软编码**，编码全靠 CPU 硬扛，实测占用率高达 97%，其他业务直接卡顿。而 RK3568 内部有 VPU 硬件编码器，把 H.265 编码交给 VPU（走 Rockchip MPP），CPU 占用降到 30% 左右，界面流畅性明显改善。

一句话原理：**x265 吃 CPU，rkmpp 吃 VPU**。对嵌入式设备来说，CPU 省下来才能干别的活。这也是站内[《rk3588使用》](/cjh_fuwari/posts/rk3588/rk3588/)里 MPP 媒体处理平台的同一套思路——只是这次从 C API 换到了 ffmpeg 命令行。

## 准备环境

主机 Ubuntu 20.04，交叉工具链用 Linaro GCC 11.3.1（aarch64），提前导出环境变量：

```bash
export PATH=$PATH:/opt/gcc-linaro-11.3.1-2022.06-x86_64_aarch64-linux-gnu/bin
export SYSROOT=/home/test/aarch64-sysroot   # 自定义安装目标，三个库统一装这里
```

`$SYSROOT` 是整个流程的关键约定：libdrm、MPP、ffmpeg 三步的产物都装进去，最后一步 ffmpeg 编译时通过 `--extra-cflags`/`--extra-ldflags` 指到这里找头文件和库。

## 第一步：交叉编译 libdrm

libdrm 是用户态访问 DRM 设备的封装，ffmpeg-rockchip 的 `--enable-libdrm` 依赖它。它用 meson 构建，先升级 meson 和 ninja（版本太低会报错）：

```bash
sudo apt install python3-pip
python3 -m pip install --user --upgrade meson ninja
export PATH="$HOME/.local/bin:$PATH"
```

拉取源码（注意现在仓库在 gitlab.freedesktop.org 的 mesa/drm）：

```bash
git clone https://gitlab.freedesktop.org/mesa/drm
```

在 drm 目录下写交叉编译配置文件 `aarch64-cross-file.txt`：

```ini
[binaries]
c = 'aarch64-linux-gnu-gcc'
cpp = 'aarch64-linux-gnu-g++'
ar = 'aarch64-linux-gnu-ar'
strip = 'aarch64-linux-gnu-strip'
pkgconfig = 'aarch64-linux-gnu-pkg-config'

[host_machine]
system = 'linux'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'
```

配置、编译、安装一条龙：

```bash
meson setup build --cross-file aarch64-cross-file.txt --prefix=$SYSROOT
ninja -C build
ninja -C build install
```

产物 `libdrm.so.2.134.0` 部署到开发板的系统库目录（板端按自己的库路径来）：

```bash
yxadmin@SMIOS:~# ls /usr/lib64/libdrm.so.2.134.0
```

## 第二步：交叉编译 MPP

```bash
git clone https://github.com/rockchip-linux/mpp
```

MPP 用 CMake，官方自带 aarch64 构建脚本，但默认安装路径不是我们的 sysroot，先改 `build/linux/aarch64/make-Makefiles.bash` 把安装前缀指向 `$SYSROOT`，再执行：

```bash
cd mpp/build/linux/aarch64
./make-Makefiles.bash
make install
```

产物 `librockchip_mpp.so.0` 同样部署到开发板 `/usr/lib64/`。

## 第三步：交叉编译 ffmpeg-rockchip

注意这里**不是**官方 ffmpeg——原版没有 rkmpp 编码器。用的是 nyanmisaka 维护的 fork，它在 FFmpeg 里集成了 `h264_rkmpp`/`hevc_rkmpp` 等 MPP 硬编码器：

```bash
git clone https://github.com/nyanmisaka/ffmpeg-rockchip
```

configure（关键参数见注释）：

```bash
./configure --target-os=linux --arch=aarch64 --prefix=$SYSROOT \
--cross-prefix=aarch64-linux-gnu- \
--enable-encoder=png --enable-zlib --enable-gpl --enable-version3 \
--enable-rkmpp --enable-libdrm \
--pkg-config=aarch64-linux-gnu-pkg-config \
--extra-cflags="-I$SYSROOT/include" \
--extra-ldflags="-L$SYSROOT/lib"

make -j4
```

`--enable-rkmpp` 启用 MPP 硬编码器，`--enable-libdrm` 启用 DRM 支持并链接第一步的 libdrm；`--extra-cflags/ldflags` 让它找到前两步装进 sysroot 的头文件和库。

## 验证：看依赖库就知道吃的是谁

把编译出的 ffmpeg 传到板子上，`ldd` 一看便知：

```text
# 新版（rkmpp 硬编码）
libdrm.so.2          =>  硬件显示/DRM 支持
librockchip_mpp.so.1 =>  Rockchip VPU 编码

# 旧版（x265 软编码）
libx265.so.199       =>  全靠 CPU
```

依赖从 `libx265` 换成了 `libdrm + librockchip_mpp`，编码主体从 CPU 换成了 VPU。

## 使用：录屏实测

`fbdev` 从帧缓冲 `/dev/fb0` 抓屏，`hevc_rkmpp` 硬编码存 MP4：

```bash
./ffmpeg -f fbdev -framerate 15 -i /dev/fb0 \
    -c:v hevc_rkmpp -pix_fmt yuv420p -y output_rkmpp.mp4
```

实测：1280×800 BGRA、15fps，CPU 占用 30% 左右（原版 x265 软编码为 97%），speed 1.01x 实时录屏无压力。

从运行日志还能读到几个有价值的细节：

- MPP 自动做了 stride 对齐：`set prep cfg w:h [1280:800] stride [1280:832]`——宽度对齐到 832，这与站内[零拷贝精读](/cjh_fuwari/posts/rk3588/zero-copy/)里讲的 stride ≠ width 完全对应
- 码控默认 CBR 2 Mbps、GOP 250
- 有一条提示值得 RK3568 用户注意：`Only rk3588's h264/265/jpeg and rk3576's h264/265 encoder can use frame parallel`——RK3568 的编码器不支持帧级并行，性能天花板比 RK3588 低，但对付 1080p 录屏足够

最后确认 VPU 真的在干活——看谁占着 MPP 服务设备：

```bash
fuser /dev/mpp_service
# 400065
ps ax | grep ffmpeg
# 400065  ./ffmpeg -f fbdev ... -c:v hevc_rkmpp ...
```

录屏进程正握着 `/dev/mpp_service`，说明编码确实走的是硬件。

## 小结

整套流程三个编译单元各司其职：libdrm 提供 DRM 用户态支持，MPP 提供 VPU 编码能力，ffmpeg-rockchip 把两者包装成 `hevc_rkmpp` 编码器。踩坑点集中在两处：meson/ninja 版本要够新，以及三步统一走 `$SYSROOT` 约定——只要这两点立住，后面基本一次通过。

## 参考资料

- 原文：[编译支持RK3568芯片mpp硬编码的ffmpeg — YouShun@You菜You爱玩（微信公众号）](https://mp.weixin.qq.com/s/7OEtsNcQHVOPZuSSKzgpfw)
- 站内相关：[《rk3588使用》](/cjh_fuwari/posts/rk3588/rk3588/)（MPP 媒体处理）、[《Rockchip 零拷贝技术精读》](/cjh_fuwari/posts/rk3588/zero-copy/)、[《Rockchip DRM/KMS 显示驱动精读》](/cjh_fuwari/posts/rk3588/drm-kms/)
