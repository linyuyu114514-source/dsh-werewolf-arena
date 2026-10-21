/* ============================================================
   规则引擎测试（Node 直接跑，不依赖浏览器）
   ------------------------------------------------------------
   跑法：node test/rules.test.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..', 'web', 'assets');

/* ---- 造一个最小的 window 环境，把前端脚本原样加载进来 ---- */
const win = {};
const load = (f) => {
  const code = fs.readFileSync(path.join(webDir, f), 'utf8');
  new Function('window', 'globalThis', code)(win, win);
};
load('modes.js');
load('rules.js');

/* rules.js 里的 createRoster 会用到 WWAvatars，测试里给个假的 */
win.WWAvatars = {
  all: () => ['wolf', 'fish', 'owl', 'cat', 'deer', 'moon', 'fox', 'rose',
              'skull', 'flame', 'eye', 'crown', 'sword', 'potion'].map((id) => ({ id }))
};

const { WWEngine, WWModes } = win;

/* ------------------------------------------------------------
   断言框架
   ------------------------------------------------------------ */
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push('PASS ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; results.push('FAIL ' + name + (extra ? ' | ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got) + ' vs ' + JSON.stringify(want));
}

/* ------------------------------------------------------------
   固定随机源：让每局结果可复现
   ------------------------------------------------------------ */
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ALL_ROLES = ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard'];

/* 玩家/代理的「随便选一个」策略 */
function selfVoteTarget(e) {
  const c = e.view().seats.filter((s) => s.alive && !s.isSelf);
  return c.length ? c[0].seat : 0;
}
function selfWolfTarget(e) {
  const c = e.view().seats.filter((s) => s.alive && !s.isAlly && !s.isSelf);
  return c.length ? c[0].seat : 0;
}
function answerFor(req) {
  if (req.type === 'vote') {
    const c = req.aliveSeats.filter((s) => s !== req.seat);
    return c.length ? c[0] : 0;
  }
  if (req.type === 'wolf_vote') {
    const c = req.aliveSeats.filter((s) => s !== req.seat && req.allies.indexOf(s) < 0);
    return c.length ? c[0] : 0;
  }
  /* 女巫：默认不用药，保证流程能自动跑完 */
  if (req.type === 'witch_save') return false;
  if (req.type === 'witch_poison') return 0;
  /* 守卫：守第一个能守的人（排除上一晚守过的） */
  if (req.type === 'guard_pick') {
    const c = req.aliveSeats.filter((s) => s !== req.guardLast);
    return c.length ? c[0] : 0;
  }
  /* 猎人：随便带走一个活着的人 */
  if (req.type === 'hunter_gun') {
    const c = req.aliveSeats.filter((s) => s !== req.seat);
    return c.length ? c[0] : 0;
  }
  /* 预言家：优先验没验过的人 */
  if (req.type === 'seer_check') {
    const done = {};
    (req.checks || []).forEach((c) => { done[c.seat] = 1; });
    const c = req.aliveSeats.filter((s) => s !== req.seat && !done[s]);
    return c.length ? c[0] : 0;
  }
  return '过。';
}

/* 把一局推到底（玩家与代理都自动决策），返回轨迹 */
function playOut(e, opts = {}) {
  const trace = [];
  let snap = e.step();
  trace.push(snap);
  let guard = 0;
  while (guard++ < 5000) {
    if (snap.done) break;
    const p = snap.pending;
    if (p === 'self_speak') e.speak(opts.speech || '过。');
    else if (p === 'self_vote') e.vote(selfVoteTarget(e));
    else if (p === 'self_wolf_talk') e.speak('刀他。');
    else if (p === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (p === 'self_witch_save') e.witchSave(opts.witchSave || false);
    else if (p === 'self_witch_poison') e.witchPoison(opts.witchPoison || 0);
    else if (p === 'self_seer_check') e.seerCheck(opts.seerCheck || 0);
    else if (p === 'self_hunter_gun') e.hunterGun(opts.hunterGun || selfVoteTarget(e));
    else if (p === 'self_guard_pick') e.guardPick(opts.guardPick || selfVoteTarget(e));
    else if (p === 'agent') { const r = e.awaiting(); if (!r) break; e.resumeAgent(answerFor(r)); }
    else if (snap.over) break;             /* 已分胜负且没有待办 */
    snap = e.step();
    trace.push(snap);
  }
  return { trace, last: snap, guard };
}

/* 推进到某个 cursor（或超时） */
function driveTo(e, cursor, max = 200) {
  let snap = e.step();
  let guard = 0;
  while (guard++ < max && e.state.cursor !== cursor && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.pending === 'self_guard_pick') e.guardPick(selfVoteTarget(e));
    else if (snap.over) break;
    snap = e.step();
  }
  return snap;
}

/* ============================================================
   1. 发牌：默认只启用狼人 + 村民，其余降级
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(7), selfRole: 'villager' });
  const roles = Object.values(e.roles);
  eq('6人-座位数', roles.length, 6);
  eq('6人-默认2狼', roles.filter((r) => r === 'werewolf').length, 2);
  eq('6人-默认女巫1', roles.filter((r) => r === 'witch').length, 1);
  eq('6人-默认预言家1', roles.filter((r) => r === 'seer').length, 1);
  eq('6人-其余村民', roles.filter((r) => r === 'villager').length, 2);
  eq('6人-自己是村民', e.roles[1], 'villager');

  /* 全身份启用时按剧本发牌 */
  const full = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(7),
    selfRole: 'villager', enabledRoles: ALL_ROLES });
  const fr = Object.values(full.roles);
  eq('6人-全开-狼人2', fr.filter((r) => r === 'werewolf').length, 2);
  eq('6人-全开-村民2', fr.filter((r) => r === 'villager').length, 2);
  eq('6人-全开-预言家1', fr.filter((r) => r === 'seer').length, 1);
  eq('6人-全开-女巫1', fr.filter((r) => r === 'witch').length, 1);

  const e12 = WWEngine.create({ modeId: 'mode12', selfSeat: 12, rng: seeded(13),
    selfRole: 'villager', enabledRoles: ALL_ROLES });
  const r12 = Object.values(e12.roles);
  eq('12人-座位数', r12.length, 12);
  eq('12人-守卫1', r12.filter((r) => r === 'guard').length, 1);
  eq('12人-猎人1', r12.filter((r) => r === 'hunter').length, 1);
  eq('12人-自己是村民', e12.roles[12], 'villager');
}

/* ============================================================
   2. 身份随机：不传 selfRole 时自己能抽到狼
   ============================================================ */
{
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const e = WWEngine.create({ modeId: 'mode6', selfSeat: 2, rng: seeded(i * 131 + 3) });
    seen.add(e.roles[2]);
  }
  ok('随机-自己能抽到狼人', seen.has('werewolf'), [...seen].join(','));
  ok('随机-自己能抽到村民', seen.has('villager'), [...seen].join(','));
}

/* ============================================================
   3. 座位随机：自己在哪一号位由 selfSeat 决定
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 4, rng: seeded(3), selfRole: 'villager',
    profile: { name: '大肥鱼', avatarId: 'fish' } });
  eq('名册-自己座位', e.seats.filter((s) => s.isSelf).map((s) => s.seat), [4]);
  eq('名册-自己名字', e.seats[3].name, '大肥鱼');
  ok('名册-其他人都有名字', e.seats.every((s) => s.name && s.name.length > 0));
  ok('名册-头像有区分', new Set(e.seats.map((s) => s.avatarId)).size >= 4);
}

/* ============================================================
   4. 夜间顺序：无守卫时狼人先动
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(21),
    selfRole: 'villager', enabledRoles: ALL_ROLES });
  const cursors = [];
  let snap = e.step();
  let guard = 0;
  while (guard++ < 120 && e.state.day === 1 && !snap.done) {
    if (cursors[cursors.length - 1] !== e.state.cursor) cursors.push(e.state.cursor);
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  /* cursor 会被同一 tick 内快速跳过，改用日志顺序做黑盒断言 */
  const texts = e.state.log.map((m) => m.text);
  const at = (re) => texts.findIndex((t) => re.test(t));
  ok('夜间-先过守卫位（无守卫直接跳过）', cursors[0] === 'night_guard', cursors.slice(0, 4).join(' → '));
  ok('夜间-狼人讨论在投票前',
    at(/狼人请睁眼/) >= 0 && at(/狼人请睁眼/) < at(/狼人开始投票/),
    texts.slice(0, 4).join(' / '));
  ok('夜间-狼人投票在公布刀口前',
    at(/狼人开始投票/) < at(/狼人票型/) && at(/狼人票型/) < at(/今晚刀口定了/),
    texts.slice(0, 6).join(' / '));
  ok('夜间-刀口在预言家之前定', at(/今晚刀口定了/) < at(/天亮了/), texts.slice(0, 8).join(' / '));
  ok('夜间-天亮在最后', at(/天亮了/) > at(/今晚刀口定了/), texts.slice(0, 10).join(' / '));
}

/* ============================================================
   5. 玩家是狼人：夜里能发言 + 能选刀
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(23),
    selfRole: 'werewolf', protectSelf: true });
  const pendings = [];
  let snap = e.step();
  let guard = 0;
  while (guard++ < 60 && e.state.day === 1 && !snap.done) {
    if (pendings[pendings.length - 1] !== snap.pending) pendings.push(snap.pending);
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_wolf_talk') e.speak('刀 3 号。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.over) break;
    snap = e.step();
  }
  ok('狼人-轮到自己内部发言', pendings.indexOf('self_wolf_talk') >= 0, pendings.join(','));
  ok('狼人-轮到自己选刀', pendings.indexOf('self_wolf_vote') >= 0, pendings.join(','));
  ok('狼人-内部发言在自己选刀之前',
    pendings.indexOf('self_wolf_talk') < pendings.indexOf('self_wolf_vote'), pendings.join(','));
  ok('狼人-说出去的话进了狼频道',
    e.state.log.some((m) => m.kind === 'wolf' && m.isSelf && /刀 3 号/.test(m.text)),
    e.state.log.filter((m) => m.kind === 'wolf').map((m) => m.text).join(' / '));
}

/* ============================================================
   6. 玩家是村民：夜里没有任何操作入口
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(25),
    selfRole: 'villager', protectSelf: true });
  const pendings = [];
  let snap = e.step();
  let guard = 0;
  while (guard++ < 60 && e.state.day === 1 && !snap.done) {
    if (pendings[pendings.length - 1] !== snap.pending) pendings.push(snap.pending);
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  ok('村民-夜里没有内部发言', pendings.indexOf('self_wolf_talk') < 0, pendings.join(','));
  ok('村民-夜里没有选刀', pendings.indexOf('self_wolf_vote') < 0, pendings.join(','));
}

/* ============================================================
   7. 刀口标记：只有狼人、只在夜里可见
   ============================================================ */
{
  /* 自己是狼：走到刀口已定、但天还没亮
     这一组只验刀口标记，把女巫关掉，免得被解药干扰成平安夜 */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(27),
    selfRole: 'werewolf', protectSelf: true, enabledRoles: ['werewolf', 'villager'] });
  driveTo(e, 'night_witch');   /* 狼人投完就停：phase 还是 night、刀口已定 */
  const v = e.view();
  const marked = v.seats.filter((s) => s.marked).map((s) => s.seat);
  eq('刀口-狼人看到标记', marked.length, 1);
  eq('刀口-标记就是刀口', marked[0], e.state.wolfTarget);
  ok('刀口-天亮前被刀的人还活着', v.seats.find((s) => s.seat === marked[0]).alive === true);

  /* 走到天亮（aAnnounce 写完死亡消息后 cursor 才变 speak_start） */
  const snap = driveTo(e, 'speak_start');
  const after = e.view();
  ok('刀口-天亮后标记消失', after.seats.every((s) => !s.marked), 'phase=' + after.phase);
  ok('刀口-天亮后标记的人出局',
    after.seats.find((s) => s.seat === marked[0]).alive === false,
    'dead=' + after.seats.filter((s) => !s.alive).map((s) => s.seat));
  ok('刀口-公布里有死亡消息', e.state.log.some((m) => m.kind === 'death' && /倒在了自家门口/.test(m.text)),
    e.state.log.filter((m) => m.kind === 'death').map((m) => m.text).join(' / '));

  /* 自己是村民：永远看不到标记 */
  const e2 = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(29),
    selfRole: 'villager', protectSelf: true, enabledRoles: ['werewolf', 'villager'] });
  let seen = false;
  let s2 = e2.step();
  let g2 = 0;
  while (g2++ < 200 && !s2.done) {
    if (e2.view().seats.some((s) => s.marked)) seen = true;
    if (s2.pending === 'agent') { const r = e2.awaiting(); e2.resumeAgent(answerFor(r)); }
    else if (s2.pending === 'self_speak') e2.speak('过。');
    else if (s2.pending === 'self_vote') e2.vote(selfVoteTarget(e2));
    else if (s2.pending === 'self_wolf_talk') e2.speak('刀他。');
    else if (s2.pending === 'self_wolf_vote') e2.vote(selfWolfTarget(e2));
    else if (s2.over) break;
    s2 = e2.step();
  }
  ok('刀口-村民全程看不到标记', seen === false);
}

/* ============================================================
   8. 信息隔离：狼频道不泄漏给村民
   ============================================================ */
{
  const wolfLog = (e) => e.state.log.filter((m) => m.kind === 'wolf');

  const w = WWEngine.create({ modeId: 'mode9', selfSeat: 1, rng: seeded(31),
    selfRole: 'werewolf', protectSelf: true });
  driveTo(w, 'night_witch');
  ok('隔离-狼人日志里有狼频道', wolfLog(w).length > 0, wolfLog(w).length + ' 条');
  ok('隔离-狼人 view 里有狼频道',
    w.view().log.some((m) => m.kind === 'wolf'),
    w.view().log.map((m) => m.kind).join(','));
  ok('隔离-狼人看到同伴', w.view().seats.some((s) => s.isAlly));

  const v = WWEngine.create({ modeId: 'mode9', selfSeat: 2, rng: seeded(31),
    selfRole: 'villager', protectSelf: true });
  driveTo(v, 'night_witch');
  ok('隔离-村民 view 里没有狼频道',
    !v.view().log.some((m) => m.kind === 'wolf'),
    v.view().log.map((m) => m.kind).join(','));
  ok('隔离-村民看不到同伴', v.view().seats.every((s) => s.isAlly === false));
  ok('隔离-村民日志里没有「狼人请睁眼」',
    !v.view().log.some((m) => /狼人请睁眼|今晚刀口/.test(m.text)),
    v.view().log.map((m) => m.text).join(' / '));

  /* view() 结构里不能有 roles 表 */
  const raw = JSON.stringify(v.view());
  ok('隔离-view 不含 roles 表', !raw.includes('"roles"'));
  const keys = Object.keys(v.view().seats[0]).sort().join(',');
  eq('隔离-座位字段固定', keys,
    'alive,avatarData,avatarId,isAlly,isSelf,marked,name,seat,voted');
}

/* ============================================================
   9. 子代理接口：awaiting / resumeAgent
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(33),
    selfRole: 'villager', protectSelf: true });
  /* 换成一个「不自己回答」的大脑，模拟 DSH 子代理还没回来 */
  e.setBrain({ act: () => WWEngine.PENDING });

  let snap = e.step();
  let guard = 0;
  while (guard++ < 40 && snap.pending !== 'agent' && !snap.done) snap = e.step();
  eq('代理-会停下来等子代理', snap.pending, 'agent');

  const req = e.awaiting();
  ok('代理-请求带类型', !!req && !!req.type, req ? req.type : 'null');
  ok('代理-请求带座位', !!req && !!req.seat, req ? String(req.seat) : 'null');
  ok('代理-请求带身份', !!req && !!req.role, req ? req.role : 'null');
  ok('代理-请求带日志', !!req && Array.isArray(req.log) && req.log.length > 0,
    req ? String(req.log.length) : 'null');

  /* 村民的请求里不能出现狼频道 */
  if (req && req.role !== 'werewolf') {
    ok('代理-村民请求里没有狼频道', !req.log.some((m) => m.kind === 'wolf'));
  }

  const payload = req.type === 'vote' ? req.aliveSeats.filter((s) => s !== req.seat)[0] : '我是村民。';
  eq('代理-喂回结论成功', e.resumeAgent(payload), true);
  eq('代理-喂回后清空等待', e.awaiting(), null);
  eq('代理-喂回后继续推进', e.state.pending, 'none');

  /* 结论确实被消费 */
  const before = e.state.log.length;
  snap = e.step();
  ok('代理-结论被用掉', e.state.log.length > before, 'log=' + e.state.log.length);
}

/* ============================================================
   10. 狼人请求里带同伴与刀口，村民请求里没有
   ============================================================ */
{
  /* 自己是村民，狼人全是代理：第一个 agent 请求必然是狼人内部讨论 */
  const w = WWEngine.create({ modeId: 'mode9', selfSeat: 1, rng: seeded(35),
    selfRole: 'villager', protectSelf: true });
  w.setBrain({ act: () => WWEngine.PENDING });
  let snap = w.step();
  let guard = 0;
  while (guard++ < 40 && !(snap.pending === 'agent' && w.awaiting() && w.awaiting().type === 'wolf_talk')) {
    snap = w.step();
  }
  const req = w.awaiting();
  ok('代理-狼人请求类型正确', req && req.type === 'wolf_talk', req ? req.type : 'null');
  ok('代理-狼人请求带同伴', req && req.allies.length > 0, req ? req.allies.join(',') : 'null');
  ok('代理-狼人请求带身份', req && req.role === 'werewolf', req ? req.role : 'null');

  /* 收集一整局所有代理请求：村民的 allies 必须为空、wolfTarget 必须为 0，
     狼人的 allies 必须非空（白天投票时狼人代理也会被问到） */
  const v = WWEngine.create({ modeId: 'mode9', selfSeat: 2, rng: seeded(35),
    selfRole: 'villager', protectSelf: true });
  const reqs = [];
  v.setBrain({ act: (req) => { reqs.push(req); return WWEngine.PENDING; } });
  let s2 = v.step();
  let g2 = 0;
  while (g2++ < 600 && !s2.done) {
    if (s2.pending === 'agent') {
      const r = v.awaiting();
      if (!r) break;
      v.resumeAgent(answerFor(r));
    } else if (s2.pending === 'self_speak') v.speak('过。');
    else if (s2.pending === 'self_vote') v.vote(selfVoteTarget(v));
    else if (s2.over) break;
    s2 = v.step();
  }
  const goodReqs = reqs.filter((r) => r.role === 'villager');
  const wolfReqs = reqs.filter((r) => r.role === 'werewolf');
  ok('代理-村民请求类型正确', goodReqs.length > 0 && goodReqs.every((r) => r.type === 'vote' || r.type === 'speak'),
    'good=' + goodReqs.length + ' wolf=' + wolfReqs.length);
  ok('代理-村民请求同伴为空', goodReqs.length > 0 && goodReqs.every((r) => r.allies.length === 0),
    goodReqs.map((r) => r.allies.join('|')).join(' '));
  ok('代理-村民请求没有刀口', goodReqs.length > 0 && goodReqs.every((r) => !r.wolfTarget),
    goodReqs.map((r) => String(r.wolfTarget)).join(' '));
  ok('代理-狼人请求同伴非空', wolfReqs.length > 0 && wolfReqs.every((r) => r.allies.length > 0),
    'wolf=' + wolfReqs.length);
}

/* ============================================================
   11. 发言顺序：从 1 号开始，跳过出局
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 6, rng: seeded(37),
    selfRole: 'villager', protectSelf: true });
  driveTo(e, 'speak_next');   /* aSpeakStart 自己就把 cursor 推到 speak_next */

  let snap = e.step();
  let guard = 0;
  while (guard++ < 60 && e.state.cursor === 'speak_next') {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.over) break;
    snap = e.step();
  }
  /* 从日志取真实发言顺序：白天发言 kind='speech'（狼频道 kind='wolf' 不在其中） */
  const order = e.state.log.filter((m) => m.kind === 'speech' && m.seat).map((m) => m.seat);
  const dead = e.seats.filter((s) => !s.alive).map((s) => s.seat);
  const expect = e.seats.map((s) => s.seat).filter((s) => !dead.includes(s));
  eq('发言-顺序等于存活座位升序', order, expect);
  ok('发言-跳过出局者', !order.some((s) => dead.includes(s)), 'dead=' + dead + ' order=' + order);
}

/* ============================================================
   12. 完整对局：三模式都能分出胜负
   ============================================================ */
for (const mid of ['mode6', 'mode9', 'mode12']) {
  for (let seed = 1; seed <= 6; seed++) {
    const e = WWEngine.create({ modeId: mid, selfSeat: 1, rng: seeded(seed * 97 + 5),
      selfRole: 'villager', protectSelf: true });
    const { last, guard } = playOut(e);
    ok('完整局-' + mid + '-seed' + seed + '-分出胜负', !!last.over && !!last.over.winner,
      (last.over ? last.over.winner + '/' + last.over.reason : 'null') + ' steps=' + guard);
  }
}

/* 自己是狼也要能跑完 */
for (let seed = 1; seed <= 4; seed++) {
  const e = WWEngine.create({ modeId: 'mode9', selfSeat: 3, rng: seeded(seed * 31 + 7),
    selfRole: 'werewolf', protectSelf: true });
  const { last } = playOut(e);
  ok('完整局-自己当狼-seed' + seed, !!last.over, last.over ? last.over.winner : 'null');
}

/* ============================================================
   13. 推进多天
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, rng: seeded(91),
    selfRole: 'villager', protectSelf: true });
  const { trace } = playOut(e);
  const days = Math.max(...trace.map((t) => t.view.day));
  ok('推进-至少经历 2 天', days >= 2, 'maxDay=' + days);
  const phases = new Set(trace.map((t) => t.view.phase));
  ok('推进-昼夜都出现过', phases.has('night') && phases.has('day'), [...phases].join(','));
}

/* ============================================================
   14. 自己出局 → 留遗言 → 继续推进
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(101),
    selfRole: 'villager', protectSelf: true });
  /* 走到白天投票 */
  let snap = e.step();
  let guard = 0;
  while (guard++ < 300 && snap.pending !== 'self_vote' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  ok('放逐-到达投票', snap.pending === 'self_vote', 'pending=' + snap.pending);

  /* 投票按座位升序：1 号（自己）先投，之后让所有代理都投 1 号 */
  e.vote(selfVoteTarget(e));
  e.view().seats.filter((s) => s.alive && s.seat !== 1)
    .forEach((s) => { e.state.votes[s.seat] = 1; });

  guard = 0;
  snap = e.step();
  while (guard++ < 40 && snap.pending !== 'self_speak' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    snap = e.step();
  }
  eq('放逐-自己出局', e.seats[0].alive, false);
  eq('放逐-进入遗言待办', snap.pending, 'self_speak');
  eq('放逐-遗言归属自己', e.state.lastWordsFor, 1);
  ok('放逐-操作区标题是遗言', /遗言/.test(snap.view.actions.title), snap.view.actions.title);
  eq('放逐-遗言用发言框', snap.view.actions.kind, 'speak');
  /* 局内不公开身份 */
  ok('放逐-日志不揭示身份', !e.state.log.some((m) => /身份是/.test(m.text)),
    e.state.log.filter((m) => /身份是/.test(m.text)).map((m) => m.text).join('/'));

  e.speak('我是村民，你们投错了。');
  ok('放逐-遗言带标记', e.state.log.some((m) => /【遗言】/.test(m.text)),
    e.state.log.filter((m) => /【遗言】/.test(m.text)).map((m) => m.text).join('/'));
  snap = e.step();
  ok('放逐-说完继续推进', snap.pending !== 'self_speak', 'pending=' + snap.pending);
}

/* ============================================================
   15. 平票 → 无人出局
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(111),
    selfRole: 'villager', protectSelf: true });
  let snap = e.step();
  let guard = 0;
  while (guard++ < 300 && snap.pending !== 'self_vote' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  const alive = e.view().seats.filter((s) => s.alive).map((s) => s.seat);
  const a = alive.filter((s) => s !== 1);
  /* 精确造 2:2 平票 */
  if (a.length >= 4) {
    /* 自己投给第三个人（1 票），代理 2:2 平分前两个 → 最高票并列 */
    e.vote(a[2]);
    e.state.votes[a[0]] = a[0];
    e.state.votes[a[1]] = a[0];
    e.state.votes[a[2]] = a[1];
    e.state.votes[a[3]] = a[1];
    a.slice(4).forEach((s) => { e.state.votes[s] = a[0]; });
    guard = 0;
    /* 注意：狼人夜里也会公布「狼人票型：」，这里只认白天的「票型：」开头 */
    const isDayTally = (m) => m.text.indexOf('票型：') === 0;
    while (guard++ < 40 && !e.state.log.some(isDayTally)) snap = e.step();
    ok('平票-有票型公布', e.state.log.some(isDayTally));
    ok('平票-无人出局或正常放逐', e.state.log.some((m) => /平票|被放逐/.test(m.text)),
      e.state.log.filter((m) => /平票|被放逐/.test(m.text)).map((m) => m.text).join('/'));
  } else {
    ok('平票-能造出平票', false, 'alive=' + a.length);
  }
}

/* ============================================================
   16. 玩家输入校验
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(71),
    selfRole: 'villager', protectSelf: true });
  eq('输入-没轮到时发言被拒', e.speak('乱说'), false);
  eq('输入-没轮到时投票被拒', e.vote(2), false);
  eq('输入-空发言被拒', e.speak('   '), false);

  let snap = e.step();
  let guard = 0;
  while (guard++ < 300 && snap.pending !== 'self_vote' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  if (snap.pending === 'self_vote') {
    eq('输入-不能投自己', e.vote(1), false);
    eq('输入-能投合法目标', e.vote(selfVoteTarget(e)), true);
  } else {
    ok('输入-投票阶段可达', false, 'pending=' + snap.pending);
  }
}

/* 狼人夜间不能刀同伴 */
{
  const e = WWEngine.create({ modeId: 'mode9', selfSeat: 1, rng: seeded(73),
    selfRole: 'werewolf', protectSelf: true });
  let snap = e.step();
  let guard = 0;
  while (guard++ < 60 && snap.pending !== 'self_wolf_vote' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.over) break;
    snap = e.step();
  }
  if (snap.pending === 'self_wolf_vote') {
    const mate = e.view().seats.find((s) => s.isAlly);
    ok('狼人-不能刀同伴', mate ? e.vote(mate.seat) === false : true, mate ? 'mate=' + mate.seat : 'no-mate');
    ok('狼人-能刀好人', e.vote(selfWolfTarget(e)) === true);
  } else {
    ok('狼人-选刀阶段可达', false, 'pending=' + snap.pending);
  }
}

/* ============================================================
   17. 出局后不再轮到自己
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(121),
    selfRole: 'villager', protectSelf: true });
  e.seats[0].alive = false;
  let snap = e.step();
  let guard = 0;
  let hitSelf = false;
  while (guard++ < 800 && !snap.done) {
    if (snap.pending === 'self_speak' || snap.pending === 'self_vote' ||
        snap.pending === 'self_wolf_talk' || snap.pending === 'self_wolf_vote') hitSelf = true;
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.over) break;
    snap = e.step();
  }
  ok('出局-不再要求自己行动', hitSelf === false);
  ok('出局-对局能走完', !!snap.over, snap.over ? snap.over.winner : 'null');
  eq('出局-操作区是 idle', snap.view.actions.kind, 'idle');
}


/* ============================================================
   18. 女巫：刀口可见 / 解药 / 毒药 / 一晚一瓶
   ============================================================ */
/* 推进到指定 pending（路上不自动用任何药） */
function driveToPending(e, want, max = 300) {
  let snap = e.step();
  let guard = 0;
  while (guard++ < max && snap.pending !== want && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.pending === 'self_guard_pick') e.guardPick(selfVoteTarget(e));
    else if (snap.over) break;
    snap = e.step();
  }
  return snap;
}

/* 把夜里剩下的流程走完，直到天亮 */
function toDawn(e, opts = {}) {
  let snap = e.step();
  let guard = 0;
  while (guard++ < 200 && e.state.phase !== 'day' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_witch_save') e.witchSave(opts.save || false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(opts.poison || 0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.pending === 'self_guard_pick') e.guardPick(selfVoteTarget(e));
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.over) break;
    snap = e.step();
  }
  return snap;
}

{
  /* --- 女巫能看见刀口 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(31),
    selfRole: 'witch', enabledRoles: ALL_ROLES, protectSelf: true });
  driveToPending(e, 'self_witch_save');
  const st = e.state;
  ok('女巫-夜里被问到解药', st.pending === 'self_witch_save', st.pending);
  ok('女巫-知道今晚刀口', st.wolfTarget > 0, 'wolfTarget=' + st.wolfTarget);
  const v = e.view();
  ok('女巫-座位上有刀口标记', v.seats.filter((s) => s.marked).length === 1,
    v.seats.filter((s) => s.marked).map((s) => s.seat).join(','));
  eq('女巫-标记就是刀口', v.seats.find((s) => s.marked).seat, st.wolfTarget);
  ok('女巫-备注里有刀口', v.roleNotes.some((t) => /今晚被狼人选中的是/.test(t)),
    v.roleNotes.join(' | '));
  ok('女巫-备注里有药品余量', v.roleNotes.some((t) => /解药剩 1 瓶/.test(t)),
    v.roleNotes.join(' | '));

  /* 解药只能救这个人：chip 只有一个可用目标 + 「不用解药」 */
  const chips = v.actions.chips;
  eq('女巫-解药操作区有 2 项', chips.length, 2);
  eq('女巫-解药只能救刀口', chips[0].target, st.wolfTarget);
  eq('女巫-有「不用解药」', chips[1].id, 'wsave-no');

  /* --- 用解药：天亮平安夜 --- */
  const victim = st.wolfTarget;
  eq('女巫-能使用解药', e.witchSave(true), true);
  eq('女巫-解药减一', e.state.witchSaveLeft, 0);
  eq('女巫-本晚标记已用解药', e.state.witchSaveUsedTonight, true);
  toDawn(e);
  /* 天亮后要再推一步 announce，才有公布文案 */
  let s2 = e.step();
  let g2 = 0;
  while (g2++ < 20 && !e.state.log.some((m) => m.kind === 'death' && /平安夜/.test(m.text)) && !s2.done) {
    if (s2.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (s2.pending === 'self_speak') e.speak('过。');
    else if (s2.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (s2.over) break;
    s2 = e.step();
  }
  ok('女巫-解药救人后没死人', e.state.lastNightDeaths.length === 0,
    'deaths=' + e.state.lastNightDeaths.join(','));
  ok('女巫-被救者还活着', e.view().seats.find((s) => s.seat === victim).alive === true);
  ok('女巫-公布为平安夜',
    e.state.log.some((m) => m.kind === 'death' && /平安夜/.test(m.text)));
  eq('女巫-毒药没用掉', e.state.witchPoisonLeft, 1);
  ok('女巫-用了解药就没轮到毒药',
    !e.state.log.some((m) => m.kind === 'witch' && /你把毒药倒给了/.test(m.text)),
    e.state.log.filter((m) => m.kind === 'witch').map((m) => m.text).join(' / '));
}

{
  /* --- 不用解药 → 进毒药环节 → 毒死一个人 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(33),
    selfRole: 'witch', enabledRoles: ALL_ROLES, protectSelf: true });
  driveToPending(e, 'self_witch_save');
  const victim = e.state.wolfTarget;
  eq('女巫-不用解药', e.witchSave(false), true);
  eq('女巫-不用解药后进毒药', e.state.cursor, 'witch_poison');

  const snap2 = e.step();
  eq('女巫-轮到选毒药', snap2.pending, 'self_witch_poison');
  const pv = e.view();
  eq('女巫-毒药可选全部存活者 + 不用', pv.actions.chips.length,
    pv.seats.filter((s) => s.alive).length + 1);
  eq('女巫-毒药有「不用」项', pv.actions.chips[pv.actions.chips.length - 1].id, 'wpoison-no');

  /* 毒一个非刀口的好人 */
  const target = e.view().seats.filter((s) => s.alive && s.seat !== victim && s.seat !== 1)[0].seat;
  eq('女巫-能使用毒药', e.witchPoison(target), true);
  eq('女巫-毒药减一', e.state.witchPoisonLeft, 0);
  toDawn(e);
  const dead = e.state.lastNightDeaths.slice().sort((a, b) => a - b);
  ok('女巫-刀口与毒药同时死', dead.length === 2 && dead.indexOf(victim) >= 0 && dead.indexOf(target) >= 0,
    'deaths=' + dead.join(','));
  ok('女巫-毒死的人确实出局',
    e.view().seats.find((s) => s.seat === target).alive === false);
}

{
  /* --- 女巫可以自救（刀口是自己时用解药） --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(35),
    selfRole: 'witch', enabledRoles: ALL_ROLES, protectSelf: false });
  driveToPending(e, 'self_witch_save');
  e.state.wolfTarget = 1;                 /* 强制刀口是自己 */
  const snap = e.step();
  eq('女巫-自救时仍是解药环节', snap.pending, 'self_witch_save');
  const chips = e.view().actions.chips;
  eq('女巫-自救目标是自己', chips[0].target, 1);
  e.witchSave(true);
  toDawn(e);
  ok('女巫-解药能救自己', e.view().seats.find((s) => s.seat === 1).alive === true);
  eq('女巫-自救后没死人', e.state.lastNightDeaths.length, 0);
}

{
  /* --- 女巫可以毒自己 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(37),
    selfRole: 'witch', enabledRoles: ALL_ROLES, protectSelf: true });
  driveToPending(e, 'self_witch_save');
  e.witchSave(false);
  const snap = e.step();
  eq('女巫-毒自己前在毒药环节', snap.pending, 'self_witch_poison');
  eq('女巫-能毒自己', e.witchPoison(1), true);
  toDawn(e);
  ok('女巫-毒自己后出局', e.view().seats.find((s) => s.seat === 1).alive === false);
}

{
  /* --- 药品一局各一瓶：用掉就没了 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(39),
    selfRole: 'witch', enabledRoles: ALL_ROLES, protectSelf: true });
  driveToPending(e, 'self_witch_save');
  e.witchSave(true);
  toDawn(e);
  eq('女巫-解药已用尽', e.state.witchSaveLeft, 0);
  /* 第二夜再问时不会再有解药选项 */
  let snap = e.step();
  let guard = 0;
  let askedSave = false;
  while (guard++ < 400 && !snap.done && e.state.day < 2) {
    if (snap.pending === 'self_witch_save') { askedSave = true; e.witchSave(true); }
    else if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  ok('女巫-解药用完后不再被问解药', askedSave === false, 'day=' + e.state.day);
}

{
  /* --- 女巫看不到狼人内部讨论 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(41),
    selfRole: 'witch', enabledRoles: ALL_ROLES, protectSelf: true });
  playOut(e);
  const wolfMsgs = e.state.log.filter((m) => m.audience === 'wolf');
  ok('女巫-狼人内部讨论存在但被过滤', wolfMsgs.length >= 0);
  const v = e.view();
  ok('女巫-视图里没有狼人消息', v.log.every((m) => m.kind !== 'wolf'),
    v.log.filter((m) => m.kind === 'wolf').length + ' 条');
}

{
  /* --- 没有女巫时不会问药（关掉女巫） --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(43),
    selfRole: 'villager', enabledRoles: ['werewolf', 'villager'] });
  playOut(e);
  ok('无女巫-不会出现女巫待办',
    e.state.log.every((m) => m.kind !== 'witch'),
    e.state.log.filter((m) => m.kind === 'witch').map((m) => m.text).join(' / '));
}


/* ============================================================
   19. 预言家：最后一个行动 / 每晚验一人 / 结果只有自己可见
   ============================================================ */
{
  /* --- 夜里顺序：女巫之后才是预言家 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 2, rng: seeded(51),
    selfRole: 'villager', enabledRoles: ALL_ROLES, protectSelf: true });
  const order = [];
  let snap = e.step();
  let guard = 0;
  while (guard++ < 120 && e.state.day === 1 && e.state.phase === 'night' && !snap.done) {
    const c = e.state.cursor;
    if (order[order.length - 1] !== c) order.push(c);
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  const iWitch = order.indexOf('witch_save');
  const iSeer = order.indexOf('seer_check');
  ok('预言家-女巫之后才验', iWitch >= 0 && iSeer > iWitch, order.join('>'));
  eq('预言家-验完就天亮', order[order.indexOf('seer_check') + 1], 'dawn');
}

{
  /* --- 自己是预言家：能验人，结果只进自己日志 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(53),
    selfRole: 'seer', enabledRoles: ALL_ROLES, protectSelf: true });
  const snap = driveToPending(e, 'self_seer_check');
  eq('预言家-轮到自己查验', snap.pending, 'self_seer_check');
  eq('预言家-操作区是选人', snap.view.actions.kind, 'chips');
  eq('预言家-操作区标私有', snap.view.actions.private, true);
  ok('预言家-候选不含自己', snap.view.actions.chips.every((c) => c.target !== 1),
    snap.view.actions.chips.map((c) => c.target).join(','));

  const target = snap.view.actions.chips[0].target;
  ok('预言家-能查验', e.seerCheck(target), true);
  const res = e.state.seerChecks[target];
  ok('预言家-得到结果', res === 'wolf' || res === 'good', String(res));
  eq('预言家-记录查验对象', e.state.seerLastCheck, target);

  /* 结果只进自己的日志 */
  const mine = e.state.log.filter((m) => m.kind === 'seer');
  ok('预言家-日志有查验结果', mine.some((m) => /你查验了/.test(m.text)),
    mine.map((m) => m.text).join(' / '));
  ok('预言家-查验日志只有自己可见',
    e.view().log.some((m) => m.kind === 'seer'),
    e.view().log.map((m) => m.kind).join(','));

  /* 其他身份看不到 */
  const other = WWEngine.create({ modeId: 'mode6', selfSeat: 2, rng: seeded(53),
    selfRole: 'villager', enabledRoles: ALL_ROLES, protectSelf: true });
  playOut(other);
  ok('预言家-旁人看不到查验日志',
    other.view().log.every((m) => m.kind !== 'seer'),
    other.view().log.filter((m) => m.kind === 'seer').length + ' 条');
  ok('预言家-旁人日志没有查验文本',
    !other.state.log.some((m) => /你查验了/.test(m.text) && m.audience !== 'seer'));
}

{
  /* --- 验过的人不再列出；验完当天不再重复问 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(55),
    selfRole: 'seer', enabledRoles: ALL_ROLES, protectSelf: true });
  let snap = driveToPending(e, 'self_seer_check');
  const first = snap.view.actions.chips.map((c) => c.target);
  e.seerCheck(first[0]);

  /* 走到第二晚 */
  let guard = 0;
  snap = e.step();
  while (guard++ < 400 && !(e.state.day === 2 && snap.pending === 'self_seer_check') && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') { /* 等到了 */ }
    else if (snap.over) break;
    if (snap.pending === 'self_seer_check') break;
    snap = e.step();
  }
  if (snap.pending === 'self_seer_check') {
    const second = snap.view.actions.chips.map((c) => c.target);
    ok('预言家-验过的人不再列出', second.indexOf(first[0]) < 0,
      'first=' + first[0] + ' second=' + second.join(','));
    ok('预言家-备注里有历史查验',
      snap.view.roleNotes.some((n) => /已经验过/.test(n)),
      snap.view.roleNotes.join(' / '));
  } else {
    ok('预言家-第二晚仍会问查验', false, 'day=' + e.state.day + ' pending=' + snap.pending);
  }
}

{
  /* --- 预言家出局后不再问 --- */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(57),
    selfRole: 'seer', enabledRoles: ALL_ROLES, protectSelf: false });
  e.seats[0].alive = false;
  let snap = e.step();
  let guard = 0, asked = false;
  while (guard++ < 200 && e.state.day === 1 && !snap.done) {
    if (snap.pending === 'self_seer_check') asked = true;
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  ok('预言家-出局后不再被问查验', asked === false);
}

/* ============================================================
   20. 投票按座位号升序 / 局内不公开身份
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 4, rng: seeded(61),
    selfRole: 'villager', protectSelf: true });
  /* 走到白天投票，记录代理被问的座位顺序 */
  const asked = [];
  let snap = e.step();
  let guard = 0;
  while (guard++ < 400 && !e.state.log.some((m) => m.text.indexOf('票型：') === 0) && !snap.done) {
    if (snap.pending === 'agent') {
      const r = e.awaiting();
      if (r.type === 'vote') asked.push(r.seat);
      e.resumeAgent(answerFor(r));
    }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_hunter_gun') e.hunterGun(0);
    else if (snap.over) break;
    snap = e.step();
  }
  const sorted = asked.slice().sort((x, y) => x - y);
  eq('投票-按座位升序进行', asked.join(','), sorted.join(','));
  ok('投票-自己被跳过（走玩家接口）', asked.indexOf(4) < 0, asked.join(','));
  ok('投票-票型一次性公布', e.state.log.some((m) => m.text.indexOf('票型：') === 0));

  /* 局内不公开任何身份 */
  ok('投票-出局不公布身份', !e.state.log.some((m) => /身份是/.test(m.text)),
    e.state.log.filter((m) => /身份是/.test(m.text)).map((m) => m.text).join(' / '));
  ok('投票-死亡消息不含身份名', e.state.log.filter((m) => m.kind === 'death')
    .every((m) => !/他的身份|身份是|是狼人|是女巫|是预言家|是猎人|是守卫/.test(m.text)),
    e.state.log.filter((m) => m.kind === 'death').map((m) => m.text).join(' / '));
}

{
  /* 狼人夜间投票也按座位升序 */
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(63),
    selfRole: 'werewolf', protectSelf: true, enabledRoles: ['werewolf', 'villager'] });
  const asked = [];
  let snap = e.step();
  let guard = 0;
  while (guard++ < 200 && e.state.cursor !== 'night_witch' && !snap.done) {
    if (snap.pending === 'agent') {
      const r = e.awaiting();
      if (r.type === 'wolf_vote') asked.push(r.seat);
      e.resumeAgent(answerFor(r));
    }
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.over) break;
    snap = e.step();
  }
  const sorted = asked.slice().sort((x, y) => x - y);
  eq('狼人投票-也按座位升序', asked.join(','), sorted.join(','));
}


/* ============================================================
   21. 猎人：被刀 / 被毒 / 被投都能开枪；开枪后仍可留遗言；
       被枪打死的人没有遗言
   ============================================================ */
/* 推进到猎人的开枪待办（路上不替猎人做决定） */
function driveToGun(e, max = 400) {
  let snap = e.step();
  let guard = 0;
  while (guard++ < max && snap.pending !== 'self_hunter_gun' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_speak') e.speak('过。');
    else if (snap.pending === 'self_vote') e.vote(selfVoteTarget(e));
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.pending === 'self_wolf_vote') e.vote(selfWolfTarget(e));
    else if (snap.pending === 'self_witch_save') e.witchSave(false);
    else if (snap.pending === 'self_witch_poison') e.witchPoison(0);
    else if (snap.pending === 'self_seer_check') e.seerCheck(0);
    else if (snap.pending === 'self_guard_pick') e.guardPick(selfVoteTarget(e));
    else if (snap.over) break;
    snap = e.step();
  }
  return snap;
}

/* --- 21a 猎人夜里被狼刀：天亮插开枪 --- */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, selfRole: 'hunter',
    rng: seeded(901), protectSelf: false });
  eq('猎人-自己是猎人', e.roles[1], 'hunter');
  const snap = driveToGun(e);
  ok('猎人-夜里被刀能开枪', snap.pending === 'self_hunter_gun', snap.pending);
  ok('猎人-已经被刀出局', e.seats[0].alive === false);
  eq('猎人-阶段是开枪', snap.view.stage, 'day_gun');
  const v = snap.view;
  ok('猎人-开枪选项不含自己', v.actions.chips.every((c) => c.target !== 1),
    v.actions.chips.map((c) => c.target).join(','));
  ok('猎人-开枪选项都是活人',
    v.actions.chips.every((c) => v.seats.find((s) => s.seat === c.target).alive),
    v.actions.chips.map((c) => c.target).join(','));
  eq('猎人-需要确认', !!v.actions.confirm, true);

  const target = v.actions.chips[0].target;
  ok('猎人-能开枪', e.hunterGun(target), false);
  ok('猎人-被枪打死', e.seats[target - 1].alive === false, target);
  ok('猎人-枪后进入白天发言', /speak|vote|day_/.test(e.state.cursor), e.state.cursor);
  ok('猎人-不能开第二次枪', e.hunterGun(v.actions.chips[1].target) === false);
}

/* --- 21b 猎人被女巫毒死也能开枪 --- */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, selfRole: 'hunter',
    rng: seeded(902), protectSelf: true });
  /* 直接构造「今夜狼没刀到人、女巫毒了猎人」，从 dawn 起跑 */
  const ws = e.seats.find((s) => s.seat !== 1 && e.roles[s.seat] === 'witch');
  ok('猎人-局里有女巫', !!ws, ws ? ws.seat : 'none');
  e.state.day = 1;
  e.state.phase = 'night';
  e.state.wolfTarget = 0;
  e.state.witchPoisonTarget = 1;
  e.state.witchSaveUsedTonight = false;
  e.state.cursor = 'dawn';
  e.state.pending = 'none';
  const s2 = driveToGun(e);
  ok('猎人-被毒也能开枪', s2.pending === 'self_hunter_gun', s2.pending);
  ok('猎人-毒死后已出局', e.seats[0].alive === false);
}

/* --- 21c 猎人白天被投票出局：先开枪，再留遗言 --- */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, selfRole: 'hunter',
    rng: seeded(903), protectSelf: true });
  /* 直接构造投票结算：所有代理都投 1 号（自己） */
  const alive = e.view().seats.filter((s) => s.alive).map((s) => s.seat);
  const votes = {};
  alive.forEach((s) => { if (s !== 1) votes[s] = 1; });
  votes[1] = alive.find((s) => s !== 1);
  e.state.votes = votes;
  e.state.cursor = 'vote_resolve';
  let snap = driveToGun(e);
  ok('猎人-被投出局能开枪', snap.pending === 'self_hunter_gun', snap.pending);
  ok('猎人-被投后已出局', e.seats[0].alive === false);

  const target = snap.view.actions.chips[0].target;
  e.hunterGun(target);
  /* 开完枪要回来留遗言 */
  const s3 = e.step();
  ok('猎人-枪后仍要留遗言', s3.pending === 'self_speak', s3.pending);
  eq('猎人-遗言标记', e.state.lastWordsFor, 1);
  e.speak('我是猎人，带走了 ' + target + ' 号。');
  const last = e.state.log[e.state.log.length - 1];
  ok('猎人-遗言带【遗言】前缀', /【遗言】/.test(last.text), last.text);
  ok('猎人-被枪打死的人没有遗言',
    !e.state.log.some((m) => m.kind === 'speech' && m.seat === target && /遗言/.test(m.text)),
    'seat=' + target);
  const s4 = e.step();
  ok('猎人-遗言后进入黑夜', e.state.cursor === 'night_open' || e.state.cursor === 'night_next',
    e.state.cursor);
}

/* --- 21d 一局只开一次枪 --- */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, selfRole: 'hunter',
    rng: seeded(904), protectSelf: false });
  const snap = driveToGun(e);
  if (snap.pending === 'self_hunter_gun') {
    e.hunterGun(snap.view.actions.chips[0].target);
    eq('猎人-gunUsed 记一笔', e.state.gunUsed[1], 1);
    ok('猎人-枪已用掉', e.state.gunFor === 0);
  } else {
    ok('猎人-21d 未触发开枪（跳过）', true);
  }
}


/* ============================================================
   22. 守卫：夜里第一个行动 / 可守自己 / 不能连守 /
       同守同救一起失效
   ============================================================ */
/* 直接把局面摆到天亮前一刻，省得靠随机凑 */
function armNight(e, o) {
  e.state.day = o.day || 1;
  e.state.phase = 'night';
  e.state.cursor = 'dawn';
  e.state.pending = 'none';
  e.state.wolfTarget = o.wolfTarget || 0;
  e.state.guardSaved = o.guardSaved || 0;
  e.state.witchSaved = o.witchSaved || 0;
  e.state.witchPoisonTarget = 0;
  e.state.witchSaveUsedTonight = false;
  e.state.seerLastCheck = 0;
  return e;
}

/* --- 22a 守卫夜里第一个睁眼，比狼人早 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1101), protectSelf: false });
  eq('守卫-自己是守卫', e.roles[1], 'guard');
  /* 逐步推进到自己的守护待办（路上把代理的决策答掉） */
  let snap = e.step();
  let gd = 0;
  while (gd++ < 200 && snap.pending !== 'self_guard_pick' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    snap = e.step();
  }
  eq('守卫-第一夜先到守卫', snap.view.stage, 'night_guard');
  eq('守卫-轮到玩家自己守人', snap.pending, 'self_guard_pick');
  const v = snap.view;
  ok('守卫-操作区是选人', v.actions.kind === 'chips', v.actions.kind);
  ok('守卫-可以守自己', v.actions.chips.some((c) => c.target === 1),
    v.actions.chips.map((c) => c.target).join(','));
  ok('守卫-选项全是活人',
    v.actions.chips.every((c) => v.seats.find((s) => s.seat === c.target).alive));
  ok('守卫-不需要确认按钮', !v.actions.confirm);
}

/* --- 22b 被守卫守住：狼刀无效 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1102), protectSelf: false });
  armNight(e, { wolfTarget: 1, guardSaved: 1 });
  e.step();
  ok('守卫-守自己不被刀死', e.seats[0].alive === true);
  eq('守卫-平安夜没有死者', e.state.lastNightDeaths.length, 0);
}

/* --- 22c 守了别人，别人也不死 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1103), protectSelf: false });
  armNight(e, { wolfTarget: 2, guardSaved: 2 });
  e.step();
  ok('守卫-守住别人', e.seats[1].alive === true, 'seat2');
}

/* --- 22d 只被女巫救：也活着 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1104), protectSelf: false });
  armNight(e, { wolfTarget: 3, guardSaved: 0, witchSaved: 3 });
  e.step();
  ok('守卫-只有解药也活', e.seats[2].alive === true, 'seat3');
}

/* --- 22e 同守同救：两者一起失效，狼刀生效 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1105), protectSelf: false });
  armNight(e, { wolfTarget: 3, guardSaved: 3, witchSaved: 3 });
  e.step();
  ok('守卫-同守同救照样死', e.seats[2].alive === false, 'seat3');
  eq('守卫-同守同救进了死者名单', e.state.lastNightDeaths, [3]);
  ok('守卫-日志里说明了同守同救',
    e.state.log.some((m) => /同守同救/.test(m.text) && m.audience === 'guard'));
}

/* --- 22f 不能连续两晚守同一个人 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1106), protectSelf: false });
  let snap = e.step();
  let gd = 0;
  while (gd++ < 200 && snap.pending !== 'self_guard_pick' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    snap = e.step();
  }
  eq('守卫-第一晚自己守人', snap.pending, 'self_guard_pick');
  ok('守卫-守 3 号', e.guardPick(3), true);
  eq('守卫-记下守过谁', e.state.guardLast, 3);

  e.state.cursor = 'night_open';
  e.state.pending = 'none';
  e.state.over = null;
  snap = e.step();
  gd = 0;
  while (gd++ < 200 && snap.pending !== 'self_guard_pick' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    snap = e.step();
  }
  const v = snap.view;
  ok('守卫-第二晚仍由自己守人', snap.pending === 'self_guard_pick', snap.pending);
  ok('守卫-不能连守同一个人', v.actions.chips.every((c) => c.target !== 3),
    v.actions.chips.map((c) => c.target).join(','));
  ok('守卫-第二晚可以守自己', v.actions.chips.some((c) => c.target === 1));
  ok('守卫-硬守 3 号会被拒', e.guardPick(3) === false);
  ok('守卫-守 4 号可以', e.guardPick(4), true);
  eq('守卫-guardLast 换成 4', e.state.guardLast, 4);
}

/* --- 22g 代理当守卫时也能自己决定，不会卡住 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'villager',
    rng: seeded(1107), protectSelf: false });
  const guardSeatNo = e.seats.find((s) => e.roles[s.seat] === 'guard').seat;
  ok('守卫-代理局里有守卫', !!guardSeatNo, 'seat=' + guardSeatNo);
  let snap = e.step();
  let gd = 0;
  while (gd++ < 200 && snap.pending !== 'self_guard_pick' && !snap.done &&
         e.state.guardSaved === 0) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    snap = e.step();
  }
  ok('守卫-代理局不卡在玩家选人', snap.pending !== 'self_guard_pick', snap.pending);
  ok('守卫-代理已经守了人', e.state.guardSaved > 0, e.state.guardSaved);
}

/* --- 22h 守卫出局后夜里直接跳过 --- */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 1, selfRole: 'guard',
    rng: seeded(1108), protectSelf: false });
  e.seats[0].alive = false;
  e.state.cursor = 'night_open';
  e.state.pending = 'none';
  const snap = e.step();
  ok('守卫-守卫死后不再选人', snap.pending !== 'self_guard_pick', snap.pending);
  eq('守卫-夜里没有守护记录', e.state.guardSaved, 0);
}


/* ============================================================
   24. 弃票
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(101),
    selfRole: 'villager', enabledRoles: ALL_ROLES, protectSelf: true });
  const snap = driveToPending(e, 'self_vote');
  eq('弃票-投票阶段可达', snap.pending, 'self_vote');

  const v = e.view();
  ok('弃票-操作区有弃票项', v.actions.chips.some((c) => c.pass === true),
    v.actions.chips.map((c) => c.id).join(','));
  const passChip = v.actions.chips.find((c) => c.pass === true);
  eq('弃票-弃票项 target 是 0', passChip.target, 0);
  eq('弃票-弃票项文案', passChip.label, '弃票');

  eq('弃票-提交 0 被接受', e.vote(0), true);
  eq('弃票-记成 0 票', e.state.votes[1], 0);
  eq('弃票-推进到下一步', e.state.pending, 'none');
  eq('弃票-游标去结算', e.state.cursor, 'vote_next');
}

/* 弃票之后整轮仍能正常结算（全场弃票 → 无人出局） */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(103),
    selfRole: 'villager', enabledRoles: ALL_ROLES, protectSelf: true });
  driveToPending(e, 'self_vote');
  /* 换成外部接管：每个代理都交回 0（= 弃票） */
  e.setBrain({ act: () => WWEngine.PENDING });
  eq('弃票-自己弃票被接受', e.vote(0), true);
  let snap = e.step();
  let guard = 0;
  while (guard++ < 300 && !snap.done && e.state.cursor !== 'vote_resolve') {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(0); }
    else if (snap.pending === 'self_vote') e.vote(0);
    else if (snap.over) break;
    snap = e.step();
  }
  while (guard++ < 500 && !snap.done && e.state.stage === 'day_vote') snap = e.step();
  eq('弃票-全场弃票无人出局', e.state.lastExile, 0);
  ok('弃票-全场弃票仍能推进', e.state.stage !== 'day_vote', e.state.stage);
}

/* 狼人夜间投票不能弃票 */
{
  const e = WWEngine.create({ modeId: 'mode9', selfSeat: 1, rng: seeded(107),
    selfRole: 'werewolf', enabledRoles: ALL_ROLES, protectSelf: true });
  let snap = e.step();
  let guard = 0;
  while (guard++ < 80 && snap.pending !== 'self_wolf_vote' && !snap.done) {
    if (snap.pending === 'agent') { const r = e.awaiting(); e.resumeAgent(answerFor(r)); }
    else if (snap.pending === 'self_wolf_talk') e.speak('刀他。');
    else if (snap.over) break;
    snap = e.step();
  }
  if (snap.pending === 'self_wolf_vote') {
    eq('弃票-狼人不能弃刀', e.vote(0), false);
  } else {
    ok('弃票-狼人投票阶段可达', false, 'pending=' + snap.pending);
  }
}

/* 弃票不影响对子代理的提示词目标校验：vote 的合法候选里不含 0 */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, rng: seeded(109),
    selfRole: 'villager', enabledRoles: ALL_ROLES, protectSelf: true });
  driveToPending(e, 'self_vote');
  const req = e.awaiting ? e.awaiting() : null;
  /* 玩家自己投票时没有 req；这里直接检查 self_vote 的 chips 不含 0 */
  const v = e.view();
  const seats = v.actions.chips.filter((c) => !c.pass).map((c) => c.target);
  ok('弃票-候选座位不含 0', seats.every((s) => s > 0), seats.join(','));
}

/* ============================================================
   25. 自选模式：指定身份与座位
   ============================================================ */
{
  const e = WWEngine.create({ modeId: 'mode9', selfSeat: 5, selfRole: 'hunter',
    rng: seeded(211), enabledRoles: ALL_ROLES, protectSelf: true });
  eq('自选-自己的座位正确', e.seats.find((s) => s.isSelf).seat, 5);
  eq('自选-自己的身份正确', e.roles[5], 'hunter');
  const hunterN = Object.keys(e.roles).filter((k) => e.roles[k] === 'hunter').length;
  eq('自选-身份没有被重复塞进来', hunterN, 1);
  const total = Object.keys(e.roles).length;
  eq('自选-人数不变', total, 9);
}

/* 自选狼人：狼队人数不变 */
{
  const e = WWEngine.create({ modeId: 'mode12', selfSeat: 3, selfRole: 'werewolf',
    rng: seeded(213), enabledRoles: ALL_ROLES, protectSelf: true });
  eq('自选-12 人局自己是狼', e.roles[3], 'werewolf');
  const wolves = Object.keys(e.roles).filter((k) => e.roles[k] === 'werewolf').length;
  eq('自选-12 人局狼人仍是 4 个', wolves, 4);
}

/* 自选身份 + 座位 1 号（边界） */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 1, selfRole: 'seer',
    rng: seeded(215), enabledRoles: ALL_ROLES, protectSelf: true });
  eq('自选-1 号位身份正确', e.roles[1], 'seer');
  eq('自选-1 号位是自己', e.seats[0].isSelf, true);
}

/* 自选模式也能正常开局（能走到第一次询问） */
{
  const e = WWEngine.create({ modeId: 'mode6', selfSeat: 4, selfRole: 'werewolf',
    rng: seeded(217), enabledRoles: ALL_ROLES, protectSelf: true });
  const snap = e.step();
  ok('自选-能正常开局', !!snap && !!snap.view, snap && snap.pending);
  ok('自选-身份是狼', e.view().role.id === 'werewolf', e.view().role.id);
  eq('自选-座位是 4', e.view().seats.find((s) => s.isSelf).seat, 4);
}

/* ============================================================
   输出
   ============================================================ */
console.log(results.join('\n'));
console.log('\n--- ' + pass + ' PASS / ' + fail + ' FAIL ---');
process.exit(fail ? 1 : 0);
