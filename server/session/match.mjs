/* 一局游戏 = 一个 DSH runtime 子进程 + N 个座位 session。

   信息隔离怎么保证？
   后端**不持有整局状态**。浏览器那边的规则引擎在每次需要某个子代理行动时，
   只把 buildReq() 过滤好的那一个 req（已经按 visibleTo 裁过）发给后端。
   后端拿到的东西 = 那个子代理该看到的东西，一个字节不多。
   所以后端连泄密的能力都没有——它不知道别人的身份。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DshRuntime, attemptsFor } from '../dsh/runtime.mjs';
import { writePatch } from '../dsh/patch.mjs';
import { writeRoster, sessionIdFor } from '../dsh/roster.mjs';
import { seedHome } from '../dsh/home.mjs';
import { materializeProviderPlugins, channelLabel } from '../dsh/providers.mjs';
import { buildPrompt } from '../game/prompt.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PLUGIN = path.join(ROOT, 'server', 'dsh', 'werewolf-plugin.mjs');

/** 询问类型 -> 子代理回传的 act 参数该翻译成什么 payload 给规则引擎 */
function toPayload(type, act) {
  const kind = act && act.kind;
  const target = Number((act && act.target) || 0) || 0;
  const text = String((act && act.text) || '').trim();

  switch (type) {
    case 'speak':
    case 'wolf_talk':
      return text || '……';
    case 'vote':
      /* kind=pass = 弃票，target 记 0 */
      return kind === 'pass' ? 0 : target;
    case 'wolf_vote':
    case 'seer_check':
    case 'guard_pick':
    case 'hunter_gun':
      return target;
    case 'witch_save':
      return kind === 'save';
    case 'witch_poison':
      return kind === 'poison' ? target : 0;
    default:
      return null;
  }
}

export class Match {
  /**
   * @param {string} id
   * @param {object|null} [channel] 玩家这一局选的通道 {provider, model, reasoningEffort?}
   */
  constructor(id, channel) {
    this.id = id;
    this.channel = channel || null;
    this.runtime = null;
    this.homeDir = '';
    this.seats = [];
    this.warnings = [];
    this.startedAt = Date.now();
    this.turns = 0;
  }

  /**
   * @param {Array<{seat:number,name:string,roleId:string}>} seats 只传子代理的座位，不含用户自己
   */
  async start(seats) {
    this.seats = seats;
    this.homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-dsh-'));

    const patchPath = path.join(this.homeDir, 'patch.yml');
    const rosterPath = path.join(this.homeDir, 'roster.json');
    const homeDir = path.join(this.homeDir, 'home');

    /* 临时 DSH_HOME 里没有桌面版的登录态：把凭据与渠道台账复制进去
       （复制而不是指原文件，游戏进程就不会回写到桌面版状态）。 */
    const seeded = seedHome(homeDir);
    this.seeded = seeded;
    if (seeded.note) this.warnings.push(seeded.note);

    writeRoster({ outFile: rosterPath, matchId: this.id, seats });
    const readyFile = path.join(this.homeDir, 'providers.json');
    writePatch({
      outFile: patchPath,
      pluginPath: PLUGIN,
      rosterPath,
      credentialsPath: seeded.credentialsPath,
      providerPlugins: materializeProviderPlugins(),
      readyFile,
    });

    this.runtime = new DshRuntime({
      patchPath,
      homeDir,
      cwd: ROOT,
      channel: this.channel,
      readyFile,
    });
    await this.runtime.start();
    return this;
  }

  /**
   * 让某个座位的子代理做一个决定。
   * @param {object} req rules.js buildReq() 的产物
   * @returns {Promise<object|null>} 可直接喂给 engine.resumeAgent() 的 payload
   */
  async ask(req) {
    if (!this.runtime) return null;
    const seat = Number(req && req.seat) || 0;
    if (!seat) return null;

    const sid = sessionIdFor(this.id, seat);
    const prompt = buildPrompt(req);

    this.turns += 1;
    let act = null;
    let lastErr = null;
    const attempts = attemptsFor(this.channel);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        /* 把本回合允许的行动种类告诉插件，插件据此拒绝越权提交 */
        this.runtime.child.send({ t: 'turn', sid, kinds: prompt.kinds, cands: prompt.cands });
        act = await this.runtime.turn(sid, prompt.text);
      } catch (e) {
        lastErr = e;
        this.warnings.push('座位 ' + seat + ' 回合失败：' + e.message);
        act = null;
      }
      if (act) break;
    }

    /* 两次都没拿到行动就明说，不要假装它「选择不说话」——
       那种兜底只会让人看到一堆省略号，还查不出是哪儿坏了。 */
    if (!act) {
      /* 优先报子进程自己吐出来的错误（Key 无效 / 额度用完 / 网络不通） */
      const problem = this.runtime ? this.runtime.lastProblem() : '';
      const why = problem || (lastErr ? lastErr.message : '子代理没有提交任何行动');
      const rt = this.runtime;
      const onChannel = rt ? '（通道 ' + (channelLabel(rt.provider) || rt.provider) + ' / ' + rt.model + '）' : '';
      throw new Error('座位 ' + seat + '「' + (req.name || '') + '」无回应' + onChannel + '：' + why);
    }
    return toPayload(req.type, act);
  }

  async stop() {
    if (this.runtime) {
      try { await this.runtime.stop(); } catch { /* ignore */ }
      this.runtime = null;
    }
    /* 局末清干净：patch、roster、session 落盘全在这个临时目录里 */
    if (this.homeDir) {
      try { fs.rmSync(this.homeDir, { recursive: true, force: true }); } catch { /* ignore */ }
      this.homeDir = '';
    }
  }
}

const matches = new Map();

export function createMatch(seats, channel) {
  const id = 'm' + crypto.randomBytes(5).toString('hex');
  const m = new Match(id, channel);
  matches.set(id, m);
  return m;
}

export function getMatch(id) {
  return matches.get(id) || null;
}

export async function dropMatch(id) {
  const m = matches.get(id);
  if (!m) return false;
  matches.delete(id);
  await m.stop();
  return true;
}

export async function dropAll() {
  const all = [...matches.values()];
  matches.clear();
  await Promise.all(all.map((m) => m.stop()));
}