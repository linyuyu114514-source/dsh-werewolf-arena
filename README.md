我没有任何编程基础，此项目完全由Ai编程制作。
如果你遇到bug提交给我，我大概率是看不懂的，建议也让AI帮你解决。
# 大肥鱼狼人杀（Werewolf Arena）

网页狼人杀。除你以外的所有玩家都由 DeepSeek Harness 子代理扮演，
每个子代理只看到自己该看到的信息，一局结束全部释放、互不继承上下文。

## 怎么玩

**电脑上必须安装DeepSeek Harness桌面版，并正确连接API。**
**双击 `启动游戏.bat`** 就行。它会自己找 Node、起服务、把浏览器打开。

想换个端口：把 `启动游戏.bat` 拖到命令行后面加个数字，或者直接改文件里第一行的 `set "PORT=8787"`。

手动启动也可以：

```
cd 项目文件夹
node server/index.mjs
```

然后浏览器打开 <http://127.0.0.1:8787> 。

> 直接双击 `web/index.html` 只能看界面，连不上子代理——页面会明确提示你改用上面的地址。

启动时终端会打印两行：

```
狼人杀后端已启动：http://127.0.0.1:8787
子代理身份：DeepSeek Harness 已连接（复用桌面版登录态）
```

## 换一台电脑怎么跑

把整个文件夹拷过去，双击 `启动游戏.bat`。就这样。

前提只有一个：那台电脑装着 **DeepSeek Harness 桌面版**，并且**登录过一次**（子代理是用你的登录态在跑，不用填 API Key）。

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

## 目录

```
web/            纯前端（不需要构建，改完刷新即可）
  index.html
  assets/       样式、SVG 头像、规则引擎、对局驱动、后端桥
server/         Node 后端
  index.mjs     静态站点 + /api
  session/      一局游戏 = 一个 DSH 子进程
  dsh/          DSH 运行时、patch、陪玩插件
  game/          req -> 提示词
test/           规则引擎单元测试（node test/rules.test.mjs）
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

## 文档

- 项目框架方案：[docs/项目框架方案.md](docs/项目框架方案.md)
- 技术验证报告（全部实测数据）：[docs/技术验证报告.md](docs/技术验证报告.md)
