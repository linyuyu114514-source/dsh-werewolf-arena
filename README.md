# 大肥鱼狼人杀（Werewolf Arena）

网页狼人杀。除你以外的所有玩家都由 DeepSeek Harness 子代理扮演，
每个子代理只看到自己该看到的信息，一局结束全部释放、互不继承上下文。

## 怎么玩

**双击 `启动游戏.bat`** 就行。它会自己找 Node、起服务、把浏览器打开。

想换个端口：把 `启动游戏.bat` 拖到命令行后面加个数字，或者直接改文件里第一行的 `set "PORT=8787"`。

手动启动也可以：

```
cd 项目文件夹
node server/index.mjs
```

然后浏览器打开 <http://127.0.0.1:8787> 。

> 直接双击 `web/index.html` 只能看界面，连不上子代理——页面会明确提示你改用上面的地址。

启动时终端会打印三行：

```
狼人杀后端已启动：http://127.0.0.1:8787
子代理身份：DeepSeek Harness 已连接（复用桌面版登录态）
默认通道：DeepSeek 官方账号 / deepseek-flash
```

## 换一台电脑怎么跑

把整个文件夹拷过去，双击 `启动游戏.bat`。就这样。

前提只有一个：那台电脑装着 **DeepSeek Harness 桌面版**，并且**登录过一次**（子代理是用你的登录态在跑，不用填 API Key）。

AI 通道面板会自动适配新机器：装了哪些插件、登录了哪些渠道，它就列哪些。
对方机器上没装第三方通道插件时，面板只列两条官方通道，游戏照跑；
一条都不可用（既没登录也没填 Key）时，点开始游戏会当场被拒，并说明缺什么。
实测数据见 [docs/多通道验证.md](docs/多通道验证.md) 第 9 节。

装在不同盘、不同路径都不用管——`启动游戏.bat` 和 `server/dsh/paths.mjs` 会自己找：

1. 环境变量 `WW_DSH_HOME`
2. `%LOCALAPPDATA%\Programs\DeepSeek Harness`
3. `%ProgramFiles%\DeepSeek Harness`
4. `C:\ D:\ E:\ F:\ G:\DeepSeek Harness`

Node 也一样：优先用 DSH 自带的那份，没有再找系统里的 `node`，最后还能借 `DeepSeek Harness.exe` 以 Node 模式启动。所以**目标机器上不装 Node 也能跑**。

### 没有登录态？用 API Key

在项目根目录建一个 `.env`（可复制 `.env.example`），填一行：

```
DEEPSEEK_API_KEY=sk-你的key
```

后端启动时会自动加载它，身份路线自动切成 API Key 通道。两条路线哪条能用就走哪条，不用改代码。

> `DEEPSEEK_BASE_URL` 不能写在 `.env` 里（会被 DSH 启动层拦掉），要改端点请用系统环境变量。

### 换一家 API 陪你玩（AI 通道）

首页「选一局」里有一个 **AI 通道** 区块：先选通道、再选模型，
点开就列出**这台机器上 DeepSeek Harness 当前接入了什么**——
不是写死的清单：你桌面版里装了什么插件、登录了哪些渠道，它就列什么。

```
通道               模型                 典型耗时
--------------------------------------------------------
DeepSeek 官方账号   deepseek-flash       一轮 2–6 秒
CodeArts（华为云）  deepseek-v4.1-flash  一轮 80 秒上下
TRAE（字节）        39 个模型            同量级
免费通道（匿名）     25 个模型            免登录；上游额度用尽时会原样报错
```

- 选择会存进 localStorage，下一局沿用；开一局时随座位表一起发给后端，
  页面底部的状态行实时显示当前用的哪个通道。
- **非官方渠道是用你桌面版里的登录态在跑**：先在 DeepSeek Harness 桌面版里装好插件
  （这台机器上实测的是 `dsh-our-free-model`，带 11 个账号渠道 + 匿名免费通道）、登录对应渠道，
  游戏这边点「重新检测」就能看到它。
- 没登录 / 没授权的渠道会标成不可用并写明原因，不点它就行。
- 列表里的「可用」只代表它报出了模型、并且有身份可用，**不代表上游还有额度**：
  实测匿名免费通道会原样报 `Free usage limit reached. Subscribe to OpenCode Go…`，
  这种时候错误里带着通道名和上游原话，换一条通道重开即可。
- 非官方渠道慢得多，后端给它们单独放宽了超时（见下面环境变量）。
  9 人局用这类渠道会明显久一些，试水建议先用官方账号或免费通道。
- 通道 × 模型的实测数据、踩过的坑，全部在 [docs/多通道验证.md](docs/多通道验证.md)。

### 起不来怎么查

浏览器首页底部有一条后端状态提示，直接告诉你卡在哪：
连不上后端 / 后端在跑但找不到 DSH / 没有可用身份。

终端里也会打印一行诊断，例如「找不到 DeepSeek Harness 的安装目录」。游戏里如果子代理不回话，报错会带上真实原因（Key 无效、额度用完、网络不通都会原样显示），不是一句干巴巴的「没有回应」。

### 环境变量

| 变量 | 含义 | 默认值 |
| --- | --- | --- |
| `WW_PORT` | 后端端口 | `8787` |
| `WW_DSH_HOME` | DSH 安装目录 | 自动探测 |
| `WW_NODE` | 指定 Node 可执行文件 | 自动探测 |
| `WW_AUTH` | 强制身份路线：`account` / `api-key` | 自动判断 |
| `WW_DSH_EXE` | DSH 主程序 | 由安装目录推出 |
| `WW_DSH_CLI` | DSH 的 CLI 入口 | 由安装目录推出 |
| `WW_DSH_CREDENTIALS` | 复用桌面版登录态的凭据文件 | `%USERPROFILE%/.dsh/.credentials.yaml` |
| `DEEPSEEK_API_KEY` | API Key 通道（也可写在 `.env`） | 空 |
| `WW_PROVIDER` | 默认通道（首页所选优先于它） | 由身份路线决定 |
| `WW_MODEL` | 默认模型 | `deepseek-flash` |
| `WW_TURN_TIMEOUT_MS` | 单个回合最多等多久（毫秒），覆盖分档默认值 | 官方 18 秒 / 非官方 150 秒 |
| `WW_DSH_USER_HOME` | 桌面版真实 DSH_HOME（只读来源） | `%USERPROFILE%\.dsh` |

## 目录

```
web/            纯前端（不需要构建，改完刷新即可）
  index.html
  assets/       样式、SVG 头像、规则引擎、对局驱动、后端桥
server/         Node 后端
  index.mjs     静态站点 + /api（/api/health、/api/providers、/api/match…）
  session/      一局游戏 = 一个 DSH 子进程
  dsh/          DSH 运行时、patch、陪玩插件
    providers.mjs         问出「当前 DSH 接入了哪些通道与模型」，并借用第三方通道插件
    home.mjs              把桌面版的凭据与台账复制进临时 DSH_HOME（只读来源）
    enumerate-plugin.mjs  挂在 DSH 里的枚举插件（llm.listProviders / listModels）
  game/          req -> 提示词
test/           规则引擎单元测试（node test/rules.test.mjs）
                通道枚举冒烟（node test/channels.test.mjs，约 30 秒）
                端到端一局冒烟（node test/match-smoke.mjs [通道] [模型]）
docs/           框架方案、技术验证报告
```

## 已实现

- 6 / 9 / 12 人三种模式，六种身份全部实现（狼人、村民、预言家、女巫、猎人、守卫）
- 完整昼夜状态机：夜间行动 → 天亮公布 → 依次发言 → 依次投票 → 放逐 → 遗言 → 下一夜
- 子代理接管所有非玩家座位，逐座位询问、逐条推进
- 局末释放：DSH 子进程退出、临时目录删除、不写任何会话文件
- 结算弹窗：全场身份公开、再来一局 / 返回首页
- 白天投票可弃票：玩家在投票条上选「弃票」，子代理也能 `kind=pass` 弃票
- 首页开局方式开关：普通模式（身份座位全随机）/ 自选模式（自己指定身份与座位号，其他玩家仍随机）
- 首页 AI 通道面板：动态列出当前 DSH 接入的通道与模型（官方账号 / API Key / CodeArts、TRAE、Qoder、Cline、Loomy 等非官方渠道 / 匿名免费通道），选完直接开局；不可用的通道写明原因
- 非官方渠道开局前先等它真的上线再起步；这类渠道慢，超时按通道分档，出错如实报出通道名与原因，绝不悄悄换成别的模型

## 文档

- 项目框架方案：[docs/项目框架方案.md](docs/项目框架方案.md)
- 技术验证报告（全部实测数据）：[docs/技术验证报告.md](docs/技术验证报告.md)
- 多通道验证（非官方 API 怎么接进来、踩过哪些坑）：[docs/多通道验证.md](docs/多通道验证.md)