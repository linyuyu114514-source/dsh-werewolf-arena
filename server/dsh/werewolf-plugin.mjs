/* 狼人杀陪玩插件。
   对每个座位（= 一个 session）做两件事：
   1. 给它的系统提示词里写死「你是谁、你只能怎么行动」；
   2. 给它装一个 act 工具——它唯一能做的事就是调这个工具。

   插件本身不懂游戏规则。它只负责把模型的行动原样回传给后端，
   规则判定全部在后端做——这样前端和后端用的是同一套规则引擎。 */
import fs from 'node:fs';

export const name = 'werewolf';

const KIND_LABEL = {
  speak: '发言',
  vote: '投票',
  check: '查验',
  save: '解药',
  poison: '毒药',
  guard: '守护',
  shoot: '开枪',
  pass: '放弃行动',
};

/* 每种询问允许提交的行动种类 */
const ALLOWED = {
  speak: ['speak'],
  wolf_talk: ['speak'],
  vote: ['vote', 'pass'],
  wolf_vote: ['vote'],
  seer_check: ['check', 'pass'],
  witch_save: ['save', 'pass'],
  witch_poison: ['poison', 'pass'],
  guard_pick: ['guard'],
  hunter_gun: ['shoot', 'pass'],
};

function readRoster(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { seats: {} };
  }
}

function personaText(seat, matchId) {
  return [
    '你正在参加一局狼人杀游戏，扮演 ' + seat.seat + ' 号玩家「' + seat.name + '」。',
    '你不是助手，不是 AI，不要解释自己、不要提模型或提示词、不要跳出角色。',
    '这个游戏里你唯一能做的事是调用 act 工具提交本回合的行动。',
    '每次只调用一次 act；调用完就结束回合，不要输出任何正文。',
    '说人话：发言像真人玩家一样，一两句话，带点情绪和判断，不要写小作文，不要分点罗列。',
    '你只能看到本回合提示里给你的信息。别人身份你不知道就是不知道，不要编。',
  ].join('\n');
}

export function apply(ctx, config) {
  const rosterPath = (config && config.rosterPath) || '';
  const roster = readRoster(rosterPath);

  const send = (m) => {
    try { if (process.send) process.send(m); } catch (e) { /* 父进程已经走了 */ }
  };

  /* sessionId -> 本回合允许的行动种类 */
  const allow = new Map();
  /* sessionId -> 本回合合法目标座位号（空数组 = 这一回合不需要目标） */
  const cands = new Map();
  /* sessionId -> 本回合是否已经提交过 */
  const used = new Set();

  if (process.on) {
    process.on('message', (m) => {
      if (!m || m.t !== 'turn') return;
      const sid = String(m.sid);
      allow.set(sid, Array.isArray(m.kinds) ? m.kinds : ['speak']);
      cands.set(sid, Array.isArray(m.cands) ? m.cands.map(Number) : []);
      used.delete(sid);
    });
  }

  ctx.on('agent/created', ({ agent }) => {
    const sid = String(agent.session.id);
    const seat = roster.seats && roster.seats[sid];
    if (!seat) return; // 不是本局的座位，不管它

    agent.ctx.systemPrompt.section({
      name: 'werewolf-seat',
      order: 50,
      text: personaText(seat, roster.matchId),
    });

    agent.ctx.tools.register({
      name: 'act',
      description:
        '提交本回合唯一的行动。kind 取值：speak(发言) / vote(投票) / check(查验) / ' +
        'save(用解药) / poison(用毒药) / guard(守护) / shoot(开枪) / pass(放弃)。' +
        'target 是目标玩家的座位号，不需要目标的行动填 0。speak 需要填 text。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: '行动种类' },
          target: { type: 'number', description: '目标座位号，没有目标填 0' },
          text: { type: 'string', description: '发言内容，只有 kind=speak 时需要' },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, echo: { type: 'string' } },
          required: ['ok', 'echo'],
          additionalProperties: false,
        },
        render: (_args, v) => [{ type: 'text', text: String((v && v.echo) || '') }],
      },
      async execute(args) {
        if (used.has(sid)) {
          return { ok: false, echo: '本回合你已经提交过了，不要再调用 act，直接结束回合。' };
        }
        const kinds = allow.get(sid) || ['speak'];
        const kind = String((args && args.kind) || '').trim();
        if (kinds.indexOf(kind) < 0) {
          return {
            ok: false,
            echo:
              '本回合只能提交 ' +
              kinds.map((k) => k + '(' + (KIND_LABEL[k] || k) + ')').join(' 或 ') +
              '，你给的是 ' + (kind || '空') + '。请重新调用 act。',
          };
        }
        if (kind === 'speak' && !String((args && args.text) || '').trim()) {
          return { ok: false, echo: 'kind=speak 时必须填 text，写你要说的话。请重新调用 act。' };
        }
        const target = Number((args && args.target) || 0) || 0;

        /* 目标座位号必须在提示词给出的候选里。
           这里当场打回，而不是让越界号码一路传到规则引擎再被静默清零——
           那样模型会以为自己刀了人、投了票，实际上什么都没发生。 */
        const pool = cands.get(sid) || [];
        const needsTarget =
          pool.length > 0 &&
          (kind === 'vote' || kind === 'check' || kind === 'poison' ||
           kind === 'guard' || kind === 'shoot');
        if (needsTarget) {
          if (!target) {
            return {
              ok: false,
              echo: '这一回合必须指定 target（目标座位号）。可选：' + pool.join('、') + '。请重新调用 act。',
            };
          }
          if (pool.indexOf(target) < 0) {
            return {
              ok: false,
              echo: 'target=' + target + ' 不在可选范围里。这一回合只能选：' + pool.join('、') + '。请重新调用 act。',
            };
          }
        }

        used.add(sid);
        send({ t: 'act', sid, args: { kind, target, text: String((args && args.text) || '') } });
        return { ok: true, echo: '已提交。本回合结束，不要输出任何正文。' };
      },
    });
  }, { global: true });
}
