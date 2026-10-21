/* 把 rules.js 的 req 投影成一段给模型看的文字。
   这是「子代理应该看到什么信息」的唯一出口：
   req 本身已经由 buildReq() 按 visibleTo 过滤过，这里只负责排版，
   绝不额外补任何 req 里没有的东西——多补一个字就是泄密。 */

const ROLE_NAME = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
};

const CAMP_NAME = { wolf: '狼人阵营', good: '好人阵营' };

const KIND_TAG = {
  wolf: '【狼队】',
  witch: '【女巫】',
  seer: '【预言】',
  guard: '【守卫】',
  death: '【出局】',
};

function roleName(id) {
  return ROLE_NAME[id] || '村民';
}

function seatList(seats, names) {
  if (!seats || !seats.length) return '（无）';
  return seats.map((s) => s + '号' + (names && names[s] ? '「' + names[s] + '」' : '')).join('、');
}

/* 座位号 -> 名字。req.names 是规则引擎给的公开名册（名字本来就人人可见）。 */
function nameMap(req) {
  const m = Object.assign({}, req.names || {});
  m[req.seat] = req.name;
  return m;
}

function renderLog(log, limit) {
  const arr = (log || []).slice(-limit);
  if (!arr.length) return '（暂无记录）';
  return arr
    .map((e) => {
      const tag = KIND_TAG[e.kind] || '';
      const who = e.seat ? e.seat + '号「' + (e.name || '') + '」：' : '';
      return tag + who + String(e.text || '').trim();
    })
    .join('\n');
}

function privateLines(req) {
  const out = [];
  if (req.role === 'werewolf') {
    const allies = (req.allies || []).filter((s) => s !== req.seat);
    out.push(
      allies.length
        ? '你的狼同伴：' + allies.map((s) => s + '号').join('、')
        : '你是最后一头狼，今晚只能自己决定刀谁。'
    );
    if (req.wolfTarget) out.push('狼队已经定下的刀口：' + req.wolfTarget + '号。');
  }
  if (req.role === 'witch' && req.potions) {
    out.push('解药剩 ' + req.potions.save + ' 瓶，毒药剩 ' + req.potions.poison + ' 瓶。');
    if (req.wolfTarget) out.push('今晚被狼刀的是 ' + req.wolfTarget + '号。');
  }
  if (req.role === 'seer') {
    const ck = req.checks || [];
    if (ck.length) {
      out.push(
        '你验过的人：' +
          ck.map((c) => c.seat + '号是' + (c.result === 'werewolf' ? '狼人' : '好人')).join('；')
      );
    } else {
      out.push('你还没有验过人。');
    }
  }
  if (req.role === 'guard' && req.guardLast) {
    out.push('上一夜你守的是 ' + req.guardLast + '号，今晚不能重复守同一个人。');
  }
  return out;
}

/* 每种询问的「现在轮到你做什么」，以及这一回合合法的目标座位号。

   cands 会跟提示词一起下发到插件：模型给出不在 cands 里的座位号时，
   工具会直接把这次调用打回去让它重填，而不是一路传到规则引擎再被静默清零。
   静默清零最坑——模型永远不知道自己错了，还以为自己真刀了人。 */
function taskBlock(req, names) {
  const alive = req.aliveSeats || [];
  const others = alive.filter((s) => s !== req.seat);
  const picks = seatList(others, names);

  switch (req.type) {
    case 'speak':
      return {
        text:
          '轮到你发言。像真人玩家一样说 1 到 2 句话：说说你现在怀疑谁、为什么，或者替自己辩解。' +
          '不要复述规则，不要分点罗列，不要说「根据我的分析」这种套话。',
        kinds: ['speak'], cands: [], needTarget: false,
      };
    case 'wolf_talk':
      return {
        text:
          '现在只有狼人睁着眼，你们在队内商量今晚刀谁（外面的人听不到）。' +
          '说 1 到 2 句，给个明确建议。',
        kinds: ['speak'], cands: [], needTarget: false,
      };
    case 'wolf_vote': {
      const wolves = [req.seat].concat(req.allies || []);
      const cands = alive.filter((s) => wolves.indexOf(s) < 0);
      return {
        text: '狼队投票决定今晚刀谁。可刀的目标：' + seatList(cands, names) + '。提交 kind=vote，target 填座位号。',
        kinds: ['vote'], cands, needTarget: true,
      };
    }
    case 'vote':
      return {
        text:
          '投票放逐一个人。可投的目标：' + picks + '。提交 kind=vote，target 填座位号；' +
          '如果你想弃票（不投任何人），提交 kind=pass，不用填 target。',
        kinds: ['vote', 'pass'], cands: others, needTarget: true,
      };
    case 'seer_check': {
      const checked = (req.checks || []).map((c) => c.seat);
      const cands = others.filter((s) => checked.indexOf(s) < 0);
      return {
        text:
          '今晚你可以查验一个人。可查的目标：' + seatList(cands, names) + '。' +
          '提交 kind=check，target 填座位号；不想查就 kind=pass。',
        kinds: ['check', 'pass'], cands, needTarget: true,
      };
    }
    case 'witch_save': {
      const t = req.wolfTarget;
      return {
        text:
          (t ? '今晚 ' + t + '号「' + (names[t] || '') + '」被狼刀了。' : '今晚没有人被刀。') +
          '你有解药。要用就 kind=save（不用填 target）；不用就 kind=pass。',
        kinds: ['save', 'pass'], cands: [], needTarget: false,
      };
    }
    case 'witch_poison':
      return {
        text:
          '你还有毒药。要毒谁就 kind=poison，target 填座位号；不用就 kind=pass。' +
          '可毒的目标：' + picks + '。',
        kinds: ['poison', 'pass'], cands: others, needTarget: true,
      };
    case 'guard_pick': {
      const cands = alive.filter((s) => s !== req.guardLast);
      return {
        text:
          '今晚你要守护一个人，可以守自己。可守的目标：' + seatList(cands, names) + '。' +
          '提交 kind=guard，target 填座位号。',
        kinds: ['guard'], cands, needTarget: true,
      };
    }
    case 'hunter_gun':
      return {
        text:
          '你倒下了，你是猎人，可以开枪带走一个人。可打的目标：' + picks + '。' +
          '要开枪就 kind=shoot，target 填座位号；不开枪就 kind=pass。',
        kinds: ['shoot', 'pass'], cands: others, needTarget: true,
      };
    default:
      return { text: '提交本回合的行动。', kinds: ['pass'], cands: [], needTarget: false };
  }
}

/**
 * 生成一个座位本回合的完整提示词。
 * @param {object} req  rules.js buildReq() 的产物
 * @returns {{text:string, kinds:string[]}}
 */
export function buildPrompt(req) {
  const names = nameMap(req);
  const task = taskBlock(req, names);
  const priv = privateLines(req);

  const lines = [];
  lines.push('你是 ' + req.seat + '号玩家「' + req.name + '」，身份【' + roleName(req.role) + '】，' + (CAMP_NAME[req.camp] || '') + '。');
  lines.push('');
  lines.push('现在：第 ' + req.day + ' 天 · ' + (req.phase === 'night' ? '夜晚' : '白天') + '。');
  lines.push('存活：' + seatList(req.aliveSeats, names) + '。');
  if (req.deadSeats && req.deadSeats.length) {
    lines.push('已出局：' + seatList(req.deadSeats, names) + '。');
  }
  if (priv.length) {
    lines.push('');
    lines.push('你掌握的信息：');
    for (const p of priv) lines.push('- ' + p);
  }
  lines.push('');
  lines.push('本局记录（你视角能看到的）：');
  lines.push(renderLog(req.log, 40));
  lines.push('');
  lines.push('现在轮到你：');
  lines.push(task.text);
  lines.push('');
  lines.push('用 act 工具提交，只调用一次。');

  return { text: lines.join('\n'), kinds: task.kinds, cands: task.cands, needTarget: task.needTarget };
}