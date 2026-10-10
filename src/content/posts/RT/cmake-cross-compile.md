---
title: CMake 交叉编译构建系统精读
published: 2026-10-08
description: '精读 Psyducking《CMake交叉编译构建系统》：工具链文件绕开裸机链接测试、架构选项与 gc-sections 成对配置、现代 target_* 写法、hex/bin 产物生成与 compile_commands.json。'
image: 'https://www.loliapi.com/bg/'
tags: [CMake, 交叉编译, 嵌入式, STM32, 构建系统]
category: '嵌入式开发'
draft: false
lang: 'zh-CN'
---

嵌入式开发分类第二篇——Psyducking 的《CMake交叉编译构建系统》，与之前精读的[《Linux 启动流程》](/posts/linux/boot-flow/)同作者。主题一句话：**把固件的构建过程写成代码**——一条命令出固件、同一份源码出多种配置、能接 CI、编辑器能正确理解工程。全文以 STM32F407 + arm-none-eabi-gcc 为例，观点归原作者，原文见文末。

## 为什么需要一套构建脚本

四条需求定下目标：一条命令完成编译链接出产物（不依赖 IDE）；同一份源码构建不同配置（调试/发布、不同硬件版本）；能接 CI 自动编译归档；编辑器能拿到每个源文件真实的编译选项和宏。

## 最小可运行版本

```cmake
cmake_minimum_required(VERSION 3.16)
project(firmware C)

add_executable(firmware.elf src/main.c)
```

构建分两步，这个"配置—构建"分离是 CMake 的核心用法：

```bash
cmake -B build          # 配置：生成构建系统（默认 Makefile，可指定 Ninja）
cmake --build build     # 构建：与具体生成器无关的统一命令
```

`cmake --build` 是脚本和 CI 里的推荐写法——不关心底层是 Make 还是 Ninja。

## 工具链文件：绕开裸机的链接死结

最直觉的做法是在 CMakeLists 里 `set(CMAKE_C_COMPILER arm-none-eabi-gcc)`——**这样写必踩坑**：CMake 配置阶段会编译并**链接**一个测试程序验证编译器，而裸机没有运行环境，链接必然失败，配置直接中断。

解法是把编译器设置放进独立工具链文件，并用静态库方式做编译器测试（只需编译和归档，不需要链接）：

```cmake
# cmake/toolchain-arm-none-eabi.cmake
set(CMAKE_SYSTEM_NAME      Generic)   # Generic = 无操作系统，裸机/RTOS 都用它
set(CMAKE_SYSTEM_PROCESSOR arm)

set(TOOLCHAIN_PREFIX arm-none-eabi-)
set(CMAKE_C_COMPILER   ${TOOLCHAIN_PREFIX}gcc)
set(CMAKE_CXX_COMPILER ${TOOLCHAIN_PREFIX}g++)
set(CMAKE_ASM_COMPILER ${TOOLCHAIN_PREFIX}gcc)   # 汇编也用 gcc 驱动
set(CMAKE_OBJCOPY      ${TOOLCHAIN_PREFIX}objcopy)
set(CMAKE_OBJDUMP      ${TOOLCHAIN_PREFIX}objdump)
set(CMAKE_SIZE         ${TOOLCHAIN_PREFIX}size)

# 关键一步：编译器测试只编译不链接
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# 查找策略：程序在主机找，库和头文件只在目标环境找
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

使用时在配置阶段指定：`cmake -B build -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain-arm-none-eabi.cmake`。

两个补充：工程语言声明要加 ASM 才能处理启动文件——`project(firmware C ASM)`；工具链文件里**不要硬编码** `-mcpu`/`-mfloat-abi` 这类架构选项，交给工程统一设置，同一套工具链文件才能服务多个芯片型号。

## 架构选项与优化等级

架构选项用变量集中管理，避免散落：

```cmake
set(MCU_FLAGS -mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard)

add_compile_options(${MCU_FLAGS}
    -Wall -Wextra
    -Wdouble-promotion    # float 隐式提升为 double 时告警——Cortex-M 上代价很高
    -ffunction-sections   # 每个函数/数据独立成段
    -fdata-sections
    -g3
)

add_link_options(${MCU_FLAGS}
    -T${CMAKE_SOURCE_DIR}/ld/stm32f407vg.ld
    -Wl,-Map=${CMAKE_BINARY_DIR}/firmware.map,--cref
    -Wl,--gc-sections
    -Wl,--print-memory-usage
)
```

三个值得单独记的点：

- **`-ffunction-sections` 与 `--gc-sections` 必须成对**：前者让函数/数据各自成段，后者链接时回收未引用的段。缺一，未用的库代码全部进固件，Flash 占用明显偏高
- **`-mfloat-abi` 要与芯片和预编译库一致**：有 FPU 的 M4/M7 用 `hard`，M0/M3 只能 `soft`；和 HAL/DSP 库的编译选项混用会链接失败或运行异常
- **优化按构建类型切**：`CMAKE_C_FLAGS_DEBUG "-Og -DDEBUG"`（保留调试体验）、`RELEASE "-Os -DNDEBUG"`；未指定时给默认 Debug，避免"既不优化也不带宏"的中间态

## 源码组织与第三方库：现代 CMake 的 target_*

```cmake
add_executable(firmware.elf
    src/main.c
    startup/startup_stm32f407xx.s
    system/system_stm32f4xx.c
)
target_include_directories(firmware.elf PRIVATE
    inc
    drivers/STM32F4xx_HAL_Driver/Inc
    drivers/CMSIS/Include
    middlewares/FreeRTOS/include
)
target_compile_definitions(firmware.elf PRIVATE STM32F407xx USE_HAL_DRIVER)

# 第三方代码独立成库目标
add_subdirectory(drivers/STM32F4xx_HAL_Driver hal)
add_subdirectory(middlewares/FreeRTOS freertos)
target_link_libraries(firmware.elf PRIVATE hal freertos)
```

要点是**用 `target_*` 系列而不是全局的 `include_directories`**——选项只作用于指定目标，不污染其他目标。多目标工程里这点尤其重要：bootloader 和 app 往往需要不同的宏和包含路径。第三方库没有 CMakeLists 时，用 `add_library(... STATIC ...)` 手动包装即可。

一个高频坑：`file(GLOB_RECURSE)` 收集源码虽然省事，但**新增文件时 CMake 不会自动重新配置**——要么加 `CONFIGURE_DEPENDS`，要么干脆显式列出源文件。

## 生成可烧录的产物

```cmake
add_custom_command(TARGET firmware.elf POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O ihex   $<TARGET_FILE:firmware.elf> ${CMAKE_BINARY_DIR}/firmware.hex
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:firmware.elf> ${CMAKE_BINARY_DIR}/firmware.bin
    COMMAND ${CMAKE_SIZE} --format=berkeley $<TARGET_FILE:firmware.elf>
    COMMENT "生成可烧录产物并输出体积报告"
)
```

`$<TARGET_FILE:...>` 是生成器表达式，展开成目标的实际输出路径，比手写路径可靠（多配置生成器下尤其如此）。体积报告的 text/data/bss 三列要看懂：**text + data 占 Flash，data + bss 占 RAM**——量产前盯住这两个数字，比链接失败再处理从容得多。

## 多目标与配置开关

```cmake
option(BUILD_BOOTLOADER "构建 bootloader"   ON)     # 命令行 -DBUILD_BOOTLOADER=ON 覆盖
option(BUILD_UNIT_TEST  "构建 PC 端单元测试" OFF)
option(HW_VERSION_V2    "硬件版本为 V2"     OFF)

if(HW_VERSION_V2)
    target_compile_definitions(firmware.elf PRIVATE HW_VERSION=2)
endif()
```

一个容易忽略的点：**单元测试通常跑在主机上**，需要主机编译器而非交叉工具链——所以它应该是独立的 CMake 工程（用主机默认工具链配置），不要塞进交叉编译工程里。

## 让编辑器理解工程

```bash
cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -G Ninja
```

生成的 `compile_commands.json` 记录每个源文件的完整编译命令（含所有宏和包含路径）。把它放到工程根目录，clangd 就能正确解析跳转与补全，clang-tidy/cppcheck 也能拿到一致的宏——否则静态分析会因为不知道 `STM32F407xx` 这类宏而误判大量代码分支。生成器选择上，Ninja 比 Make 快且输出简洁，CI 里优先用。

## 写在最后

对照站内[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)那套"4 行 MAKEFILE.MK + 公共编译头"的范式：两种方案解决的是同一个问题——**把构建约定收敛到一处**。自制 Makefile 范式胜在零依赖、目录即库；CMake 的优势在工具链文件、多配置开关、compile_commands.json 这些"规模化之后的刚需"。我的看法：小工程自建 Makefile 足够，一旦需要多芯片型号、多配置产物、CI 接入和 IDE 联动，就值得迁到 CMake（或至少是 CMake 的工具链文件 + 自己的脚本混用）。

## 参考资料

- 原文：[CMake交叉编译构建系统 — Psyducking@嵌入式软件客栈（微信公众号）](https://mp.weixin.qq.com/s/uYz9rQ5jTh8uo7zghyadaQ)
- 站内相关：[《嵌入式 Linux 启动流程精读》](/posts/linux/boot-flow/)、[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)、[《回调与钩子精读》](/posts/RT/callback-vs-hook/)
