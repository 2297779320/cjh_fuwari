---
title: C 语言去样板代码十技巧精读
published: 2026-11-05
description: '精读嵌入式工程师之路《这 10 个 C 语言技巧》：从指定初始化器、查表、X-Macro 到 container_of、链接段自注册，每个技巧的适用场景与坑，附速查表与分级引入顺序。'
image: 'https://www.loliapi.com/bg/'
tags: [C语言, 嵌入式, 代码质量]
category: '嵌入式开发'
draft: false
lang: 'zh-CN'
---

嵌入式开发分类再添一篇——精读嵌入式工程师之路的《这 10 个 C 语言技巧，让你的嵌入式代码量减少一半》。文章讲的是十个专治"样板代码"的 C 写法，每个都附了代价，难得的是开头先把三句实话说在前面：

1. 标题里的"减半"指的是**重复性的样板代码**，不是整个工程的行数
2. 减少的是**源码行数**，不一定是编译后体积——有几个技巧二进制反而会变大
3. 大多是 C99/C11，少数是 GNU 扩展，能不能用取决于编译器和编码规范

观点归原作者，原文见文末。

## 技巧一：指定初始化器，配置一次写完

```c
UART_Config_t cfg = {
    .baudrate = 115200,
    .data_bits = 8,
    .tx_buf = tx_storage,
    .tx_size = sizeof(tx_storage),
};
```

没写出的成员自动清零，`memset` 也省了；字段顺序不再重要，结构体加字段老代码不会错位。

**坑**：清零意味着枚举的 0 值必须是安全的默认值——把 `UART_STOPBITS_1`、`UART_PARITY_NONE` 定义成 0，省略才成立。这个约定要写进接口文档。

## 技巧二：查表代替 if-else 链

把散落的 `if (mode == ...) {...}` 换成以枚举为索引的 `static const` 表：

```c
static const struct { uint16_t on_ms, off_ms; } k_blink[MODE_MAX] = {
    [MODE_IDLE] = {1000, 1000},
    [MODE_RUN]  = {  200,  200},
};
```

加一个模式是"加一行"，不是往 else-if 链中间插一段。配合技巧二的数组形式指定初始化器，枚举与数据的对应关系一目了然。表放 const 里编译器会放进 Flash，不占 RAM。**坑**：表要和枚举保持同步——这正是技巧六要解决的。

## 技巧三：X-Macro，一处定义多处生成

错误码枚举、错误码名字表这类"一份清单、多份拷贝"的东西，每加一项要改几处，漏一处就是 bug。X-Macro 把清单写成宏，再用不同展开方式生成不同产物：

```c
#define ERROR_TABLE(X) \
    X(ERR_OK)          \
    X(ERR_TIMEOUT)     \
    X(ERR_CRC)

#define AS_ENUM(name)  name,
#define AS_NAME(name)  #name,

typedef enum { ERROR_TABLE(AS_ENUM) ERR_COUNT } Err_t;
static const char *const k_err_names[] = { ERROR_TABLE(AS_NAME) };
```

加错误码只改一行，枚举和名字表自动同步。**坑**：可读性下降，新人要花时间理解；宏展开的报错信息也很难读。清单少于五六项时不划算。

## 技巧四：位操作宏，移位和掩码只写一次

寄存器字段的位置和宽度手写两遍，读写很容易不一致。定义一组小宏统一：

```c
#define BIT(n)                 (UINT32_C(1) << (n))
#define GENMASK(h, l)          (((~UINT32_C(0)) >> (31 - (h))) & ((~UINT32_C(0)) << (l)))
#define FIELD_PREP(mask, val)  (((uint32_t)(val) << __builtin_ctz(mask)) & (mask))
#define FIELD_GET(mask, reg)   (((reg) & (mask)) >> __builtin_ctz(mask))
```

思路与 Linux 内核的 `FIELD_PREP`/`FIELD_GET` 一致。**三条坑**：不要用 C 位域映射硬件寄存器或协议帧——排列顺序由编译器实现决定，跨编译器、跨字节序都不可靠；`__builtin_ctz` 是 GCC/Clang 专属；`BIT` 这种通用名可能和厂商头文件冲突，冲突时加前缀。

## 技巧五：复合字面量，临时配置不用起变量

```c
UART_Init(&uart1, &(UART_Config_t){ .baudrate = 115200, .data_bits = 8 });
```

**坑**：生命周期只到所在代码块结束。驱动若把这个指针保存下来，函数返回后就是悬垂指针——与站内[《回调与钩子精读》](/posts/RT/callback-vs-hook/)里"指针不等于引用计数"是同一个坑。需要长期保存就在内部拷贝一份。C99 特性，C++ 不这么用。

## 技巧六：ARRAY_SIZE 和 STATIC_ASSERT，让表与枚举自动对齐

```c
#define ARRAY_SIZE(a)  (sizeof(a) / sizeof((a)[0]))
STATIC_ASSERT(ARRAY_SIZE(k_err_names) == ERR_COUNT, err_names_out_of_sync);
```

以后有人加枚举忘补表，**编译期就报错**而不是运行时越界。**坑**：`ARRAY_SIZE` 用在指针上会静默算错（数组作函数参数已退化成指针），GCC 8+ 的 `-Wsizeof-pointer-div`（`-Wall` 开启）能抓一部分；`_Static_assert` 是 C11。

## 技巧七：用 ## 批量生成重复代码

三个 UART 三个几乎一样的 IRQHandler，只有编号不同：

```c
#define DEFINE_UART_ISR(n) void USART##n##_IRQHandler(void) { UART_IRQHandler(&g_uart[(n)-1]); }
DEFINE_UART_ISR(1)
DEFINE_UART_ISR(2)
DEFINE_UART_ISR(3)
```

**坑**：宏生成的函数在调试器里找不到源码位置，报错难读；MISRA C:2012 对 `#`/`##` 有咨询性规则建议避免；只重复三四次时直接写反而更清楚。

## 技巧八：日志宏自带上下文

```c
#define LOG_E(fmt, ...) Log_Write(LOG_LEVEL_ERROR, __func__, __LINE__, fmt, ##__VA_ARGS__)
```

**坑**：`##__VA_ARGS__` 是 GNU 扩展（C23 的 `__VA_OPT__` 是标准对应做法）；**源码少了但二进制可能变大**——每个调用点都带函数名字符串和格式串进 Flash。空间紧张的 MCU 要用条件编译整体关掉低等级日志，或只记事件编号。

## 技巧九：container_of，从成员指针找回宿主

把通用节点（定时器、链表、事件）嵌进设备结构体，回调只拿到节点指针时，不用全局变量也不用 `void*` 强转：

```c
#define container_of(ptr, type, member) ((type *)((char *)(ptr) - offsetof(type, member)))
```

通用组件不需要知道宿主是什么，宿主也不需要全局变量——这正是站内[《rk_libs 设计解析》](/posts/rk3588/rk-libs/)里侵入式链表节点 `DECLARELISTNODE()` 的同款思路。**坑**：ptr 若不是真正嵌入的 member，结果是未定义行为，编译器不报错（Linux 内核版带类型检查，简化版没有）。

## 技巧十：链接段自注册，去掉中央注册表

每加一个 shell 命令都要去中心文件登记，多人协作时那文件就是冲突热点。让每个命令在自己文件里用宏声明，编译器把它们放进同一个链接段，运行时遍历：

```c
#define SHELL_CMD(cmd, handler) \
    static const ShellCmd_t shell_cmd_##cmd \
    __attribute__((used, section(".shell_cmds"))) = { #cmd, handler }
```

链接脚本里用 `__shell_cmds_start`/`__shell_cmds_end` 标出段边界，遍历即可。Zephyr 和 Linux 内核的大量"注册"机制都是这个思路。**坑**：依赖 GCC/Clang 属性和链接脚本，IAR 写法不同、可移植性差；`used` 与 `KEEP` 缺一不可，否则开 `--gc-sections` 这些"没人引用"的对象会被丢弃；条目顺序由链接顺序决定，不要依赖；注册点分散后"系统里到底有哪些命令"只能靠搜索；严格编码规范可能不允许。

## 十个技巧速查

| 技巧 | 解决什么 | 主要代价 |
| --- | --- | --- |
| 指定初始化器 | 配置赋值冗长 | 0 值必须是安全默认值 |
| 查表 | if-else 链 | 表要与枚举同步 |
| X-Macro | 多处定义不同步 | 可读性下降 |
| 位操作宏 | 移位/掩码重复 | 编译器内置函数、宏名冲突 |
| 复合字面量 | 临时变量 | 生命周期只到块结束 |
| ARRAY_SIZE + STATIC_ASSERT | 手写长度 | 用在指针上会算错 |
| `##` 批量生成 | 重复函数定义 | 调试不友好，MISRA 不推荐 |
| 日志宏 | 重复上下文参数 | GNU 扩展，二进制可能变大 |
| container_of | 全局变量/强转 | 误用即 UB |
| 链接段自注册 | 中央注册表 | 依赖编译器和链接脚本 |

## 什么时候别用

- **宏越多，调试越难**：宏展开不对应任何源码行，优先用 `static inline` 和枚举，实在不行再上宏
- **看团队水平和规范**：新人看不懂 X-Macro，比多写几行重复代码代价更高；有 MISRA 要求先确认规范允许什么
- **源码行数不是目标**：目标是"改一处，不用同步改其他地方"——省三行却让读代码的人多花五分钟就不划算
- **确认工具链**：老工程可能还挂着 `-std=c89`

## 建议的引入顺序

按"收益高、风险低"分三档：

1. **先用**：指定初始化器、查表、ARRAY_SIZE + STATIC_ASSERT、位操作宏
2. **再用**（要评审介入）：复合字面量、日志宏、container_of
3. **谨慎用**：X-Macro、`##` 批量生成、链接段自注册——收益大代价也大，等重复确实很多、团队也习惯了再上

原文结尾留了个小作业挺实在：找仓库里重复最多的文件，把"长得像的代码"按类型分类（重复配置 / 重复 if-else / 重复寄存器操作），只用一个对应技巧改一遍，对比行数和编译后体积。

## 写在最后

这十个技巧真正的主线不是"少写代码"，而是**把"改一处要同步改三处"的重复收敛成单一事实源**——指定初始化器收敛字段顺序、X-Macro 收敛清单、链接段收敛注册。对照站内[《CMake 交叉编译精读》](/posts/RT/cmake-cross-compile/)里"把构建约定收敛到一处"，是同一种工程直觉在不同层面的体现。

## 参考资料

- 原文：[这 10 个 C 语言技巧，让你的嵌入式代码量减少一半 — 嵌入式工程师之路（微信公众号）](https://mp.weixin.qq.com/s/1wUA8pS4fKE1Mz14bd7Q7g)
- 站内相关：[《回调与钩子精读》](/posts/RT/callback-vs-hook/)、[《rk_libs 设计解析与复现指南》](/posts/rk3588/rk-libs/)、[《CMake 交叉编译构建系统精读》](/posts/RT/cmake-cross-compile/)
