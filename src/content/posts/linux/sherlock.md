---
title: Sherlock 使用指南：按用户名普查 400+ 社交账号
published: 2026-11-05
description: 'Sherlock 上手指南：pipx/docker 安装、单/多用户名用法、全部命令行参数速查、输出格式与误报核实，以及 data.json 探测规则的原理与使用边界。'
image: 'https://www.loliapi.com/bg/'
tags: [OSINT, 安全工具, Python]
category: '安全工具'
draft: false
lang: 'zh-CN'
---

「安全工具」分类开篇——[sherlock-project/sherlock](https://github.com/sherlock-project/sherlock)。一句话定位：**按一个用户名，在 400+ 个社交网站上探测对应账号是否存在**。103.9k stars、MIT 协议、Python 3.10+（项目已弃用 3.8/3.9），是 OSINT / 信息收集圈最常用的起步工具之一。

典型场景：自查某个昵称在各平台的暴露面、品牌名是否被抢注、安全研究中的公开信息收集——**它只查公开可访问的页面**，不涉及任何登录态或私有数据。

## 一、安装

三条路，按推荐顺序：

```bash
# 1. pipx（推荐，隔离环境不污染系统 Python）
pipx install sherlock-project

# 2. Docker
docker run -it --rm sherlock/sherlock user123

# 3. pip / uv
pip install sherlock-project
uv tool install sherlock-project
```

**注意一个坑**：README 明确提示 ParrotOS 和 Ubuntu 24.04 的第三方维护包**已损坏**，这两个系统的用户请改用 pipx / uv / Docker。Debian ≥13、Ubuntu ≥22.10、Homebrew、Kali、BlackArch 有社区维护包，但不受项目直接支持。装完执行 `sherlock --version` 确认是 0.16.0 左右的新版本。

## 二、基本用法

```bash
sherlock user123                  # 查一个用户名
sherlock user1 user2 user3        # 查多个
sherlock "user{?}name"            # 变体探测：{?} 会被依次替换为 _ - . 各查一遍
```

输出默认落在当前目录：**单个用户名生成 `user123.txt`**，多个用户名要配合 `--folderoutput <目录>` 把各自的 txt 收进一个文件夹。每个文件的内容就是命中的站点 URL 列表，一行一个。

## 三、参数速查

按用途分四类记：

| 类别 | 参数 | 作用 |
| --- | --- | --- |
| **输出** | `-o FILE` / `-fo DIR` | 单用户输出文件 / 多用户输出目录 |
| | `--csv` `--xlsx` `--txt` | 额外生成 CSV / Excel / txt |
| | `-j JSON` | 从 JSON 文件或在线 JSON 加载站点列表 |
| **过滤** | `--site NAME`（可重复） | 只查指定站点，调试和定向排查用 |
| | `--print-all` / `--print-found` | 打印未命中 / 只打印命中 |
| | `--nsfw` | 包含 NSFW 站点（默认跳过） |
| | `--ignore-exclusions` | 忽略上游误报排除名单（误报会变多） |
| **网络** | `--timeout N` | 单请求超时，默认 60 秒 |
| | `-p URL` | 走代理，如 `socks5://127.0.0.1:1080` |
| | `-l / --local` | 强制用本地 `data.json`，不拉远端更新 |
| **调试** | `-v` | 额外调试信息与统计 |
| | `--dump-response` | 把 HTTP 响应打到 stdout，排查误报用 |
| | `-b / --browse` | 结果自动在浏览器打开 |

## 四、输出怎么读

每个命中的行是一条 `https://站点/用户名` 的 URL。两个必须知道的现实：

1. **存在 ≠ 是本人**：大部分站点只要 URL 返回「不像 404」就算命中，同名账号非常常见
2. **存在误报**：站点改版、反爬页、SPA 返回 200 空壳都会造成误报。项目维护者用远端 `false_positive_exclusions.txt` 定期排除已知误报——所以 `--ignore-exclusions` 要慎用

核实方法：对可疑条目用 `--site` 单独重查 + `--dump-response` 看返回体；或者直接 `--browse` 人工过一遍。

## 五、原理：一张 data.json 表

Sherlock 是个「规则驱动」的探测器——每个站点在 `sherlock_project/resources/data.json` 里有一条规则，核心字段：

- `url`：用户主页模板，`{}` 是用户名占位符
- `urlProbe`：直接请求 `url` 不可靠时（SPA、需 API）改用的探测地址
- `errorType`：判断「不存在」的方式——`status_code`（按状态码，如 404/204）、`message`（正文里出现 `errorMsg` 特征串）、`response_url`（被重定向到 `errorUrl`）
- `regexCheck`：用户名格式正则，不匹配就**跳过该站点**，不发请求（比如 GitHub 的用户名规则）
- 进阶字段：`request_method`/`request_payload`（POST 或 GraphQL 查询）、`headers`（自定义 UA/语言）、`isNSFW`、`username_claimed`（已知存在的用户名，用于自测）

所以它不改每个站点的爬虫，只维护一张「怎么访问 + 怎么判断」的表——这也是 400+ 站点能长期维护的原因。加站点 = 加一条 JSON，社区 PR 即可。

## 六、使用边界

- **只用公开页面信息**：结果只是「该用户名在某站是否存在」的线索，不是身份归属证据
- **遵守当地法律和站点条款**：批量请求注意频率，必要时用 `--timeout` 和代理；部分站点明确禁止自动化访问
- **不要用于跟踪、骚扰或人肉**：这类行为在多数司法辖区违法；工具本身合法不代表用法都合法
- **结果必须人工核实**：误报是常态，别把工具输出当结论

## 写在最后

Sherlock 的价值不在技术复杂度（本质就是模板化请求 + 响应判定），而在**规则表这种把「数据」和「逻辑」分开的设计**——和站内[《C 语言去样板代码十技巧》](/posts/rt/c-tips/)里「查表代替分支」的思路一模一样：新增站点不用改代码，只改数据。这也是所有规模化工具的共同选择。

## 参考资料

- 仓库：[sherlock-project/sherlock](https://github.com/sherlock-project/sherlock)（MIT）
- 官网与文档：[sherlockproject.xyz](https://sherlockproject.xyz)（installation / usage / sites 列表）