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
import { DshRuntime } from '../dsh/runtime.mjs';
import { writePatch } from '../dsh/patch.mjs';
import { writeRoster, sessionIdFor } from '../dsh/roster.mjs';
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
  constructor(id) {
    this.id = id;
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

    writeRoster({ outFile: rosterPath, matchId: this.id, seats });
    writePatch({ outFile: patchPath, pluginPath: PLUGIN, rosterPath });

    this.runtime = new DshRuntime({
      patchPath,
      homeDir: path.join(this.homeDir, 'home'),
      cwd: ROOT,
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
      throw new Error('座位 ' + seat + '「' + (req.name || '') + '」无回应：' + why);
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

export function createMatch(seats) {
  const id = 'm' + crypto.randomBytes(5).toString('hex');
  const m = new Match(id);
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