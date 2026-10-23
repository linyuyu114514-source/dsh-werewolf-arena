/* 一个 DSH runtime 子进程 = 一局游戏。
   进程里跑 N 个 session（每个座位一个），session 之间上下文完全隔离。
   局末 shutdown + kill，磁盘上不留任何东西（patch 里已关掉 sessions 持久化）。 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { DSH_EXE, DSH_CLI, authRoute } from './paths.mjs';

/* 单个回合最多等这么久。
   官方通道实测一次行动 2–6 秒，18 秒还没动静就是真卡了；
   非官方渠道（CodeArts、TRAE 这类）服务端更慢，而且模型可能带着推理在跑，
   实测同一个提示词要几十秒，所以给它 45 秒。WW_TURN_TIMEOUT_MS 可以硬覆盖。 */
const TURN_TIMEOUT_MS_FAST = 18_000;
const TURN_TIMEOUT_MS_SLOW = 150_000;
function isSlowChannel(channel) {
  return Boolean(channel && channel.plugin);
}
function turnTimeoutFor(channel) {
  const forced = Number(process.env.WW_TURN_TIMEOUT_MS || 0);
  if (forced > 0) return forced;
  return isSlowChannel(channel) ? TURN_TIMEOUT_MS_SLOW : TURN_TIMEOUT_MS_FAST;
}
/** 慢通道重试一次要再等两分半，不划算：宁可一次问到底，超时就直接报错 */
export function attemptsFor(channel) {
  return isSlowChannel(channel) ? 1 : 2;
}
const INIT_TIMEOUT_MS = 40_000;
/* 等"玩家选的通道"在 DSH 里上线：实测第三方渠道从进程启动到出现要 1–4 秒 */
const PROVIDER_READY_MS = 25_000;

export class DshRuntime extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.patchPath  patch.yml
   * @param {string} o.homeDir    DSH_HOME（临时目录，进程退出后可整目录删除）
   * @param {string} o.cwd        工作目录（沙箱根）
   * @param {object} [o.channel]   玩家这一局选的通道 {provider, model, reasoningEffort?}
   */
  constructor(o) {
    super();
    this.channel = o.channel || null;
    /* 枚举插件把"现在有哪些通道"写在这里；有它就先等着，没有就直接开局 */
    this.readyFile = o.readyFile || '';
    this.patchPath = o.patchPath;
    this.homeDir = o.homeDir;
    this.cwd = o.cwd || process.cwd();
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.closed = false;
    this.ready = false;
    /* sessionId -> 该座位的等待队列。同一座位同一时刻只有一个回合在跑。 */
    this.busy = new Map();
    /* sessionId -> 最近一次 turn/end 之前的工具提交 */
    this.submissions = new Map();
    /* sessionId -> 本回合是否已提交（防重复调用） */
    this.turnUsed = new Set();
    this.provider = 'deepseek-account';
    this.model = 'deepseek-flash';
    /* 子进程 stderr 的尾巴：回合没提交行动时用来解释为什么 */
    this.stderrTail = '';
    /* 最近一轮 turn/end 的 reason，用来解释「为什么没提交行动」 */
    this.lastTurnReason = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => { if (!done) { done = true; reject(e); } };

      const child = spawn(
        DSH_EXE,
        ['--expose-internals', DSH_CLI, '--profile', 'sdk-minimal', '--patch', this.patchPath],
        {
          cwd: this.cwd,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: this.homeDir },
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          windowsHide: true,
        }
      );
      this.child = child;

      child.on('error', fail);
      child.on('exit', (code) => {
        this.closed = true;
        for (const { reject: rj } of this.pending.values()) {
          rj(new Error('DSH 进程已退出 (code ' + code + ')'));
        }
        this.pending.clear();
        this.emit('exit', code);
      });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._onStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (s) => {
        this.stderrTail = (this.stderrTail + s).slice(-4000);
        this.emit('log', s);
      });

      /* 插件通过 process.send 回传的一切都走这条通道 */
      child.on('message', (m) => this._onIpc(m));

      const timer = setTimeout(() => fail(new Error('DSH 启动超时')), INIT_TIMEOUT_MS);

      /* 通道优先用玩家选的那个（可能是桌面版里接的非官方渠道）；
         没选就沿用身份路线：有 API Key 走官方 API，否则走桌面版登录态。

         reasoningEffort 只在玩家明确选了一个、并且那个模型自己声明支持时才带：
         DSH 对"没声明 reasoning 能力的模型"收到这个字段会直接抛
         does not support reasoning effort，整局就废了。 */
      const route = authRoute();
      this.provider = (this.channel && this.channel.provider) || route.provider;
      this.model = (this.channel && this.channel.model) || 'deepseek-flash';
      const initParams = { cwd: this.cwd, provider: this.provider, model: this.model };
      if (this.channel && this.channel.reasoningEffort) {
        initParams.reasoningEffort = this.channel.reasoningEffort;
      }
      /* 通道插件上线是异步的：先等它出现，免得 initialize 撞上
         no adapter registered for provider。等不到也照样往下走——
         真有问题就让 DSH 自己把话说清楚，而不是我们猜。 */
      this.waitForProvider(initParams.provider, PROVIDER_READY_MS)
        .then(() => this.call('initialize', initParams))
        .then(() => {
        clearTimeout(timer);
        this.ready = true;
        if (!done) { done = true; resolve(this); }
      }, (e) => { clearTimeout(timer); fail(e); });
    });
  }

  /**
   * 等选定的 provider 出现在枚举文件里（枚举插件每几秒写一批）。
   * @param {string} provider
   * @param {number} timeoutMs
   * @returns {Promise<string[]>} 超时也返回：调用方只看等了多久，不看结果
   */
  waitForProvider(provider, timeoutMs) {
    if (!this.readyFile) return Promise.resolve([]);
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = () => {
        let ids = [];
        try {
          const snaps = JSON.parse(fs.readFileSync(this.readyFile, 'utf8')).snapshots || [];
          const last = snaps[snaps.length - 1];
          ids = ((last && last.providers) || []).map((p) => (typeof p === 'string' ? p : p.id));
        } catch { /* 文件还没写出来 */ }
        if (ids.indexOf(provider) >= 0) { resolve(ids); return; }
        if (Date.now() >= deadline) { resolve(ids); return; }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  _onStdout(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'JSON-RPC 错误'));
        else resolve(msg.result);
      } else if (msg.method) {
        this._onNotify(msg.method, msg.params);
      }
    }
  }

  _onNotify(method, params) {
    if (method !== 'session.event' || !params) return;
    const sid = String(params.sessionId);
    const ev = params.event || {};
    if (ev.type === 'turn/start') {
      /* 新一轮开始：清掉上一轮的提交记录，允许再次提交 */
      this.turnUsed.delete(sid);
      this.submissions.delete(sid);
    }
    this.emit('event', sid, ev);
  }

  _onIpc(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'act') {
      this.submissions.set(String(m.sid), m.args);
      this.emit('act', String(m.sid), m.args);
    } else if (m.t === 'created') {
      this.emit('created', String(m.sid));
    } else if (m.t === 'log') {
      this.emit('log', String(m.text || ''));
    }
  }

  call(method, params) {
    if (this.closed) return Promise.reject(new Error('DSH 进程未运行'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** 同一个座位串行：上一轮没结束就不发新的 */
  _lock(sid) {
    const prev = this.busy.get(sid) || Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    this.busy.set(sid, prev.then(() => next));
    return prev.then(() => release);
  }

  /**
   * 让某个座位跑一个回合，返回它这一回合提交的行动。
   * @param {string} sid
   * @param {string} prompt
   * @returns {Promise<object|null>} act 参数；超时或未提交返回 null
   */
  async turn(sid, prompt) {
    const release = await this._lock(sid);
    const waiter = this._waitTurnEnd(sid, turnTimeoutFor(this.channel));
    try {
      this.turnUsed.delete(sid);
      this.submissions.delete(sid);
      await this.call('session/prompt', {
        sessionId: sid,
        contentBlocks: [{ type: 'text', text: prompt }],
      });
      await waiter.promise;
      /* 等一拍，让 ipc 的 act 消息落地（它比 turn/end 稍晚） */
      await sleep(100);
      return this.submissions.get(sid) || null;
    } finally {
      waiter.cancel();
      release();
    }
  }

  /* 回合结束的可靠信号是 session.event 的 turn/end。
     监听必须在 session/prompt 之前挂上，否则可能错过。 */
  _waitTurnEnd(sid, timeoutMs) {
    let timer = null;
    let onEvent = null;
    let settle = null;

    function done(err) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (onEvent) { this.off('event', onEvent); onEvent = null; }
      const s = settle;
      settle = null;
      if (!s) return;
      if (err) s.reject(err); else s.resolve();
    }
    const finish = done.bind(this);

    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject };
      onEvent = (s, ev) => {
        if (s !== sid) return;
        if (!ev || ev.type !== 'turn/end') return;
        /* turn/end 的 data.reason 里带着这一轮为什么结束。
           kind==='error' 说明模型调用失败（Key 无效、额度用完、网络不通），
           这时候子代理根本没法提交行动，必须把原因带出去。 */
        const reason = (ev.data && ev.data.reason) || null;
        this.lastTurnReason = reason;
        if (reason && reason.kind === 'error') {
          const e = (reason.error || reason.failure || {});
          finish(new Error(String(e.message || '模型调用失败')));
          return;
        }
        finish(null);
      };
      timer = setTimeout(() => finish(new Error('座位 ' + sid + ' 回合超时')), timeoutMs);
      this.on('event', onEvent);
    });
    promise.catch(() => {});   /* 取消时不让它变成未处理拒绝 */

    return { promise, cancel: () => finish(new Error('已取消')) };
  }

  /**
   * 从 stderr 尾巴里挑一句最能说明问题的错误。
   * 模型调用失败（Key 无效、额度用完、网络不通）时子代理不会提交行动，
   * 只报「没有回应」等于没说，所以把真正的原因捞出来。
   * @returns {string} 没有可读错误时返回空串
   */
  lastProblem() {
    const reason = this.lastTurnReason;
    if (reason && reason.kind === 'error') {
      const e = reason.error || reason.failure || {};
      const msg = String(e.message || '');
      if (msg) return msg;
    }
    const tail = String(this.stderrTail || '');
    if (!tail.trim()) return '';
    const lines = tail.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const hit = lines.filter((s) => /error|invalid|unauthor|401|403|429|failed|refus/i.test(s));
    const pick = hit.length ? hit[hit.length - 1] : lines[lines.length - 1];
    return pick.length > 240 ? pick.slice(0, 240) + '…' : pick;
  }

  async stop() {
    if (this.closed) return;
    try {
      await Promise.race([this.call('shutdown', {}), sleep(1500)]);
    } catch { /* 已经关了 */ }
    try { this.child && this.child.kill(); } catch { /* ignore */ }
    this.closed = true;
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}