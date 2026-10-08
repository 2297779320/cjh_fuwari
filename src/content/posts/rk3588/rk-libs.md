---
title: rk_libs 设计解析：链路式媒体中间件与从零复现指南
published: 2026-09-20
description: '基于 rk_libs 仓库源码的深度解析：Link 框架的注册/创建/绑定机制、拉模型流水线、对象池零拷贝数据面、六条工程基线，以及一套已经实测跑通的 minilink 复现骨架（20 万帧 RSS 零增长）与八个实战坑。'
image: 'https://www.loliapi.com/bg/'
tags: [Rockchip, C语言, 多媒体, 架构设计]
category: '瑞芯微'
draft: false
lang: 'zh-CN'
---

# rk_libs：一套 Rockchip 平台的「链路式」媒体中间件 —— 设计解析与从零复现指南

> 本文基于 `rk3588/rk_libs` 仓库源码写成。目标是：**读懂它的设计**，并给出**一套可以照着重新搭一遍的骨架**。
> 所有结构体名、函数名、宏名均取自源码，可直接 grep 对照。

---

## 0. TL;DR

`rk_libs` 的本质是一个**嵌入式多媒体流水线框架（Pipeline Framework）**，核心思想只有一句话：

> **把「解码 / 缩放 / 叠加 OSD / 多路合成 / 编码」每一道工序封装成叫做 *Link* 的黑盒，运行时用「字符串名字」把它们注册、创建、串起来。**

```c
RKLinkInit();                                                  /* 建全局管理者 */
RKDecoderLinkInit(); RKMergeLinkInit(); RKEncoderLinkInit();   /* 注册「类」 */

RKLinkCreate("dec0",   RKDECODER_LINK_TYPE, &decParam, sizeof(decParam));
RKLinkCreate("merge0", RKMERGE_LINK_TYPE,   &mgParam,  sizeof(mgParam));
RKLinkCreate("enc0",   RKENCODER_LINK_TYPE, &encParam, sizeof(encParam));

RKLinkBind("dec0",   "merge0");   /* merge0 拿到 dec0 的 pfGetFrame + 句柄 */
RKLinkBind("merge0", "enc0");

RKLinkStart("dec0"); RKLinkStart("merge0"); RKLinkStart("enc0");
```

它借鉴了 TI 的 **DVR RDK `Link API`**（文件头还留着 `(c) Texas Instruments` 的版权行），但用**纯 C + 全局链表 + 函数指针表**实现：没有 C++ 虚表、没有依赖注入容器、没有配置文件，却在 RK3588/RK3576 上跑通了 25 路视频同时解码合成。

如果你要为一款 SoC（RK / NVIDIA / 海思 / 君正 / 全志皆可）从零做多媒体 SDK，**这套设计几乎是同规模场景下的最优解之一**，值得完整抄一遍。

---

## 1. 它到底在解决什么问题

RK3588 上做「多路视频拼接合成」，流程天然是分层的：

```
网络包/码流 --> 解码 --> 缩放/色转 --> 多路开窗合成 --> 编码 --> RTSP/RTMP 推流
                 (VPU)      (RGA/GPU)        (合成器)         (VPU)
```

直接写业务代码，三个月后一定会变成这样：

- `main.c` 3000 行，全局裸露的 `pthread_t g_tidXXX`、`MppCtx g_ctxXXX`；
- 换一块板子（RK3576 换成 RK3588）要改一半代码；
- 想把「25 路合成」改成「9 路合成」必须重编译 + 重启进程；
- 帧缓冲区谁申请谁释放说不清，跑一晚上必泄漏或崩；
- 某个源掉线，整条流水线卡死，没有任何自愈能力。

`rk_libs` 针对上述每一条都给了答案。

---

## 2. 模块地图

```
rk_libs/
|-- inc/                         # 对外头文件（= SDK 的 API 契约）
|   |-- rk_link/                 # ★ 框架层：整条管线的骨架
|   |   |-- rklink.h             #   统一门面 API
|   |   |-- rkchromalink.h       #   RKCHROMA_LINK_TYPE        "rkchromaFetch"
|   |   |-- rkdecoderlink.h      #   RKDECODER_LINK_TYPE       "rkdecoder"
|   |   |-- rkencoderlink.h      #   RKENCODER_LINK_TYPE       "rkencoder"
|   |   |-- rkmergelink.h        #   RKMERGE_LINK_TYPE         "rkmerge"
|   |   |-- rkosdlink.h          #   RKOSD_LINK_TYPE           "rkosd"
|   |   |-- rkscalelink.h        #   RKSCALE_LINK_TYPE         "rkscale"
|   |   `-- rkslicedlink.h       #   RKSLICE_DECODER_LINK_TYPE "rksliced"
|   |-- rk_codec/                # 硬件能力原子层（不依赖 rk_link）
|   |   |-- rkcodecType.h  rkdecoder.h  rkencoder.h  rkosd.h
|   |   |-- rkscale.h      rkgpuscale.h rkcompensation.h
|   |   `-- rkframe.h      rkresource.h
|   |-- multiwindow/             # 业务层：多路开窗合成（内部自己串 link）
|   |-- frameDup/                # 业务层：帧复制到另一条流水线
|   |-- streamServer/            # 业务层：一路 channel -> 多个 RTSP server
|   |-- audio_link/              # 音频编码链路 audioEncoderlink
|   |-- rk_blend/                # 图层叠加 RkBlendFrame
|   `-- colorCvt/                # OpenCL 色转/缩放/锐化/小波
|
|-- src/                         # 实现，目录结构 = 库结构，一一对应
|   `-- <module>/MAKEFILE.MK     # 每个模块一个只有 4 行的 makefile
|-- COMMON_HEADER.MK             # 公共编译头（模块名、编译/链接规则）
|-- COMMON_FOOTER.MK             # 公共编译尾（clean / install / depend）
|-- MAKEFILE.MK                  # 顶层：串行 make 8 个子模块
`-- Makefile                     # 薄封装：make libs / clean / depend / install
```

**分层关系：**

| 层 | 模块 | 职责 | 依赖方向 |
|---|---|---|---|
| L3 业务 | `multiwindow` `streamServer` `frameDup` | 面向产品的组合能力（一路 == 一个窗口） | 依赖 L0/L1，可持有任何 Link 句柄 |
| L2 算法 | `rk_blend` `colorCvt` | 纯计算 | 只依赖 OSAL + OpenCL/RGA |
| L1 原子能力 | `rk_codec` | MPP/RGA 的 thin wrapper | 不依赖上层任何东西 |
| L0 框架 | `rk_link` | 流水线执行引擎 | 只依赖 OSAL + L1 |

> **关键约束：`rk_link` 不知道 `multiwindow` 的存在，但 `multiwindow` 知道 `rk_link`。**
> 这条单向依赖是整个库能长期演进的根本原因。切勿反向 —— 一旦框架层开始 `#include` 业务层头文件，这套东西就死了。

---

## 3. 全库统一基线（动手之前先定这 6 条规矩）

这一节看似「代码风格」，实则是**能让 8 个模块 30+ 文件保持一致的唯一原因**。复现时请照抄。

### 3.1 类型与命名约定（匈牙利风简化版）

```c
typedef void            VOID;
typedef unsigned char   UINT8;    typedef signed char     INT8;
typedef unsigned short  UINT16;   typedef signed short    INT16;
typedef unsigned int    UINT32;   typedef signed int      INT32;
typedef char*           StringXXX;   /* String32 / String256 */
```

| 前缀 | 含义 | 例子 |
|---|---|---|
| `T_` | 结构体类型 | `T_RKLinkBase`、`T_MWWindowCreatePrm` |
| `E_` | 枚举类型 | `E_StateCode`、`E_RKVideoType` |
| `HANDLE` / `*Handle` | 不透明句柄 | `MWCreate()` 返回 `HANDLE`；`RKLinkHandle = void*` |
| `pf` | 函数指针 | `pfCreate`、`pfGetFrame`、`pfSetFrameCb` |
| `p` `pt` `ppt` | 指针 / 结构体指针 / 指针的指针（出参） | `ptObj`、`pucBuf`、`T_RKLinkFrame **pptFrame` |
| `str` | 字符串 | `strName`、`strLinkType` |
| `ui` `i` `b` `e` | UINT32 / int / BOOL / enum | `uiQueOutLen`、`bStart`、`eCodec` |
| `st` / `spt` | static / static pointer | `g_stDecoderLinkBase`、`g_sptLinkMng` |

**函数命名 = `模块名 + 动词/名词`，模块名绝不缩写：**

```
RKLinkInit      RKLinkRegister  RKLinkCreate   RKLinkBind   RKLinkGetFrame
RKDecoderLinkGetAFrame   RKDecoderLinkProcessUserPkt   RKDecoderLinkClearFrameOutQue
MWUpdateWindow  MWFreezeWindow  MWRequestWindowBufferInfoOnSpecificTime
SSAddServer     SSRemoveServer  SSUpdateWordOsd
```

收益一眼可见：**任何函数调用栈打出来，你都知道它在哪个模块、干什么**。

### 3.2 单一返回类型 + `STATE_OK()` 宏

全库几乎所有函数都返回 `E_StateCode`：

```c
STATE_CODE_NO_ERROR          /* 成功（0） */
STATE_CODE_INVALID_HANDLE    /* 参数非法 */
STATE_CODE_INVALID_COMMAND   /* 该 Link 不支持此 cb/命令（能力协商） */
STATE_CODE_OBJECT_EXISTED    /* 名字重复 */
STATE_CODE_OBJECT_NOT_EXIST  /* 名字不存在 */
STATE_CODE_OBJECT_BEYOND     /* 已绑定 / 不允许 */
STATE_CODE_OBJECT_BUSY       /* 下游来不及 —— 背压信号 */
STATE_CODE_TIME_OUT          /* ★ 超时（正常语义，不是错误！） */
STATE_CODE_ALLOCATION_FAILURE
STATE_CODE_INIT_FAILURE
STATE_CODE_UNDEFINED_ERROR   /* 硬件层出错，由上层决定是否复位 */
```

统一用宏判断而不是 `== 0`：

```c
if (!STATE_OK(eCode))
{
    return eCode;
}
```

> **设计要点：`STATE_CODE_TIME_OUT` 被当作「正常退出」。**
> 在拉模型里，超时意味着「暂时没数据」，链路据此 `continue` 去做别的活（归还帧、统计、自愈），既不空转也不报错。这是流水线既不死循环又不空转的关键。

### 3.3 「句柄 + Param 结构体 + State 结构体」三件套

统一签名：

```c
E_StateCode RKLinkCreate  (const INT8 *strName, const INT8 *strType, void *param, size_t paramSize);
E_StateCode RKLinkCtrl    (const INT8 *strName, const INT8 *strCtrl, void *param, size_t size, void *pResult);
E_StateCode RKLinkGetState(const INT8 *strName, void *pResult);
```

* 参数永远走 `void* + size`，**结构体可随版本加字段而不破坏 ABI**（旧调用方传旧 size，内部只取有效部分）；
* `strCtrl` 是**字符串命令名**，天然可扩展，将来可直接做成配置文件驱动 / 网络管理协议；
* 每个模块都有 `T_XXXState`（如 `T_RKDecoderState`、`T_RKMergeState`），配**独立的统计锁** `tStLock`，既能读累计计数（`uiDecodeStreamFrames`、`uiFramePutErros`），也能读瞬时水位（`uiLeftPics`、`uiLeftStreamBytes`）。

### 3.4 注释模板（别小看它）

每个文件头都有固定中文模板，**每个函数都有「功能描述 / 输入参数 / 输出参数 / 返回值 / 修改记录」**，且 `修改记录` 自带版本号：

```c
/**********************************************************************
* 函数名称：RKLinkCreate
* 功能描述：创建LINK
* 输入参数：strName    - 链路名
*           strType    - 链路类型
* 返 回 值：状态码
* 修改日期      版本号  修改人    修改内容
* -----------------------------------------------
* 2022/08/11    V1.0    tanrp
***********************************************************************/
```

嵌入式团队协作时，这套模板的价值约等于「代码审查一半的成本」。

### 3.5 OSAL：操作系统抽象层

`rk_libs` 不直接调 pthread / libc / malloc，一律走 OSAL：

```c
OSAL_MutexLock / OSAL_MutexUnlock            /* T_MutexObj */
OSAL_GetCpuStartInMsec / OSAL_GetCpuStartInUsec
OSAL_QueGet / OSAL_QuePut                    /* 带超时的轻量消息队列 */

CommQue_GetEmpty / CommQue_PutEmpty          /* ★ 双端对象池（空闲端） */
CommQue_GetFull  / CommQue_PutFull           /* ★ 双端对象池（就绪端） */
CommQue_GetPacketNumForRead / CommQue_GetPacketNumForWrite
CommQue_Clear

RngQue_GetDataSize / RngQue_Clear            /* ★ 环形字节流，码流输入 */

TSK_create / TSK_sleep / TSK_terminate / TSK_join

StdListPushBack / StdListRemove / StdListGetHeadNode / StdListGetNextNode
DECLARELISTNODE()                            /* ★ 侵入式链表钩子宏 */
```

`DECLARELISTNODE()` 把链表节点作为结构体**第一个字段**嵌入，配合 `(T_RKLinkNode *)pListNode` 直接强转，实现**零额外内存分配**的双向链表。

> **复现建议**：即使你只用 pthread，也请包一层 `osal_`。收益有三 —— 跨平台、可统一做内存泄漏追踪、可在 OSAL 内集中加死锁检测 / 日志。
> （注意：这套 OSAL 头文件不在本仓库内，位于外部基础库；本仓库只消费它的 API。）

### 3.6 构建：「4 行 Makefile」范式

`COMMON_HEADER.MK` / `COMMON_FOOTER.MK` 是全库的编译公约。每个模块只写一个 4 行的 `MAKEFILE.MK`：

```makefile
# src/rk_link/MAKEFILE.MK
include $(RK_PUBLIC_DIR)/COMMON_HEADER.MK
include $(RK_PUBLIC_DIR)/COMMON_FOOTER.MK
```

`COMMON_HEADER.MK` 用 `$(wildcard)` 收集本目录所有 `.c/.cpp`，由 `-DMODULE=xxx` 决定输出库名 `lib$(MODULE).a`。

顶层 `MAKEFILE.MK` 只是一个**串行 dispatcher**：

```makefile
libs:
	make -fMAKEFILE.MK -C./src/rk_codec     MODULE=rk_codec     $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/rk_link      MODULE=rk_link      $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/multiwindow  MODULE=multiwindow  $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/rk_blend     MODULE=rk_blend     $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/streamServer MODULE=streamServer $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/audio_link   MODULE=audio_link   $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/frameDup     MODULE=frameDup     $(MAKE_TARGET)
	make -fMAKEFILE.MK -C./src/colorCvt     MODULE=colorCvt     $(MAKE_TARGET)

all:     depend clean libs
clean:   make -fMAKEFILE.MK libs MAKE_TARGET=clean
depend:  make -fMAKEFILE.MK libs MAKE_TARGET=depend
install: make -fMAKEFILE.MK libs MAKE_TARGET=install
```

> **为什么「目录 = 库」这么值钱**：新加一个算法模块，只需 `mkdir src/xxx` + 放 4 行 MAKEFILE.MK + 主 makefile 加一行，**零结构性改动**。
> 更重要的是：静态库按 `.o` 粒度回收。**想裁剪某个 Link？把 `XXXLinkInit()` 那句注释掉，链接器会自动把整个模块代码丢掉。** 这在 Flash 紧张的嵌入式设备上价值巨大。

---

## 4. 核心：`rk_link` 深度拆解

这是整个库的心脏（`src/rk_link/rklink.cpp` 1500 行 + `rklinkPriv.h` + 7 个 `*link.cpp`）。理解了这一节，其余模块都只是「照着填表」。

### 4.1 只有 3 个核心数据结构

```c
/* rklink.cpp:52 ——「运行时对象」（链表中的一个节点） */
typedef struct _tagRKLinkNode_
{
    DECLARELISTNODE();                   /* 侵入式链表钩子 */
    String256       strName;             /* ★ 全局唯一的名字：所有 API 的寻址键 */
    T_RKLinkBase   *ptBase;              /* ★ 指向「类」：函数指针表 */
    RKLinkHandle    handle;              /* ★ 指向「实例」：具体 Link 自己的私有对象 */

    struct _tagRKLinkNode_ *ptPreLink;   /* Bind 形成的上下游指针 */
    struct _tagRKLinkNode_ *ptNextLink;
}T_RKLinkNode;

/* rklink.cpp:63 ——「全局管理者」（整个框架唯一的全局状态） */
typedef struct
{
    T_MutexObj    tLock;
    UINT32        uiLinkTypCnt;          /* 已注册类型数 */
    T_RKLinkBase *ptLinkType;            /* ★ 类型表：realloc 动态增长的数组 */
    T_StdListDef  tLinkList;             /* ★ 对象表：所有已创建的 Link 节点 */
    T_StdListDef  tBindList;             /* 预留的绑定关系表 */
}T_RKLinkMng;

T_RKLinkMng *g_sptLinkMng = NULL;        /* 唯一的全局量 */
```

以及 `rklinkPriv.h:66` 的**虚函数表** —— 全部契约都在这里：

```c
typedef struct _RKLink_
{
    const INT8     *pcLinkType;             /* 类型字符串 ID */

    /* --- 生命周期 --- */
    RKLinkCreateFxn      pfCreate;
    RKLinkDeleteFxn      pfDelete;
    RKLinkStartFxn       pfStart;
    RKLinkStopFxn        pfStop;
    RKLinkCtrlFxn        pfCtrl;            /* ★ 字符串命令，万能扩展口 */

    /* --- 压缩码流 Packet 通道 --- */
    RKLinkGetPktFxn      pfGetPkt;
    RKLinkSendPktFxn     pfSendPkt;         /* 推（上层注入） */
    RKLinkSetPktCbFxn    pfSetPktCb;        /* ★ 由 Bind 注入上游的拉函数 */

    /* --- 原始图像 Frame 通道 --- */
    RKLinkGetFrameFxn    pfGetFrame;
    RKLinkPutFrameFxn    pfPutFrame;        /* ★ 归还，不是销毁 */
    RKLinkSetFrameCbFxn  pfSetFrameCb;      /* ★ 由 Bind 注入上游的拉/还函数 */

    /* --- 用户直接注入帧 --- */
    RKLinkSendUserFrameFxn         pfSendUserFrame;
    RKLinkSetUserFrameReleaseCbFxn pfSetUserFrameRelease;

    /* --- 流量/背压 --- */
    RKLinkSetOutQueLenFxn   pfSetOutQueLen;
    RKLinkGetBlockFramesFxn pfGetBlockFrames;
}T_RKLinkBase;
```

**用 OO 语言对照：**

| OO 概念 | 本框架的 C 实现 |
|---|---|
| 类（vtable） | `T_RKLinkBase *ptBase`（static 常量，编译期确定） |
| 对象实例 | `RKLinkHandle handle`（= `T_RKDecoderLink*` 等私有结构） |
| new | `RKLinkCreate` 按「类型名」查 vtable，再调 `pfCreate` |
| 名字服务 / Bean 容器 | `T_RKLinkNode.strName` + 线性查找 |
| 依赖注入 | `pfSetPktCb` / `pfSetFrameCb` |
| 引用计数 / 对象池 | `CommQue` 的 empty/full 两端 + `GetFrame/PutFrame` 配对 |
| 接口能力协商 | vtable 槽位是否为 `NULL` |

### 4.2 Register ——「类」的注册（编译期常量，运行期发现）

每个 Link 实现文件的**最后**必须有这两段（`rkdecoderlink.cpp:1140` / `:1171`）：

```c
static T_RKLinkBase g_stDecoderLinkBase =
{
    .pcLinkType           = RKDECODER_LINK_TYPE,     /* "rkdecoder" */
    .pfCreate             = RKDecoderLinkCreate,
    .pfDelete             = RKDecoderLinkDelete,
    .pfStart              = RKDecoderLinkStart,
    .pfStop               = RKDecoderLinkStop,
    .pfCtrl               = RKDecoderLinkCtrl,
    .pfGetPkt             = NULL,                    /* decoder 不产出码流 */
    .pfGetFrame           = RKDecoderLinkGetFrame,   /* ★ 它是 Frame 的生产方 */
    .pfPutFrame           = RKDecoderLinkPutFrame,
    .pfSetPktCb           = RKDecoderLinkSetPktCb,   /* ★ 它是 Packet 的消费方 */
    .pfSetFrameCb         = NULL,                    /* ★ 它没有上游 Frame -> 不能被 Frame Bind */
    .pfSendUserFrame      = NULL,
    .pfSetUserFrameRelease= NULL,
    .pfSendPkt            = RKDecoderLinkSendStream, /* 也支持上层直接推码流 */
    .pfSetOutQueLen       = RKDecoderLinkSetOutQueLen,
    .pfGetBlockFrames     = RKDecoderLinkGetBlockFrames
};

E_StateCode RKDecoderLinkInit()
{
    return RKLinkRegister(&g_stDecoderLinkBase);
}
```

`RKLinkRegister`（`rklink.cpp:251`）做的事极简 —— **realloc 数组 + memcpy**：

```c
OSAL_MutexLock(&ptMng->tLock);
ptMng->uiLinkTypCnt++;
ptMng->ptLinkType = (T_RKLinkBase *)realloc(ptMng->ptLinkType,
                                            ptMng->uiLinkTypCnt * sizeof(T_RKLinkBase));
if (NULL == ptMng->ptLinkType)
{
    ptMng->uiLinkTypCnt--;
    eCode = STATE_CODE_ALLOCATION_FAILURE;
    goto cleanup;
}
memcpy(ptMng->ptLinkType + ptMng->uiLinkTypCnt - 1, ptLinkType, sizeof(T_RKLinkBase));
OSAL_MutexUnlock(&ptMng->tLock);
```

于是使用者的启动代码是：

```c
RKLinkInit();            /* 先建全局管理者 */
RKDecoderLinkInit();     /* 逐个注册「类」—— 这就是插件注册点 */
RKEncoderLinkInit();
RKMergeLinkInit();
RKScaleLinkInit();
RKChromaLinkInit();
RKOsdLinkInit();
RKSlicedLinkInit();
```

> **这是整套框架最漂亮的一处**：新增一种 Link **不需要修改 `rklink.cpp` 一行代码**，只需在启动序列里加一句 `XXXLinkInit()`。
> 它是 C 语言版的 `dlopen` 插件发现 —— 没有动态库、没有符号表、没有 ELF 解析，却能做静态链接下的功能裁剪。

### 4.3 Create —— 名字服务 + 「按名查类，再调 pfCreate」

`RKLinkCreate`（`rklink.cpp:295`）：

```c
OSAL_MutexLock(&ptMng->tLock);
ptNode = FindRKLinkNode(ptMng, strName);          /* ① 名字唯一性校验 */
if (NULL != ptNode) { eCode = STATE_CODE_OBJECT_EXISTED; goto cleanup; }
OSAL_MutexUnlock(&ptMng->tLock);

ptBase = FindRKLinkBase(ptMng, strType);          /* ② 按类型名查「类」 */
if (NULL == ptBase)   { return STATE_CODE_OBJECT_NOT_EXIST; }

hLink = ptBase->pfCreate(strName, param, paramSize);  /* ③ 调虚函数建实例 */
if (NULL == hLink)    { return STATE_CODE_INIT_FAILURE; }

OSAL_MutexLock(&ptMng->tLock);
ptNode = AddRKLinkNode(ptMng, strName);           /* ④ 挂入全局链表 */
ptNode->ptBase = ptBase;
ptNode->handle = hLink;
```

注意 **②④ 之间特意解锁了一次** —— `pfCreate` 可能很慢（初始化 MPP decoder 要几十毫秒），不能拿着全局锁干这事。这是这类框架最容易踩的性能坑，作者处理得很干净。

### 4.4 Bind —— 整篇最核心的 20 行

```c
/* rklink.cpp:1327 */
E_StateCode RKLinkBind(const INT8 *strSrcLink, const INT8 *strDtsLink)
{
    /* ① 双方必须已存在，且「源尚无下游」「目的尚无上游」 */
    ptNode = FindRKLinkNode(ptMng, strSrcLink);
    if (NULL == ptNode) { eCode = STATE_CODE_OBJECT_NOT_EXIST; goto cleanup; }
    if (NULL != ptNode->ptNextLink)  return STATE_CODE_OBJECT_BEYOND;   /* 源只能出一个 */

    ptDstNode = FindRKLinkNode(ptMng, strDtsLink);
    if (NULL != ptDstNode->ptPreLink) return STATE_CODE_OBJECT_BEYOND;  /* 目的只能有一个入 */

    OSAL_MutexUnlock(&ptMng->tLock);      /* ★ 注入回调前先放锁，避免死锁 */

    /* ②★ 关键：把「上游的函数指针 + 上游的句柄」注入到「下游」 */
    ptBase = ptDstNode->ptBase;
    if (NULL != ptBase)
    {
        if (NULL != ptBase->pfSetPktCb)
        {
            eCode = ptBase->pfSetPktCb(ptDstNode->handle,
                                       ptNode->ptBase->pfGetPkt,   /* 上游的拉函数 */
                                       ptNode->handle);            /* 上游的实例句柄 */
        }
        if (NULL != ptBase->pfSetFrameCb)
        {
            eCode = ptBase->pfSetFrameCb(ptDstNode->handle,
                                         ptNode->ptBase->pfGetFrame,
                                         ptNode->ptBase->pfPutFrame,
                                         ptNode->handle);
        }
    }

    /* ③ 只有注入成功才建立拓扑 */
    if (STATE_OK(eCode))
    {
        ptNode->ptNextLink   = ptDstNode;
        ptDstNode->ptPreLink = ptNode;
    }
    return eCode;
}
```

**这 20 行是整个设计的心法，值得停下来体会三遍。**

**第一条：连线不是「推」，而是「拉」。**

`Bind(A, B)` 的效果是：**B 拿到了 A 的 `pfGetFrame` 和 A 的句柄**。之后 B 的线程循环里直接 `A.pfGetFrame(A.handle, &frame, timeout)` 主动去取。

对比常见的「上游 push 给下游」写法，拉模型的优势：

- **天然背压**：B 忙的时候不来取，A 的输出池满了就自己返回 `TIME_OUT`，不需要额外 flow-control 协议；
- **天然支持多消费**：同一份缓冲区可以被多个下游先后借用（源码这里因业务限制只允许单下游，机制本身允许）；
- **时序可控**：B 决定「何时处理」，而不是被动唤醒；
- **零拷贝**：全程传 `MppFrame` 指针，像素数据只有一份。

**第二条：`pfXXXCb` 为空 = 「这个 Link 不支持该通道」，是一种编译期的能力协商。**

decoder 的 `pfSetFrameCb == NULL`，它就不能被 Bind 成 Frame 的下游；`pfSetPktCb != NULL`，它可以作为 Packet 的下游。框架据此判断能否连接，不支持时返回 `STATE_CODE_INVALID_COMMAND`。**能力即接口，无需额外配置文件。**

**第三条：拓扑关系记录在 Node 上，而不是放在 Link 内部。**

`T_RKDecoderLink` 里没有任何 `#include "rkmergelink..."`。Link 实现完全不知道自己在链路的什么位置 —— **这就是解耦**。

### 4.5 双通道数据模型

`rk_link` 里流动着两种**语义完全不同**的数据，因此必须分成两条通道：

| 通道 | 数据形态 | 方向 | 载体 | API |
|---|---|---|---|---|
| **Packet 通道** | 压缩码流（H264/H265/JPEG + `T_PacketHead`） | 上游 push 给下游（也支持 `RKLinkSendPkt` 由上层注入） | `RngQue` 环形字节缓冲 | `pfSendPkt` / `pfGetPkt` / `pfSetPktCb` |
| **Frame 通道** | 解码后图像（`MppFrame` 句柄） | 下游 pull 上游，用完**归还** | `CommQue` 定长对象池 | `pfGetFrame` / `pfPutFrame` / `pfSetFrameCb` |

**为什么必须分开？**

* 码流是**字节流**，天然适合流式 push，且**顺序敏感**（丢一帧整条 GOP 作废），所以用环形队列 + 流量控制；
* 图像是**对象**，一帧 1920x1088x1.5 约 3MB，**不可能靠内存拷贝传递**，必须是「借用/归还」语义，且允许多消费者。

#### Frame 的「借用—归还」协议（`CommQue` 四操作）

`CommQue` 是**定长的空闲/就绪双端对象队列**，预先分配好 N 个 `T_RKLinkFrame` **壳子**（注意：只存壳子，不存像素数据）：

```c
/* 生产者侧（decoder 线程） */
ptLinkFrame = CommQue_GetEmpty(ptObj->hQueOut, 0);        /* ① 借一个空壳 */
if (NULL == ptLinkFrame)
{
    return STATE_CODE_TIME_OUT;                           /* 池已空 -> 背压！不能忙等 */
}
ptLinkFrame->pFrame = pFrame;                             /* ② 挂上真实的 MppFrame */
CommQue_PutFull(ptObj->hQueOut, ptLinkFrame);             /* ③ 放入「就绪」端 */

/* 消费者侧（下游 link 线程） */
eCode = cbCtx->pfGetFrame(cbCtx->handle, &ptFrame, uiTimeout);   /* ④ 拉一帧 */
if (!STATE_OK(eCode)) { continue; }                              /* 超时 = 正常 */
/* ... 用 ptFrame 做合成/编码 ... */
cbCtx->pfPutFrame(cbCtx->handle, ptFrame);                       /* ⑤ 归还 */
```

**像素数据从头到尾只有一份；`T_RKLinkFrame` 壳子在池里循环复用。**

> 这个模式和 Linux 内核的 `skb`、V4L2 的 `QBUF/DQBUF`、Android `GraphicBuffer` 的生产者-消费者模型是同一个套路。**在嵌入式多媒体里，如果你不是这么做的，迟早会被内存带宽和延迟教训。**

#### `T_RKLinkFrame`：极简但够用

```c
/* rklink.h:42 */
typedef struct
{
    MppFrame    pFrame;      /* Rockchip MPP 图像句柄（内含 DMA fd / 引用计数） */
    T_Rect      tValidRect;  /* ★ 有效区域：搬运时只处理这块，省内存带宽 */
    void       *pAppData;    /* 随帧透传的业务数据（如：来自哪个窗口） */
    void       *pOwner;      /* ★ LINK 的拥有者：跨 Link 归还时能溯源 */
}T_RKLinkFrame;
```

`tValidRect` 和 `pOwner` 是两个很有工程味道的字段：

* `tValidRect`：多路合成时只把窗口的有效区域 blit 到画布，而不是整帧搬运；
* `pOwner`：帧在多个 Link 间流动，`PutFrame` 时能找到「娘家」。

#### 一个坑：归还不等同于立即释放（`PutFrame` 的延迟归还设计）

decoder 的 `RKDecoderLinkPutFrame`（`rkdecoderlink.cpp:1055`）**不直接调用 MPP 释放**，而是塞进另一个「待归还队列」`hQueDecPut`，由 decoder 主线程统一排空交给 `RKPutDecodeFrame`：

```c
E_StateCode RKDecoderLinkPutFrame(RKLinkHandle hLink, T_RKLinkFrame *ptFrame)
{
    ptPut = (T_RKLinkFrame *)CommQue_GetEmpty(ptObj->hQueDecPut, 0);
    if (NULL != ptPut)
    {
        memcpy(ptPut, ptFrame, sizeof(T_RKLinkFrame));   /* 只拷壳子的几十字节 */
        CommQue_PutFull(ptObj->hQueDecPut, ptPut);       /* 交给 owner 线程去释放 */
    }
    CommQue_PutEmpty(ptObj->hQueOut, ptFrame);           /* 立即把主壳还回去，不阻塞下游 */
    return STATE_CODE_NO_ERROR;
}
/* decoder 主循环每轮调用 */
RKDecoderLinkPutDecFrames(ptObj);
```

**为什么？** 因为 `GetFrame/PutFrame` 会被**下游线程**调用，而 MPP 的帧释放必须与 decoder 在同一上下文（线程亲和性 / 锁顺序）。用第二个队列把「释放动作」搬运回 owner 线程，是**跨线程资源归还的标准解法**。

### 4.6 一个 Link 内部的标准骨架（以 decoder 为例）

每个 Link 的私有结构都是这个模板：

```c
typedef struct
{
    HANDLE      hQueIn;       /* 输入：RngQue 环形队列（码流） */
    HANDLE      hQueOut;      /* 输出：CommQue 对象池（帧） */
    HANDLE      hQueDecPut;   /* 归还：待交给 MPP 释放的帧 */

    String256   strName;      /* 自己的名字（用于日志定位） */
    BOOL        bDone, bPause, bFlush, bStart;   /* ★ 状态标志组 */
    UINT32      uiQueOutLen, uiQueInLen, uiQueDecPutLen;

    T_MutexObj  tStLock;      /* 统计锁（独立于业务锁，避免统计拖慢业务） */
    T_RKDecoderState tState;  /* 对外状态 */
    UINT32      uiErrors, uiDecodeOkFramesCnt, uiSendToDecFramesCnt;

    T_MutexObj  tStreamLock;  /* 业务锁：保护 pfGetPkt / pPktCbCtx */
    RKLinkGetPktFxn pfGetPkt; /* ★ Bind 注入的上游拉函数 */
    RKLinkHandle    pPktCbCtx;/* ★ Bind 注入的上游句柄 */

    RKDecoderHandle hDec;     /* 真正的硬件资源 */
    T_RKDecoderParam tParam;  /* 创建时的参数快照 */
    TSK_Handle   hTsk;        /* 自己的线程 */
}T_RKDecoderLink;
```

**主循环（每个 Link 都长这样，`rkdecoderlink.cpp:504`）：**

```c
static void RKDecoderLinkFxn(void *param)
{
    for (;;)
    {
        if (ptObj->bDone) break;                       /* ① 退出标志优先 */
        if (!ptObj->bStart)                            /* ② 暂停态 */
        {
            RKDecoderLinkClearFrameOutQue(ptObj);
            TSK_sleep(10);
            continue;
        }
        if (ptObj->bFlush)                             /* ③ flush 态 */
        {
            RKDecoderLinkClearUserPkt(ptObj);
            RKDecoderLinkProcessPrevLinkPkt(ptObj);
            RKFlushDecode(ptObj->hDec);
            ptObj->bFlush = SMP_FALSE;
        }

        /* ④ 取输入：优先从前驱 Link 拉，否则从用户注入队列取 */
        if (NULL == ptObj->pfGetPkt)
            eCode = RKDecoderLinkProcessUserPkt(ptObj);
        else
            eCode = RKDecoderLinkProcessPreviouLinkPkt(ptObj);

        /* ⑤ 尽力把输出取满（一次取输入可能产出多帧） */
        uiTimeout = STATE_OK(eCode) ? 10 : 0;
        for (;;)
        {
            eCode = (ptObj->tParam.bPreviewMode)
                    ? RKDecoderLinkGetAFrameInPreviewMode(ptObj, uiTimeout)
                    : RKDecoderLinkGetAFrame(ptObj, uiTimeout);
            if (!STATE_OK(eCode)) break;               /* 超时/无帧 -> 跳出，绝不空转 */
            uiTimeout = 0;                             /* ★ 首帧等 10ms，后续不等待 */
        }

        RKDecoderLinkPutDecFrames(ptObj);              /* ⑥ 归还 */

        /* ⑦ 错误上报 */
        if (uiPreErrors != ptObj->uiErrors)
        {
            uiPreErrors = ptObj->uiErrors;
            ptObj->tState.uiDecodeErrors = ptObj->uiErrors;
            if (NULL != ptObj->tParam.pfOnError)
                ptObj->tParam.pfOnError(ptObj->tParam.pCbCtx, ptObj->uiErrors);
        }

        /* ⑧★ 硬件自愈：每 6000 轮统计一次成功率 */
        if (uiRolls >= 6000)
        {
            if (!ptObj->tParam.bDisableErrorReset &&
                ptObj->uiDecodeOkFramesCnt + 600 < ptObj->uiSendToDecFramesCnt)
            {
                SysWarn("Warning: rk decoder[%s] error, going to reset it\n", ptObj->strName);
                ptObj->bIsResetingDec = SMP_TRUE;
                RKResetDecode(ptObj->hDec);            /* 硬复位 VPU 通道 */
                ptObj->bIsResetingDec = SMP_FALSE;
            }
            ptObj->uiSendToDecFramesCnt = 0;
            ptObj->uiDecodeOkFramesCnt  = 0;
            uiRolls = 0;
        }
    }
    RKDecoderLinkClearFrameOutQue(ptObj);              /* 退出前排空所有队列 */
}
```

**这个主循环的 8 步，就是「一个 Link 该怎么写」的完整 checklist。** 复现时请把它当模板套：

> 退出标志 -> 暂停态 -> flush 态 -> 取输入 -> 产输出（带超时降级）-> 归还 -> 统计上报 -> 自愈。

### 4.7 动态热插拔：`SetPktCb` 的 stop、改、start 三步

`RKDecoderLinkSetPktCb`（`rkdecoderlink.cpp:866`）演示了**运行时重连上游**的正确姿势：

```c
OSAL_MutexLock(&ptObj->tStreamLock);
bStartFlag = ptObj->bStart;
if (bStartFlag) RKDecoderLinkStop(hLink);                  /* ① 先停下来 */
if (NULL != ptObj->pfGetPkt)
    RKDecoderLinkClearPreviousLinkPkt(ptObj);              /* ② 清理旧上游残留 */
RKDecoderLinkClearUserPkt(ptObj);
ptObj->pfGetPkt  = pfGetPkt;                               /* ③ 换指针 */
ptObj->pPktCbCtx = pCbCtx;
if (bStartFlag) RKDecoderLinkStart(hLink);                 /* ④ 恢复运行 */
OSAL_MutexUnlock(&ptObj->tStreamLock);
```

配合 `multiwindow` 的 `MWSwitchWindow2StreamMode` / `MWSwitchWindow2RawMode` / `MWForceUpdateRawWindow`，就实现了「**把 4 分屏的某个窗口从拉网络流切成拉本地 raw 流，不重建整条链路**」。这是产品级刚需。

### 4.8 背压：`GetBlockFrames` 与三处水位控制

```c
/* rklinkPriv.h:37 */
#define RKLINK_DEFUALT_QUE_IN_LEN   10
#define RKLINK_DEFUALT_QUE_OUT_LEN   3
```

输出池只给 **3 个帧位**，故意很小 —— 嵌入式 VPU 输出延迟敏感，宁可丢帧也不要攒 30 帧。

三处背压点：

1. `CommQue_GetEmpty(hQueOut, 0)` 返回空，生产者立刻返回 `STATE_CODE_TIME_OUT`；
2. 主循环里 `if (CommQue_GetPacketNumForRead(hQueOut) > 5) return STATE_CODE_OBJECT_BUSY;`；
3. 对外 `pfGetBlockFrames(hLink, puiMaxFrames)`，上层调度器（如 multiwindow 合成线程）据此决定是否跳过这一路，避免被慢源拖死。

### 4.9 Link 类型一览

| 宏 | 字符串 | 角色 | 产出 | 消费 |
|---|---|---|---|---|
| `RKDECODER_LINK_TYPE` | `"rkdecoder"` | 解码 | Frame | Packet（拉）/ SendPkt（推） |
| `RKENCODER_LINK_TYPE` | `"rkencoder"` | 编码 | Packet | Frame（拉） |
| `RKMERGE_LINK_TYPE` | `"rkmerge"` | 多路合成 | Frame | Frame（拉） |
| `RKSCALE_LINK_TYPE` | `"rkscale"` | RGA 缩放/色转 | Frame | Frame（拉） |
| `RKOSD_LINK_TYPE` | `"rkosd"` | 叠加 OSD | Frame | Frame（拉） |
| `RKCHROMA_LINK_TYPE` | `"rkchromaFetch"` | 色度提取 | Frame | Frame（拉） |
| `RKSLICE_DECODER_LINK_TYPE` | `"rksliced"` | 分片解码 | Frame | Packet |

---

## 5. `rk_codec`：与 `rk_link` 完全解耦的原子能力层

这一层是**纯函数式的硬件薄封装**，不含线程、不含队列。正因如此，它可以被 `multiwindow` / `streamServer` 复用，也能在单元测试里单独跑。

```
inc/rk_codec/
  rkcodecType.h    # T_RKDecoderParam / T_RKDecoderState / T_RKVideo / E_RKVideoType
  rkdecoder.h      # RKVideoDecode / RKGetDecodeFrame / RKPutDecodeFrame
                   # RKFlushDecode / RKResetDecode
  rkencoder.h      # RKVideoEncode / RKVideoEncoderPutFrame / RKVideoEncoderGetPacket
                   # RKForceIFrame / RKUpdateVideoEncoder
  rkosd.h          # RKOsdUpdateItem / RKOsdOverlay / RKOsdOverlayWithSpecificOsdSize
  rkscale.h        # RKBlendFrameOnlyBanner
  rkgpuscale.h     # GPU 缩放
  rkcompensation.h # 带校验/带 GPU 缩放的处理
  rkframe.h        # ★ 帧工厂：RKGetFrame / RKPutFrame / RKFrameCopy ...
  rkresource.h     # ★ 硬件资源仲裁：RKResourceInit / RKAllocScaler / RKAllocScalerOnCore
```

### 5.1 `rkframe.h`：绕开 Link 也能用的「帧对象」

提供统一的帧生命周期管理，是 `T_RKLinkFrame` 之下、MPP `MppFrame` 之上的一层托管。写上层业务（比如抓一张图 `MWSnapshot`）时用它，而不是直接 `mpp_frame_init`。

### 5.2 `rkresource.h`：稀缺硬件的统一仲裁 —— 最容易被忽略但价值极高

```c
E_StateCode RKResourceInit(T_RKResourceInitParam *ptParam);
void        RKResourceUnInit();
E_StateCode RKAllocScaler(UINT32 uiCap, int *piScalerId, BOOL bCopyOnly);
E_StateCode RKAllocScalerOnCore(UINT32 uiCap, int iScalerId);
void        RKResourceShow();          /* ★ 运行时打印资源占用 */
```

RK3588 的 RGA 只有 2~3 个实例、VPU 有通道上限、GPU 有多个 core。**这些资源必须全局排队分配**，否则多个 Link 各自 `create`，第 N 个就失败。

`RKResourceShow()` 更是调试神器：一行日志就能看到「谁占着 RGA 不放」，是定位「为什么开了第 9 路就开始卡」的第一现场。

> **复现建议：任何「多个模块抢同一份稀缺硬件」的系统，都必须有一个 `xxxResource` 模块。** 这是区分「玩具 SDK」和「产品级 SDK」的分水岭。

---

## 6. 其余模块速览

### 6.1 `multiwindow`（多路开窗合成）

对外约 35 个 API，两套维度的句柄：**`HANDLE hCh`（整块画布）+ `HANDLE hWindow`（单个窗口）**。

```
画布级：MWCreate / MWDelete / MWStart / MWStop / MWFreeze / MWUnFreeze
        MWFreeFrame / MWUpdateBackground / MWInvalidate
        MWSnapshot / MWSnapshotV2 / MWGetState / MWSetDebugLevel

窗口级：MWCreateWindow / MWRemoveWindow / MWUpdateWindow / MWUpdateWindowOsdItem
        MWStartWindow / MWStopWindow / MWFreezeWindow / MWUnFreezeWindow
        MWSendWindowStream            /* 直接给窗口灌码流，不经过 link */
        MWCreateRawWindow / MWRemoveRawWindow / MWUpdateRawWindow / MWForceUpdateRawWindow
        MWSwitchWindow2StreamMode / MWSwitchWindow2RawMode / MWRestartWindow
        MWStopAndClearWindowFrames / MWZeroWindowData
        MWGetWindowDecoderState / MWClearWindowDecoderBuffer
        MWGetWindowBufferInfo / MWRequestWindowBufferInfoOnSpecificTime
        MWSetWindowSnapShot
```

**设计模式：业务句柄 -> 内部 N 条 rk_link 的组合门面。** 一个 Window 内部就是一个 `rkdecoder` +（可选）`rkscale` + `rkmerge` 的子链路，`MWXXX` 只是转发。**对外是「产品概念」，对内是「流水线」。**

值得抄的三点：

* `MWFreeze / MWUnFreeze / MWInvalidate`：把「冻结画面」做成一等 API，而不是让上层自己去停线程；
* `MWRequestWindowBufferInfoOnSpecificTime`：在**指定时刻**取 buffer 信息（用于抓图对齐），比简单 snapshot 高一个维度；
* `Stream 模式 <-> Raw 模式` 热切换，且带 `bDelayStartWindow` 参数控制「是否延迟启动」—— 把细粒度控制权交给调用者。

### 6.2 `streamServer`（一个 channel 接多个 server）

```
SSCreateChannel / SSDeleteChannel
SSAddServer / SSRemoveServer            /* ★ 一个数据源 -> N 个 server，运行时增删 */
SSUpdateWordOsd / SSUpdateVideoResolution
SSPrintVideoEncInfo
```

实现分 5 个文件：`StreamServer.cpp`（门面）+ `StreamServerPriv.cpp`（私有实现）+ `SSVideoEncoder.cpp` + `SSAudioEncoder.cpp` + `StreamServerRtsp.cpp`。

注意这个 **`XXX.h` / `XXX.cpp` / `XXXPriv.cpp` 三层**：`.cpp` 只做**参数校验 + 转发**，`Priv.cpp` 才是真身。这是 C 语言版的 pimpl，好处是**改内部结构体不用重编所有调用方**。

### 6.3 `rk_blend` / `colorCvt` / `frameDup` / `audio_link`

| 模块 | 定位 | 关键符号 |
|---|---|---|
| `rk_blend` | 图层叠加 | `RkBlendFrame(srcFrame, ...)` |
| `colorCvt` | **OpenCL** 色转/缩放/锐化/小波 | `DWCLPublic` / `DWCLJob`（+ `DWCLJobImp` 私有实现）/ `DWCLContext` / `DWCLColorCvt` / `DWCLResize` / `DWCLSharpness` / `DWCLWavelet` / `opencl_wrapper.cpp` |
| `frameDup` | 把一路的帧复制给另一条消费端（既上屏又录像） | `FrameDup` |
| `audio_link` | 音频编码链 | `audioEncoderlink` |

`colorCvt` 的 `opencl_wrapper.cpp` 值得单独提：**把第三方 SDK API（这里是一整套 OpenCL 函数）全部动态加载**，是做「同一份二进制既能跑有 GPU 的板子、也能跑没 GPU 的板子」的标准做法（跑不了 GPU 的机器不会 link fail，也不会运行时崩）。

---

## 7. 复现指南：从零搭一套自己的 Link 框架

下面给一套**可直接编译运行的最小骨架**（纯 C，用 pthread 代替 OSAL）。目标是：先跑通机制，再逐个接真实硬件。

> 这套骨架不是纸上谈兵：它已经落地成真实工程并跑通全部验收（ubuntu 24.04 / gcc 13.3.0，`-Wall -Wextra` 零警告，20 万帧 RSS 增长 **0 KB**，热插拔、start/stop 100 次无崩溃）。完整可编译版本与实测记录在 `docs/verify/minilink/`，「照着写时踩到的坑」见 §7.7。

### 7.1 里程碑规划

| 阶段 | 目标 | 交付物 | 验收标准 |
|---|---|---|---|
| M1 | 类型注册表 + 名字服务 + Create/Delete | `minilink.h/.c` | 能 `MLCreate("d0","source")` 并打印出来 |
| M2 | vtable + Bind 的**拉模型** | 加 `MLBind` | Source 和 Sink 连起来，帧能流动 |
| M3 | CommQue 借用/归还 | 加对象池 | 跑 10 万帧，RSS 是一条直线（无泄漏） |
| M4 | Start/Stop/Flush 状态机 + Ctrl | 加状态机 | 反复 start/stop 100 次不崩 |
| M5 | 第一个真实 Link（接硬件） | `decoder_link.c` | 解出一帧图 |
| M6 | 状态统计 + 自愈 | 加 Stat / Reset | 拔掉网线能在 N 秒内自动恢复 |
| M7 | 业务门面层 | `multiwindow.c` | 4 路合成出图 |

**不要跳步。** M2/M3 是这套框架的全部价值所在，先在「假的 Source/Sink」上跑通，比直接怼硬件快一个数量级。

### 7.2 最小骨架：`minilink.h`（契约层）

对应源码里的 `rklink.h` + `rklinkPriv.h`。

```c
#ifndef MINILINK_H
#define MINILINK_H
#include <stdint.h>
#include <stddef.h>

/* ---- 统一返回码（对应 3.2） ---- */
typedef enum {
    E_OK = 0,
    E_INVAL,
    E_EXISTED,
    E_NOTFOUND,
    E_BEYOND,
    E_BUSY,
    E_TIMEOUT,          /* 正常语义：暂时无数据 */
    E_NOMEM,
    E_UNSUPPORTED       /* 该 link 不支持此能力 —— 能力协商靠它 */
} E_StateCode;
#define STATE_OK(e)  ((e) == E_OK)

/* ---- 数据对象 ---- */
typedef struct { void *priv; int w, h; uint64_t pts; } T_Frame;
typedef struct { uint8_t *buf; size_t len; uint64_t pts; } T_Packet;

typedef void *MLHandle;

/* ---- 函数指针 typedefs ---- */
typedef MLHandle    (*MLCreateFxn)(const char *name, void *param, size_t size);
typedef void        (*MLDeleteFxn)(MLHandle h);
typedef E_StateCode (*MLStartFxn)(MLHandle h);
typedef E_StateCode (*MLStopFxn)(MLHandle h);
typedef E_StateCode (*MLCtrlFxn)(MLHandle h, const char *cmd, void *p, size_t s, void *out);
typedef E_StateCode (*MLGetFrameFxn)(MLHandle h, T_Frame **out, uint32_t ms);
typedef E_StateCode (*MLPutFrameFxn)(MLHandle h, T_Frame *f);
typedef E_StateCode (*MLSetFrameCbFxn)(MLHandle h, MLGetFrameFxn get, MLPutFrameFxn put, MLHandle up);
typedef E_StateCode (*MLGetBlockFxn)(MLHandle h, uint32_t *max);

/* ---- ★ 虚函数表（对应 T_RKLinkBase） ---- */
typedef struct {
    const char       *pcLinkType;
    MLCreateFxn       pfCreate;
    MLDeleteFxn       pfDelete;
    MLStartFxn        pfStart;
    MLStopFxn         pfStop;
    MLCtrlFxn         pfCtrl;
    MLGetFrameFxn     pfGetFrame;
    MLPutFrameFxn     pfPutFrame;
    MLSetFrameCbFxn   pfSetFrameCb;
    MLGetBlockFxn     pfGetBlockFrames;
} T_MLinkBase;

/* ---- 门面 API（对应 rklink.h） ---- */
E_StateCode MLInit(void);
void        MLDestroy(void);
E_StateCode MLRegister(T_MLinkBase *base);
E_StateCode MLCreate(const char *name, const char *type, void *param, size_t size);
E_StateCode MLDelete(const char *name);
E_StateCode MLStart (const char *name);
E_StateCode MLStop  (const char *name);
E_StateCode MLCtrl  (const char *name, const char *cmd, void *p, size_t s, void *out);
E_StateCode MLBind  (const char *src, const char *dst);
E_StateCode MLGetFrame(const char *name, T_Frame **out, uint32_t ms);
E_StateCode MLPutFrame(const char *name, T_Frame *f);
#endif
```

### 7.3 最小骨架：`minilink.c`（框架核心）

对应 `rklink.cpp` 的前 1500 行，这里压到约 200 行。

```c
#include "minilink.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>

#define NAME_LEN 64

/* ----「运行时对象」节点（对应 T_RKLinkNode） ---- */
typedef struct T_Node {
    struct T_Node *next;                /* 简易单链表，替代 StdList */
    char           strName[NAME_LEN];   /* ★ 名字：所有 API 的寻址键 */
    T_MLinkBase   *ptBase;              /* ★ 指向「类」 */
    MLHandle       handle;              /* ★ 指向「实例」 */
    struct T_Node *ptPreLink, *ptNextLink;
} T_Node;

/* ----「全局管理者」（对应 T_RKLinkMng） ---- */
typedef struct {
    pthread_mutex_t lock;
    uint32_t        uiTypCnt;
    T_MLinkBase    *ptType;             /* 类型表：realloc 数组 */
    T_Node         *pList;              /* 对象表 */
} T_Mng;

static T_Mng *g_Mng = NULL;

static T_Node *FindNode(T_Mng *m, const char *name)
{
    for (T_Node *n = m->pList; n; n = n->next)
        if (!strcmp(n->strName, name)) return n;
    return NULL;
}
static T_MLinkBase *FindBase(T_Mng *m, const char *type)
{
    for (uint32_t i = 0; i < m->uiTypCnt; i++)
        if (!strcmp(m->ptType[i].pcLinkType, type)) return &m->ptType[i];
    return NULL;
}

/* ---------- 生命周期 ---------- */
E_StateCode MLInit(void)
{
    if (g_Mng) return E_EXISTED;                     /* ★ 防重复初始化（坑 5） */
    g_Mng = calloc(1, sizeof(T_Mng));
    if (!g_Mng) return E_NOMEM;
    pthread_mutex_init(&g_Mng->lock, NULL);
    return E_OK;
}

void MLDestroy(void)
{
    if (!g_Mng) return;                              /* ★ 未初始化直接返回 */
    while (g_Mng->pList) MLDelete(g_Mng->pList->strName);
    pthread_mutex_destroy(&g_Mng->lock);
    free(g_Mng->ptType); free(g_Mng); g_Mng = NULL;
}

/* ---------- ★ 注册「类」（对应 RKLinkRegister）---------- */
E_StateCode MLRegister(T_MLinkBase *b)
{
    if (!g_Mng || !b || !b->pcLinkType || !b->pfCreate) return E_INVAL;   /* 坑 5 */
    pthread_mutex_lock(&g_Mng->lock);
    if (FindBase(g_Mng, b->pcLinkType)) {         /* ★ 同名类型拒绝重复注册 */
        pthread_mutex_unlock(&g_Mng->lock); return E_EXISTED;
    }
    /* 注意：真实代码请用临时指针接 realloc，见第 8 节 */
    void *p = realloc(g_Mng->ptType, (g_Mng->uiTypCnt + 1) * sizeof(T_MLinkBase));
    if (!p) { pthread_mutex_unlock(&g_Mng->lock); return E_NOMEM; }
    g_Mng->ptType = p;
    memcpy(&g_Mng->ptType[g_Mng->uiTypCnt++], b, sizeof(T_MLinkBase));
    pthread_mutex_unlock(&g_Mng->lock);
    return E_OK;
}

/* ---------- ★ 创建对象（对应 RKLinkCreate）---------- */
E_StateCode MLCreate(const char *name, const char *type, void *param, size_t size)
{
    if (!g_Mng || !name || !type || !*name) return E_INVAL;

    pthread_mutex_lock(&g_Mng->lock);
    if (FindNode(g_Mng, name)) { pthread_mutex_unlock(&g_Mng->lock); return E_EXISTED; }
    T_MLinkBase *b = FindBase(g_Mng, type);
    if (!b)           { pthread_mutex_unlock(&g_Mng->lock); return E_NOTFOUND; }
    if (!b->pfCreate) { pthread_mutex_unlock(&g_Mng->lock); return E_UNSUPPORTED; }
    pthread_mutex_unlock(&g_Mng->lock);       /* ★ 放锁：pfCreate 可能很慢
                                                 （并发同名创建的竞态窗口见坑 3） */

    MLHandle h = b->pfCreate(name, param, size);
    if (!h) return E_NOMEM;

    pthread_mutex_lock(&g_Mng->lock);
    T_Node *n = calloc(1, sizeof(T_Node));
    if (!n) { b->pfDelete(h); pthread_mutex_unlock(&g_Mng->lock); return E_NOMEM; }
    snprintf(n->strName, NAME_LEN, "%s", name);   /* ★ 用 snprintf，不要 strcpy */
    n->ptBase = FindBase(g_Mng, type);   /* ★ 重新取：期间类型表可能 realloc 搬迁 */
    n->handle = h;
    n->next = g_Mng->pList; g_Mng->pList = n;
    pthread_mutex_unlock(&g_Mng->lock);
    return E_OK;
}

E_StateCode MLDelete(const char *name)
{
    if (!g_Mng || !name) return E_INVAL;             /* 坑 5 */
    pthread_mutex_lock(&g_Mng->lock);
    T_Node **pp = &g_Mng->pList;
    while (*pp && strcmp((*pp)->strName, name)) pp = &(*pp)->next;
    if (!*pp) { pthread_mutex_unlock(&g_Mng->lock); return E_NOTFOUND; }
    T_Node *n = *pp;
    /* ★ 先从拓扑里摘出去，再销毁 */
    if (n->ptPreLink)  n->ptPreLink->ptNextLink = NULL;
    if (n->ptNextLink) n->ptNextLink->ptPreLink = NULL;
    *pp = n->next;
    pthread_mutex_unlock(&g_Mng->lock);

    if (n->ptBase->pfStop)   n->ptBase->pfStop(n->handle);   /* 先停线程 */
    if (n->ptBase->pfDelete) n->ptBase->pfDelete(n->handle); /* 再释放   */
    free(n);
    return E_OK;
}

/* ---------- ★★ Bind：拉模型的回调注入（对应 RKLinkBind）---------- */
E_StateCode MLBind(const char *src, const char *dst)
{
    if (!g_Mng || !src || !dst) return E_INVAL;      /* 坑 5 */
    pthread_mutex_lock(&g_Mng->lock);
    T_Node *a = FindNode(g_Mng, src), *b = FindNode(g_Mng, dst);
    if (!a || !b) { pthread_mutex_unlock(&g_Mng->lock); return E_NOTFOUND; }
    if (a == b || a->ptNextLink || b->ptPreLink)     /* ★ 自己绑自己也要拒绝 */
    { pthread_mutex_unlock(&g_Mng->lock); return E_BEYOND; }
    T_MLinkBase *db = b->ptBase, *sb = a->ptBase;
    MLHandle     dh = b->handle,  sh = a->handle;
    pthread_mutex_unlock(&g_Mng->lock);        /* ★ 注入前放锁，避免死锁 */

    if (!db->pfSetFrameCb || !sb->pfGetFrame) return E_UNSUPPORTED;  /* 能力协商 */

    E_StateCode e = db->pfSetFrameCb(dh, sb->pfGetFrame, sb->pfPutFrame, sh);
    if (!STATE_OK(e)) return e;

    pthread_mutex_lock(&g_Mng->lock);
    a->ptNextLink = b; b->ptPreLink = a;      /* 只有注入成功才建拓扑 */
    pthread_mutex_unlock(&g_Mng->lock);
    return E_OK;
}

/* ---------- 其余门面：全部「按名查节点 -> 转发」，套路一模一样 ---------- */
E_StateCode MLGetFrame(const char *name, T_Frame **out, uint32_t ms)
{
    if (!g_Mng || !name || !out) return E_INVAL;
    *out = NULL;
    pthread_mutex_lock(&g_Mng->lock);
    T_Node *n = FindNode(g_Mng, name);
    T_MLinkBase *b = n ? n->ptBase : NULL;
    MLHandle h = n ? n->handle : NULL;
    pthread_mutex_unlock(&g_Mng->lock);
    if (!n) return E_NOTFOUND;             /* ★ 坑 4：名字不存在 ≠ 能力不支持 */
    if (!b->pfGetFrame) return E_UNSUPPORTED;
    return b->pfGetFrame(h, out, ms);
}

E_StateCode MLPutFrame(const char *name, T_Frame *f)
{
    if (!g_Mng || !name || !f) return E_INVAL;       /* 坑 5 */
    pthread_mutex_lock(&g_Mng->lock);
    T_Node *n = FindNode(g_Mng, name);
    T_MLinkBase *b = n ? n->ptBase : NULL;
    MLHandle h = n ? n->handle : NULL;
    pthread_mutex_unlock(&g_Mng->lock);
    if (!n || !b->pfPutFrame) return E_UNSUPPORTED;
    return b->pfPutFrame(h, f);
}

E_StateCode MLDo(const char *name, int start)   /* MLStart / MLStop 的公共转发 */
{
    if (!g_Mng || !name) return E_INVAL;             /* 坑 5 */
    pthread_mutex_lock(&g_Mng->lock);
    T_Node *n = FindNode(g_Mng, name);
    T_MLinkBase *b = n ? n->ptBase : NULL;
    MLHandle h = n ? n->handle : NULL;
    pthread_mutex_unlock(&g_Mng->lock);
    if (!n) return E_NOTFOUND;
    return start ? (b->pfStart ? b->pfStart(h) : E_UNSUPPORTED)
                 : (b->pfStop  ? b->pfStop(h)  : E_UNSUPPORTED);
}
E_StateCode MLStart(const char *name) { return MLDo(name, 1); }
E_StateCode MLStop (const char *name) { return MLDo(name, 0); }

E_StateCode MLCtrl(const char *name, const char *cmd, void *p, size_t s, void *out)
{
    if (!g_Mng || !name || !cmd) return E_INVAL;     /* 坑 5 */
    pthread_mutex_lock(&g_Mng->lock);
    T_Node *n = FindNode(g_Mng, name);
    T_MLinkBase *b = n ? n->ptBase : NULL;
    MLHandle h = n ? n->handle : NULL;
    pthread_mutex_unlock(&g_Mng->lock);
    if (!n || !b->pfCtrl) return E_UNSUPPORTED;
    return b->pfCtrl(h, cmd, p, s, out);
}
```

### 7.4 第一个 Link：`source_link.c`（M2/M3 阶段验证机制用）

```c
#include "minilink.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <pthread.h>
#include <time.h>

#define OUT_DEPTH 3        /* ★ 故意很小：输出延迟敏感，宁可丢帧也不攒 30 帧 */

typedef struct {
    char name[64];
    pthread_t tid;
    volatile int bDone, bStart;
    T_Frame  pool[OUT_DEPTH];    /* ★ 像素 buffer 只在这里分配一次，永不 free */
    T_Frame *full[OUT_DEPTH];    /* 就绪端 */
    T_Frame *empty[OUT_DEPTH];   /* 空闲端 */
    int nFull, nEmpty;
    pthread_mutex_t lock;
    pthread_cond_t  cond;
    uint64_t pts;
    uint64_t uiSendCnt, uiBackPressure;   /* 统计：供 Ctrl「getstat」读出 */
} T_Source;

/* ★ 下游 Outlook 是 GetFrame -> PutFrame 严格配对 */
static T_Frame *getEmpty(T_Source *o)
{
    pthread_mutex_lock(&o->lock);
    T_Frame *f = (o->nEmpty > 0) ? o->empty[--o->nEmpty] : NULL;   /* 池空 = 背压 */
    pthread_mutex_unlock(&o->lock);
    return f;
}
static void putFull(T_Source *o, T_Frame *f)
{
    pthread_mutex_lock(&o->lock);
    o->full[o->nFull++] = f;
    pthread_cond_signal(&o->cond);
    pthread_mutex_unlock(&o->lock);
}

/* ★ vtable 里的 GetFrame：下游调用它来「拉」
 * ml_cond_timedwait(c, m, ms)：CLOCK_MONOTONIC 的相对超时封装（约 10 行，见
 * docs/verify/minilink/ml_port.h）。不要用 CLOCK_REALTIME 手工算绝对时间 —— 坑 1 */
static E_StateCode SrcGetFrame(MLHandle h, T_Frame **out, uint32_t ms)
{
    T_Source *o = h;

    pthread_mutex_lock(&o->lock);
    while (o->nFull == 0) {
        if (ml_cond_timedwait(&o->cond, &o->lock, ms) != 0 || o->bDone)
        { pthread_mutex_unlock(&o->lock); return E_TIMEOUT; }     /* ★ 超时是正常 */
    }
    T_Frame *f = o->full[--o->nFull];
    pthread_mutex_unlock(&o->lock);
    *out = f;
    return E_OK;
}

/* ★ vtable 里的 PutFrame：下游用完「归还」（不是释放！） */
static E_StateCode SrcPutFrame(MLHandle h, T_Frame *f)
{
    T_Source *o = h;
    pthread_mutex_lock(&o->lock);
    o->empty[o->nEmpty++] = f;                /* 壳子回到空闲池 */
    pthread_mutex_unlock(&o->lock);
    return E_OK;
}

/* ★ 生产线程：就是 4.6 那个主循环的 8 步 */
static void *SrcTask(void *p)
{
    T_Source *o = p;
    for (;;) {
        if (o->bDone)  break;                              /* ① 退出 */
        if (!o->bStart) { usleep(10000); continue; }       /* ② 暂停 */

        T_Frame *f = getEmpty(o);                          /* ③ 借壳 */
        if (!f) { o->uiBackPressure++; usleep(1000); continue; }   /* 背压，不忙等 */

        o->uiSendCnt++;
        f->pts = ++o->pts; f->w = 1920; f->h = 1080;       /* ④ 填数据 */
        putFull(o, f);                                     /* ⑤ 入就绪队列 */
        usleep(33000);                                     /*    30fps */
    }
    return NULL;
}

static MLHandle SrcCreate(const char *name, void *param, size_t size)
{
    (void)param; (void)size;
    T_Source *o = calloc(1, sizeof(T_Source));
    snprintf(o->name, sizeof(o->name), "%s", name);
    pthread_mutex_init(&o->lock, NULL);
    pthread_cond_init(&o->cond, NULL);
    for (int i = 0; i < OUT_DEPTH; i++) {
        o->pool[i].priv = malloc(1920 * 1080 * 3 / 2);     /* 像素只分配一次 */
        o->empty[o->nEmpty++] = &o->pool[i];
    }
    o->bStart = 1;
    pthread_create(&o->tid, NULL, SrcTask, o);
    return o;
}

static void SrcDelete(MLHandle h)
{
    T_Source *o = h;
    o->bDone = 1;
    pthread_cond_broadcast(&o->cond);   /* ★ 坑 2：先唤醒所有等待者，否则 join 可能挂死 */
    pthread_join(o->tid, NULL);
    for (int i = 0; i < OUT_DEPTH; i++) free(o->pool[i].priv);
    free(o);
}

static E_StateCode SrcStart(MLHandle h) { ((T_Source*)h)->bStart = 1; return E_OK; }
static E_StateCode SrcStop (MLHandle h) { ((T_Source*)h)->bStart = 0; return E_OK; }

/* Ctrl：字符串命令扩展点（checklist 第 11 条），验收程序靠它读统计 */
static E_StateCode SrcCtrl(MLHandle h, const char *cmd, void *p, size_t s, void *out)
{
    T_Source *o = h; (void)p; (void)s;
    if (!strcmp(cmd, "getstat")) {
        if (out) {                       /* [0]=生产 [1]=背压 [2]=池深 */
            uint64_t *st = out;
            st[0] = o->uiSendCnt; st[1] = o->uiBackPressure; st[2] = OUT_DEPTH;
        }
        return E_OK;
    }
    return E_UNSUPPORTED;
}

/* ★★ 编译期常量「类」—— 必须放在文件最后 */
static T_MLinkBase g_SrcBase = {
    .pcLinkType   = "source",
    .pfCreate     = SrcCreate,
    .pfDelete     = SrcDelete,
    .pfStart      = SrcStart,
    .pfStop       = SrcStop,
    .pfCtrl       = SrcCtrl,
    .pfGetFrame   = SrcGetFrame,   /* 我是 Frame 的生产方 */
    .pfPutFrame   = SrcPutFrame,   /* 我负责回收 */
    .pfSetFrameCb = NULL,          /* 我没有上游 —— 这就是「能力协商」 */
    .pfGetBlockFrames = NULL,
};

E_StateCode SourceLinkInit(void) { return MLRegister(&g_SrcBase); }
```

**消费端 `sink_link.c` 只需要实现 `pfSetFrameCb`**（把上游的三件套存起来），然后在自己的线程里拉取、计数、归还。`T_Sink` 里加两个统计字段 `uint64_t uiFrames, uiTimeOut;`，验收程序通过 Ctrl 把它们读出来：

```c
static E_StateCode SinkSetFrameCb(MLHandle h, MLGetFrameFxn get, MLPutFrameFxn put, MLHandle up)
{
    T_Sink *o = h;
    if (!get || !put || !up) return E_INVAL;           /* ★ 别把坏回调注进来 */
    o->pfUpGet = get; o->pfUpPut = put; o->hUp = up;   /* ★ 依赖注入 */
    return E_OK;
}

static void *SinkTask(void *p)
{
    T_Sink *o = p;
    for (;;) {
        if (o->bDone) break;
        T_Frame *f = NULL;
        E_StateCode e = o->pfUpGet(o->hUp, &f, 10);    /* ① 拉 */
        if (!STATE_OK(e) || !f) { o->uiTimeOut++; continue; }  /* 超时 = 正常 */
        o->uiFrames++;
        if (o->uiFrames % 10000 == 0)                   /* 别在热路径上刷屏 */
            printf("sink frames=%llu\n", (unsigned long long)o->uiFrames);
        o->pfUpPut(o->hUp, f);                          /* ② 归还，必须配对 */
    }
    return NULL;
}

/* Ctrl：字符串命令扩展点（checklist 第 11 条） */
static E_StateCode SinkCtrl(MLHandle h, const char *cmd, void *p, size_t s, void *out)
{
    T_Sink *o = h; (void)p; (void)s;
    if (!strcmp(cmd, "getstat") && out) {
        uint64_t *st = out;                             /* [0]=已消费 [1]=超时次数 */
        st[0] = o->uiFrames; st[1] = o->uiTimeOut;
        return E_OK;
    }
    return E_UNSUPPORTED;
}
```

### 7.5 验证 main 与验收

main 只做三件事：建链、跑量、采样。**验收判据必须是机器可判定的**——帧数达标、RSS 漂移有阈值、池深恒定；「肉眼看着没崩」不算验收（坑 8）：

```c
#include "minilink.h"
#include <stdio.h>

E_StateCode SourceLinkInit(void);
E_StateCode SinkLinkInit(void);

#define TARGET_FRAMES 200000u

/* Linux 读 /proc/self/statm，Windows 用 GetProcessMemoryInfo，
 * 完整实现见 docs/verify/minilink/ml_port.h */
extern unsigned long ml_rss_kb(void);

static uint64_t SinkFrames(void)          /* 通过 Ctrl 把 sink 的计数读出来 */
{
    uint64_t st[2] = {0};
    MLCtrl("sink0", "getstat", NULL, 0, st);
    return st[0];
}

int main(void)
{
    MLInit();
    SourceLinkInit();                       /* 注册「类」 */
    SinkLinkInit();

    MLCreate("src0",  "source", NULL, 0);
    MLCreate("sink0", "sink",   NULL, 0);
    MLBind  ("src0",  "sink0");             /* ★ 一行连线 */
    MLStart ("src0"); MLStart("sink0");

    unsigned long rss0 = ml_rss_kb();
    while (SinkFrames() < TARGET_FRAMES)    /* 跑量 + 周期采样 */
        printf("frames=%-8llu RSS=%lu KB\n",
               (unsigned long long)SinkFrames(), ml_rss_kb());

    unsigned long rss1 = ml_rss_kb();
    printf("RSS %lu -> %lu KB, drift=%ld KB\n", rss0, rss1, (long)rss1 - (long)rss0);

    MLStop  ("sink0"); MLStop  ("src0");
    MLDelete("sink0"); MLDelete("src0");
    MLDestroy();
    return 0;
}
```

编译（`-D_DEFAULT_SOURCE` 是给 `-std=c11` 下的 `usleep` 用的，不加会在 glibc 上报隐式声明）：

```bash
gcc -Wall -Wextra -O2 -std=c11 -D_DEFAULT_SOURCE -pthread \
    minilink.c source_link.c sink_link.c main.c -o minilink
```

实测记录（docker ubuntu 24.04 / gcc 13.3.0，**零警告**，约 4 秒跑完）：

```text
[PASS] 反向 Bind(sink0->src0)：src 无 pfSetFrameCb -> UNSUPPORTED   ← 能力协商
[PASS] src0 已有下游，再 Bind 应拒绝              -> BEYOND          ← 拓扑守卫
起始 RSS = 1536 KB
  t= 2s  frames=123599  timeouts=566494  RSS=1536 KB
  t= 4s  frames=222203  timeouts=1020350 RSS=1536 KB
source: 生产=222206 背压=70851 池深=3
[PASS] RSS 增长 0 KB            ← M3
[PASS] 全程只分配 3 块像素 buffer（222203 帧共用）  ← 零拷贝
[PASS] 背压生效（70851 次走降级分支，不忙等）
[PASS] start/stop 100 次        ← M4
[PASS] 热插拔：删掉中间节点 relay0 再重建、重 Bind，链路恢复
[PASS] MLDestroy 无挂死
负向用例失败数: 0
```

两个数字别看错：`timeouts` 远大于帧数是**正常**的——3 帧池喂不饱消费线程，超时分支正是拉模型的空转路径（§3.2 说的「超时不是错误」在这里兑现）；RSS 从头到尾 1536 KB 纹丝不动，这就是 M3 说的「一条直线」，而且现在是**有数字的**直线。

完整验证工程（含 relay 级联、12 条负向用例、热插拔用例、Windows 移植 shim）在 `docs/verify/minilink/`，一条 `make && ./minilink` 即可复跑。

### 7.6 checklist：写第 N 个 Link 时要问自己的 12 个问题

```
1.  vtable 里，是否把所有「不支持」的槽都显式设成了 NULL？（能力协商靠这个）
2.  pfCreate 是否保证「不持有全局锁」（它可能很慢）？
3.  私有结构里有没有独立的 tStLock 统计锁？（避免统计拖慢业务路径）
4.  主循环有没有「超时即跳出」的双 timeout 写法（首帧 10ms，后续 0ms）？
5.  GetEmpty 失败时是返回 TIME_OUT/BUSY，还是忙等？（必须前者）
6.  GetFrame / PutFrame 是否严格配对？异常分支有没有漏掉归还？
7.  帧的释放是否回到了 owner 线程（而不是在消费线程里直接 free）？
8.  Stop 之后是否需要先把队列排空再退出？
9.  有没有自愈策略（连续错误计数 -> 复位硬件）？
10. 有没有对外暴露 GetState（含瞬时水位）和 GetBlockFrames？
11. Ctrl 有没有预留字符串命令形式的扩展点？
12. 这个文件能否被单独编译通过？（判断有没有隐藏的循环依赖）
```

### 7.7 照着写时踩到的坑（rk_libs / 原稿写法 vs 修正版）

§7.2–§7.6 的代码已经是**修正后**的版本（代码内注释带「坑 N」字样的位置就是改过的）。下面 8 个坑是把骨架真的写出来、在 docker 里跑起来之后才暴露的——光读代码看不出来，跑一遍全都现形：

| # | 原写法 | 问题 | 修正 |
|---|---|---|---|
| 1 | `pthread_cond_timedwait` + `CLOCK_REALTIME` 手工算绝对时间 | NTP 校时/时钟回拨会把 10ms 等成几秒，生产线程表现为「莫名卡死」 | 封装相对超时，POSIX 侧用 `CLOCK_MONOTONIC`（`ml_port.h`） |
| 2 | `SrcDelete` 只 `bDone=1` 再 join | 阻塞在 `GetFrame` 里的等待者不会被立刻唤醒，最坏要等满整个 timeout | delete 前 `pthread_cond_broadcast` |
| 3 | `MLCreate` 查名后放锁、create、再加锁插表 | 并发同名创建会造出两个同名节点，`FindNode` 永远只看见第一个（rk_libs 原样如此） | 折中：保留放锁（create 可能很慢），文档化该竞态窗口；严格场景用「占位节点」先占住名字 |
| 4 | 「名字不存在」和「不支持该能力」都返回 `E_UNSUPPORTED` | 两类错误混同，现场无法定位是配错名字还是配错类型 | 拆成 `E_NOTFOUND` / `E_UNSUPPORTED` |
| 5 | `MLRegister`/`MLDelete`/`MLCtrl` 等无 `g_Mng` 判空 | `MLInit` 之前调用直接空指针解引用；同名类型注册两次静默覆盖 | 统一补判空；重名类型返回 `E_EXISTED`；`MLCreate` 后重新按名取 base（防类型表 realloc 搬迁） |
| 6 | `T_Frame` 没有 owner 字段 | 级联/异常路径把帧归错对象，会写进别人的 `empty[]`（越界写）。rk_libs 用 `pOwner` 防的就是这个 | `T_Frame` 加 `void *pOwner`，`PutFrame` 时校验 |
| 7 | `putFull`/`empty[]` 无上溢检查 | 重复归还同一帧会写穿数组 | 归还前断言 `nEmpty < OUT_DEPTH` 且指针在池内 |
| 8 | 验收 main 只有 `sleep(10)` | M3 的「RSS 一条直线」没有可执行判据：没有帧计数、没有 RSS 采样，验收全靠感觉 | main 改为「跑够 N 帧 + 周期采样 RSS + Ctrl 读统计」，判定全部机器可判（见 §7.5） |

一句话总结：**rk_libs 的架构是对的，坑全在边界条件上**。复现时把 §7.2–§7.6 当骨架抄，把这张表当验收单过一遍。

---

## 8. 源码里值得注意的真实缺陷（复现时请避开）

读源码的价值有一半在于知道什么**不要**抄。`rk_link` 里有几处典型问题：

### 8.1 `RKLinkBind` 判空写错变量名（真实 bug）

```c
/* rklink.cpp:1366 */
ptDstNode = FindRKLinkNode(ptMng, strDtsLink);
if (NULL == ptNode)                       /* ← 应该是 ptDstNode！ */
{
    SysErr("The link name is not exist, %s\n", strDtsLink);
    eCode = STATE_CODE_OBJECT_NOT_EXIST;
    goto cleanup;
}
```

后果：目标 Link 不存在时，这个判空因为检查的是**已经确认非空的源节点**而永远为假，随后 `ptBase = ptDstNode->ptBase;` 会**空指针解引用**。
修复：`if (NULL == ptDstNode)`。

> 教训：**这种「复制上一个 if 块改名字」的代码必须重点 code review。**

### 8.2 `RKLinkRegister` 的 realloc 用法会丢内存

```c
ptMng->uiLinkTypCnt++;
ptMng->ptLinkType = realloc(ptMng->ptLinkType, uiLinkTypCnt * sizeof(T_RKLinkBase));
if (NULL == ptMng->ptLinkType) { uiLinkTypCnt--; /* 原指针已经丢了 */ }
```

`realloc` 失败返回 NULL 时**原内存块仍然有效**，这里直接覆写了指针，原数组永久泄漏。
正确写法：`void *p = realloc(...); if (p) ptLinkType = p; else {...}`（7.3 的骨架里已改正）。

### 8.3 `RKDecoderLinkPutFrame` 拿不到归还节点时会丢引用

```c
ptPut = CommQue_GetEmpty(ptObj->hQueDecPut, 0);
if (NULL == ptPut)
{
    SysErr("RKDecoderLinkPutFrame::CommQue_GetEmpty failed!\n");   /* 只打了日志 */
}
CommQue_PutEmpty(ptObj->hQueOut, ptFrame);       /* 仍然归还壳子 -> MppFrame 引用丢失 */
```

`hQueDecPut` 拿不到空节点时，这个 `MppFrame` 既没交给 MPP 释放，也没留在任何队列里 —— **VPU buffer 泄漏**。
缓解：保证 `hQueDecPut` 深度 ≥ `hQueOut` 深度（源码里是 10 / 3，通常够）；并且失败时应把帧留在 full 队列里重试，而不是直接归还。

### 8.4 字符串安全隐患

```c
static T_RKLinkNode *AddRKLinkNode(T_RKLinkMng *ptMng, const INT8 *strName)
{
    strcpy(ptNode->strName, strName);       /* strName 是 String256，无越界检查 */
}
```

固定大小 + 无长度校验，上层传一个长名字就溢出。应该用 `snprintf` + 长度检查，或改为动态 `strdup`。

### 8.5 线性查找是 O(n)

`FindRKLinkNode` / `FindRKLinkBase` 都是链表/数组的线性扫描。在 25 路场景里意味着每帧一次 O(n) 遍历。

因为 n 很小（几十个 Link），这在实践中完全够用 —— **这是正确的工程取舍（简单优于性能）**。但如果要做「频繁 create/delete link」的高动态场景，建议改成哈希表。

---

## 9. 结语：这套设计能迁移到哪里

`rk_link` 的本质是**「字符串寻址的组件容器 + 拉模型的流水线 + 对象池化的零拷贝数据面」**。这三件事都不是 Rockchip 特有的，可以迁移到任何「多阶段流式处理」的系统：

| 场景 | 复用方式 |
|---|---|
| IPC / NVR 多路预览与录像 | 直接照搬（这就是它的原生场景） |
| 视频会议 SFU 的转码流水线 | Link = decode / scale / mix / encode |
| ISP 图像处理管线 | Link = raw / demosaic / denoise / sharpen / enc |
| AI 推理前后处理 | Link = capture / resize / normalize / infer / postproc，`pfGetFrame` 换成 `pfGetTensor` |
| 音频处理链 | Link = capture / resample / AEC / encode，`audio_link` 已经是雏形 |
| 甚至是 ETL / 日志处理管道 | 只要数据是流式的、需要背压与零拷贝，机制都成立 |

**最后用三句话总结这套设计的精髓：**

1. **稳定的是「机制」，变化的是「实现」。** 把会发生变化的算法放进 `pfXXX`，把不会变化的调度与寻址放进框架层 —— 你的 SDK 就能撑过三代芯片。
2. **不要让数据源「推」，要让消费者「拉」。** 背压、零拷贝、多消费者这些问题会自动消失。
3. **先定规矩（命名、错误码、注释、目录即库），再写代码。** 这套库最值钱的部分不在某个算法，而在那 6 条让 30 个文件长成一个模样的基线。

