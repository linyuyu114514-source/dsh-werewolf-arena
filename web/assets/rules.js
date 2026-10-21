/* ============================================================
   大肥鱼狼人杀 · 规则引擎（纯状态机，不碰 DOM）
   ------------------------------------------------------------
   设计原则：
     1. 零依赖：不碰 DOM、不碰网络、不碰 DSH。可在 Node 里直接跑测试。
     2. 信息隔离：私有信息只存在引擎内部。view() 是唯一出口，只输出
        selfSeat 有权看到的东西；日志按 audience 过滤。
     3. 逐条推进：step() 每次最多产出一条日志就返回，前端据此做节奏。
     4. 代理可插拔：所有子代理的发言与决策都走 brain.act(req)。
        默认 brain 是内置模板（同步返回）；接 DSH 时用 setBrain() 换掉，
        让 act() 返回 WWEngine.PENDING，再用 resumeAgent(payload) 把
        子代理的结论喂回来，其余流程完全不用动。

   ---- 给子代理的上下文（req）----------------------------------
     {
       type: 'wolf_talk' | 'wolf_vote' | 'speak' | 'vote'
             | 'witch_save' | 'witch_poison',
       day, phase, seat, name, role, camp,
       allies: [座位号],        // 只有狼人非空，其余为 []
       aliveSeats: [..], deadSeats: [..],
       wolfTarget: 0,           // 狼人、女巫能看到今晚已定的刀口
       potions: null,           // 女巫：{ save: 0|1, poison: 0|1 }，其余为 null
       log: [{ kind, seat, name, text }]   // 已按该玩家权限过滤
     }
     返回：发言类 → 字符串；投票类 → 座位号；
           女巫解药 → true / false；女巫毒药 → 座位号（0 = 不用）；
           返回 PENDING（或 null / undefined）表示「外部接管」。

   ---- 玩家操作接口 -------------------------------------------
     engine.speak(text)        白天发言 / 遗言 / 狼人内部讨论
     engine.vote(seat)         白天投票 / 狼人夜间投票
     engine.witchSave(use)     女巫是否使用解药（true / false）
     engine.witchPoison(seat)  女巫用毒药毒谁（0 = 不用）
     engine.seerCheck(seat)    预言家查验谁（返回 'wolf' | 'good' | ''）
     engine.act(type, payload) 以上全部的统一入口

   ---- 状态机（cursor）---------------------------------------
     night_open
       → night_guard           （模式含守卫才真正进入，否则跳过）
       → wolf_talk_start → wolf_talk_next(循环)
       → wolf_vote_start → wolf_vote_next(循环) → wolf_vote_resolve
       → night_witch → witch_save → witch_poison
       → night_seer → seer_check
       → dawn → announce
       → speak_start → speak_next(循环) → vote_start → vote_next(循环)
       → vote_resolve → exile → night_next → night_open ...

   夜晚行动顺序：有守卫时守卫第一、狼人第二、女巫第三、预言家最后；
   没有守卫时狼人第一。预言家是夜里最后一个睁眼的。
   被狼人选中的玩家在夜里只是「被刀标记」，到 dawn 才真正出局；
   女巫的解药在 dawn 之前把刀口抵消，毒药在 dawn 时直接致死。

   投票一律按座位号升序逐个进行（狼人夜间投票、白天放逐投票都一样），
   每投一票就停在对应的玩家身上等它决定，这样接子代理时不会乱。
   投票过程不公开谁投了谁，结算时一次性公布票型。

   局内不公开任何人的身份：被放逐、被刀、被毒的人只公布「出局」，
   不公布身份卡。只有预言家自己知道自己验过谁。

   女巫：一局各一瓶解药与毒药，一晚只能用一瓶。
     解药只能救当晚被狼人袭击的人（可以救自己）；
     用了解药这晚就跳过毒药环节；
     毒药可以毒任何人，包括自己。

  预言家：每晚查验一名存活玩家，得知他是「狼人」还是「好人」。
     查验结果只进预言家自己的日志，别人看不到；
     验过的人会记下来，之后不用再验。

   阶段（stage，给前端进度条用）：
     night_start / night_guard / night_wolves / night_seer / night_witch
     day_announce / day_speak / day_vote / day_exile
   ============================================================ */
(function (global) {
  'use strict';

  var WOLF = 'werewolf';
  var VILLAGER = 'villager';
  var WITCH = 'witch';
  var SEER = 'seer';
  var HUNTER = 'hunter';
  var GUARD = 'guard';

  /* 已实现的身份。没实现的身份在发牌时先当村民，等做到再逐个打开。 */
  var DEFAULT_ENABLED = [WOLF, VILLAGER, WITCH, SEER, HUNTER, GUARD];

  /* 代理返回这个值 = 「我不做决定，交给外部（DSH 子代理）」 */
  var PENDING = { pending: true };

  /* ------------------------------------------------------------
     1. 工具
     ------------------------------------------------------------ */
  function shuffle(a, rng) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function num(a, b) { return Number(a) - Number(b); }

  /* ------------------------------------------------------------
     2. 代理发言素材
        模板里的占位符：
          {t}    → 一个随机的其他存活玩家，渲染成「3 号」
          {dead} → 一个已出局的玩家
          {died} → 昨夜倒下的玩家
        d* = 白天公开发言，w* = 狼人内部讨论（只有狼看得见）
     ------------------------------------------------------------ */
  var LINES = {
    d1: [
      '我先过。第一天没信息，谁急着给我扣帽子，我记谁。',
      '我是好人。{t}刚才那个语气我不太舒服，先记一笔。',
      '没有查验信息，只能凭感觉。{t}的发言太满了，满得像背下来的。',
      '别急着投人。第一轮投错，明天我们就少一张票。',
      '我倾向先听{t}怎么说。他要是继续含糊，我这票就给他。',
      '村里人，不太会说话，但我会投票。',
      '{t}你别急着自证，越急越像。',
      '说实话{t}的逻辑是通的，但通得太顺了，顺得不像自己想的。',
      '我没什么可说的，把发言机会留给后面的人。',
      '{t}，你昨晚听到什么动静没有？'
    ],
    d2: [
      '昨天{dead}被投出去，票型我记着。投他的人里，至少有一个是狼。',
      '我是好人。我昨天那票没改，今天还是这个判断。',
      '{t}，昨天你一句话没说，今天开口就是踩人，这不太对。',
      '昨晚刀口落在{died}，说明有人被保了，也说明狼在试探。',
      '我不想再错一次。{t}，你把昨天那一票解释一下。',
      '死的是{died}。他昨天说过的话，你们还记得吗？',
      '我现在最不信{t}。他每一句都对，但没有一句是自己的。',
      '好人的票不够了，今天再投错，明天就结束了。',
      '我盘一下：{t}一直在带节奏，但从来没给过理由。',
      '{t}，你昨天为什么投那一票？说不清我今天就投你。'
    ],
    last: [
      '我是好人。我走了，你们记得看我昨天投的谁。',
      '没什么好说的，投我的人里，有狼。',
      '认了。我是好人，剩下的靠你们了。',
      '最后说一句：{t}，我盯你很久了。'
    ],
    w1: [
      '今晚刀{t}。他白天话最多，留着迟早要出事。',
      '{t}看着像村民，先清干净，别让他活到第三天。',
      '别碰{t}，刀了他反而把火引到我们身上。',
      '我建议刀{t}，他刚才那个反应不太像平民。',
      '随便，你们定，我跟着投。',
      '{t}白天踩过我，今晚就他了。',
      '稳一点，先刀{t}，别乱刀。',
      '{t}的发言太干净了，干净得像有身份。'
    ],
    w2: [
      '昨天没刀掉{t}，今天不能再留。',
      '{t}在带节奏，今晚必须处理。',
      '我觉得{t}才是真威胁，别管其他人。',
      '刀{t}，明天我们装作什么都不知道。',
      '别刀{t}了，留着他背锅更划算。',
      '{t}已经怀疑到我们头上了，今晚就他。'
    ]
  };

  /* ------------------------------------------------------------
     3. 玩家名册（占位代理）
        接 DSH 后这里换成真实子代理，名字/头像仍由前端给。
     ------------------------------------------------------------ */
  var AGENT_NAMES = ['灰鳍', '铁锚', '夜莺', '青鳞', '老鲸', '银钩',
                     '雾角', '沙丁', '礁石', '灯塔', '碎冰', '暖流'];

  function createRoster(mode, profile, rng, selfSeat) {
    rng = rng || Math.random;
    profile = profile || {};
    var n = mode.seats;
    var me = selfSeat || 1;
    var names = shuffle(AGENT_NAMES, rng);
    var avs = (global.WWAvatars ? global.WWAvatars.all() : []).map(function (a) { return a.id; });
    if (!avs.length) avs = ['wolf'];
    var avShuffled = shuffle(avs, rng);

    var players = [];
    var nameAt = 0, avAt = 0;
    for (var i = 0; i < n; i++) {
      var seat = i + 1;
      var isSelf = seat === me;
      players.push({
        seat: seat,
        name: isSelf ? (profile.name || '你') : names[nameAt++ % names.length],
        avatarId: isSelf ? (profile.avatarId || avs[0]) : avShuffled[avAt++ % avShuffled.length],
        avatarData: isSelf ? (profile.avatarData || '') : '',
        isSelf: isSelf
      });
    }
    return players;
  }

  /* ------------------------------------------------------------
     4. 建局
     ------------------------------------------------------------ */
  function create(opts) {
    opts = opts || {};
    var mode = global.WWModes.byId(opts.modeId) || global.WWModes.list()[0];
    var rng = opts.rng || Math.random;
    var selfSeat = opts.selfSeat || 1;
    var players = opts.players || createRoster(mode, opts.profile, rng, selfSeat);

    var enabledList = opts.enabledRoles || DEFAULT_ENABLED;
    function isEnabled(rid) { return enabledList.indexOf(rid) >= 0; }

    function modeHasRole(rid) {
      for (var i = 0; i < mode.lineup.length; i++) if (mode.lineup[i][0] === rid) return true;
      return false;
    }

    /* --- 发牌：座位与身份都随机；未实现的身份先当村民 --- */
    var deck = shuffle(global.WWModes.deckOf(mode), rng).map(function (r) {
      return isEnabled(r) ? r : VILLAGER;
    });

    /* 调试/测试用：把 selfRole 硬塞给自己所在的座位 */
    if (opts.selfRole) {
      var at = selfSeat - 1;
      var want = deck.indexOf(opts.selfRole);
      if (want >= 0 && want !== at) {
        var tmp = deck[at]; deck[at] = deck[want]; deck[want] = tmp;
      } else if (want < 0) {
        deck[at] = opts.selfRole;
      }
    }

    var seats = players.map(function (p, i) {
      return {
        seat: p.seat || (i + 1),
        name: p.name,
        avatarId: p.avatarId,
        avatarData: p.avatarData || '',
        alive: true,
        isSelf: (p.seat || (i + 1)) === selfSeat
      };
    });

    var roles = {};
    seats.forEach(function (s, i) { roles[s.seat] = deck[i]; });

    /* --- 运行时状态 --- */
    var st = {
      modeId: mode.id,
      modeTitle: mode.title,
      day: 0,
      phase: 'night',
      stage: 'night_start',
      selfSeat: selfSeat,
      cursor: 'night_open',

      /* 白天发言 */
      speakQueue: [],
      speakAt: -1,
      votes: {},

      /* 狼人夜间 */
      wolfTalkQueue: [],
      wolfTalkAt: -1,
      wolfVotes: {},
      wolfTarget: 0,          /* 今晚刀口（仅狼、女巫可见），到 dawn 才生效 */
      lastNightDeaths: [],

      /* 女巫：一局各一瓶药，一晚最多用一瓶 */
      witchSaveLeft: 1,       /* 解药余量 */
      witchPoisonLeft: 1,     /* 毒药余量 */
      witchSaved: 0,          /* 本晚被解药救下的座位（0 = 没救） */
      witchPoisonTarget: 0,   /* 本晚被毒死的座位（0 = 没毒） */
      witchStage: 'idle',     /* 'save' | 'poison' | 'done' */
      witchSaveUsedTonight: false,

      /* 预言家：一局里验过的人 + 结果 */
      seerChecks: {},         /* seat → 'wolf' | 'good' */
      seerLastCheck: 0,       /* 本晚验的座位（0 = 没验） */
      seerStage: 'idle',      /* 'idle' | 'check' | 'done' */

      /* 守卫：每晚第一个行动，守一个人免于狼刀；不能连守同一个人 */
      guardSaved: 0,          /* 本晚被守护的座位（0 = 没守） */
      guardLast: 0,           /* 上一晚守过谁（不能连守），跳过夜晚则清零 */
      guardActor: 0,          /* 本晚行动的守卫座位 */
      guardStage: 'idle',     /* 'idle' | 'pick' | 'done' */

      /* 猎人：倒下时开枪带走一个人（刀、毒、放逐都能开） */
      gunFor: 0,              /* 正在开枪的猎人座位 */
      gunUsed: {},            /* 已经开过枪的座位，防止重复 */
      gunNext: '',            /* 开完枪之后该去哪个 cursor */

      /* 投票顺序：按座位升序逐个进行 */
      voteQueue: [],
      voteAt: -1,

      lastExile: 0,
      lastWordsFor: 0,
      pending: 'none',
      over: null,
      log: [],

      /* 代理决策 */
      brain: null,
      decided: {},            /* 外部喂回来的结论：'type:seat' → payload */
      awaiting: null          /* 当前等待外部决策的请求 */
    };

    /* ------------------------------------------------------------
       5. 查询辅助
       ------------------------------------------------------------ */
    function seatOf(n) {
      for (var i = 0; i < seats.length; i++) if (seats[i].seat === n) return seats[i];
      return null;
    }
    function roleOf(seat) { return roles[seat]; }
    function aliveSeats() {
      var out = [];
      for (var i = 0; i < seats.length; i++) if (seats[i].alive) out.push(seats[i].seat);
      return out;   /* 天然按座位号升序 */
    }
    function aliveWolves() {
      return aliveSeats().filter(function (s) { return roleOf(s) === WOLF; });
    }
    function deadSeats() {
      return seats.filter(function (s) { return !s.alive; }).map(function (s) { return s.seat; });
    }
    /* 还活着的预言家座位；没启用/模式里没有/已出局都返回 0 */
    function seerSeat() {
      if (!isEnabled(SEER) || !modeHasRole(SEER)) return 0;
      for (var i = 0; i < seats.length; i++) {
        if (roles[seats[i].seat] === SEER && seats[i].alive) return seats[i].seat;
      }
      return 0;
    }

    /* 还活着的守卫座位；没启用/模式里没有/已出局都返回 0 */
    function guardSeat() {
      if (!isEnabled(GUARD) || !modeHasRole(GUARD)) return 0;
      for (var i = 0; i < seats.length; i++) {
        if (roles[seats[i].seat] === GUARD && seats[i].alive) return seats[i].seat;
      }
      return 0;
    }
    /* 守卫今晚能守谁：所有活人，去掉上一晚守过的那个（可以守自己） */
    function guardPool() {
      return aliveSeats().filter(function (s) { return s !== st.guardLast; });
    }

    /* 还活着的女巫座位；没启用/模式里没有/已出局都返回 0 */
    function witchSeat() {
      if (!isEnabled(WITCH) || !modeHasRole(WITCH)) return 0;
      for (var i = 0; i < seats.length; i++) {
        if (roles[seats[i].seat] === WITCH && seats[i].alive) return seats[i].seat;
      }
      return 0;
    }

    /* ------------------------------------------------------------
       6. 日志写入（audience: 'all' 公开 / 'wolf' 仅狼可见）
       ------------------------------------------------------------ */
    function push(text, kind, audience) {
      var m = { kind: kind || 'system', text: text, audience: audience || 'all' };
      st.log.push(m);
      return m;
    }

    function pushSpeech(seat, text, o) {
      o = o || {};
      var s = seatOf(seat);
      var m = {
        kind: o.kind || 'speech',
        audience: o.audience || 'all',
        seat: seat,
        name: s ? s.name : '',
        avatarId: s ? s.avatarId : '',
        avatarData: s ? s.avatarData : '',
        isSelf: seat === selfSeat,
        text: text
      };
      st.log.push(m);
      return m;
    }

    /* 该日志对某个身份是否可见 */
    function visibleTo(m, role) {
      if (!m.audience || m.audience === 'all') return true;
      if (m.audience === 'wolf') return role === WOLF;
      if (m.audience === 'witch') return role === WITCH;
      if (m.audience === 'seer') return role === SEER;
      if (m.audience === 'guard') return role === GUARD;
      return false;
    }

    /* ------------------------------------------------------------
       7. 代理决策：统一入口
          brain.act(req) → 字符串 / 座位号 / PENDING
          外部（DSH）接管时：step() 停住，pending='agent'，
          调用方用 resumeAgent(payload) 把子代理的结论塞回来。
       ------------------------------------------------------------ */
    function buildReq(type, seat) {
      var role = roleOf(seat);
      var self = seatOf(seat);
      var vis = st.log.filter(function (m) { return visibleTo(m, role); })
        .map(function (m) {
          return { kind: m.kind, seat: m.seat || 0, name: m.name || '', text: m.text };
        });
      /* 座位号 -> 名字。名字是公开信息，给全是为了让发言和投票说人话。 */
      var names = {};
      for (var ni = 0; ni < seats.length; ni++) names[seats[ni].seat] = seats[ni].name;
      return {
        type: type,
        day: st.day,
        phase: st.phase,
        seat: seat,
        name: self ? self.name : '',
        names: names,
        role: role,
        camp: (global.WWRoles[role] || {}).camp || 'good',
        allies: role === WOLF ? aliveWolves().filter(function (s) { return s !== seat; }) : [],
        aliveSeats: aliveSeats(),
        deadSeats: deadSeats(),
        /* 女巫也需要知道今晚谁被刀了，才谈得上救不救 */
        wolfTarget: (role === WOLF || role === WITCH) ? st.wolfTarget : 0,
        potions: role === WITCH
          ? { save: st.witchSaveLeft, poison: st.witchPoisonLeft }
          : null,
        /* 预言家：已经验过谁、结果是什么（只有他自己拿到） */
        checks: role === SEER
          ? Object.keys(st.seerChecks).map(function (k) {
              return { seat: Number(k), result: st.seerChecks[k] };
            })
          : null,
        /* 守卫：上一晚守过谁（今晚不能再守） */
        guardLast: role === GUARD ? st.guardLast : 0,
        log: vis
      };
    }

    function takeDecision(type, seat) {
      var key = type + ':' + seat;
      if (Object.prototype.hasOwnProperty.call(st.decided, key)) {
        var v = st.decided[key];
        delete st.decided[key];
        return v;
      }
      var req = buildReq(type, seat);
      var out = st.brain ? st.brain.act(req) : PENDING;
      if (out === PENDING || out == null) {
        st.awaiting = req;
        return PENDING;
      }
      return out;
    }

    /* ------------------------------------------------------------
       8. 占位决策实现（模板发言 + 稳定伪随机投票）
       ------------------------------------------------------------ */
    function renderLine(seat, key, o) {
      o = o || {};
      var pool = LINES[key] || LINES.d1;
      var tpl = pool[Math.floor(rng() * pool.length) % pool.length];
      var others = aliveSeats().filter(function (s) {
        if (s === seat) return false;
        if (o.nonWolf && roleOf(s) === WOLF) return false;
        return true;
      });
      var t = others.length ? others[Math.floor(rng() * others.length) % others.length] : 0;
      var dead = deadSeats();
      var deadSeat = dead.length ? dead[Math.floor(rng() * dead.length) % dead.length] : 0;
      var died = st.lastNightDeaths.length ? st.lastNightDeaths[0] : 0;
      return tpl
        .replace(/\{t\}/g, t ? (t + ' 号') : '某位')
        .replace(/\{dead\}/g, deadSeat ? (deadSeat + ' 号') : '昨天那位')
        .replace(/\{died\}/g, died ? (died + ' 号') : '昨夜那位');
    }

    function agentVote(seat) {
      var cands = aliveSeats().filter(function (s) { return s !== seat; });
      if (!cands.length) return 0;
      /* 用座位号 + 天数做稳定伪随机：同一个代理的偏好有连续性，不会一天一变 */
      var seed = (seat * 31 + st.day * 17) % cands.length;
      return cands[seed];
    }

    function wolfVotePick(seat) {
      var targets = aliveSeats().filter(function (s) { return roleOf(s) !== WOLF; });
      if (!targets.length) return 0;
      /* 第一夜不刀玩家本人，保证能玩到第一个白天 */
      if (opts.protectSelf && st.day === 1) {
        var safe = targets.filter(function (s) { return s !== selfSeat; });
        if (safe.length) targets = safe;
      }
      /* 狼人倾向抱团：七成概率跟随同伴已经投出的刀口 */
      var cast = Object.keys(st.wolfVotes).map(function (k) { return st.wolfVotes[k]; })
        .filter(function (v) { return !!v; });
      if (cast.length && rng() < 0.7) {
        var follow = cast[0];
        if (targets.indexOf(follow) >= 0) return follow;
      }
      var seed = (seat * 13 + st.day * 29) % targets.length;
      return targets[seed];
    }

    var templateBrain = {
      act: function (req) {
        switch (req.type) {
          case 'wolf_talk': return renderLine(req.seat, req.day === 1 ? 'w1' : 'w2', { nonWolf: true });
          case 'wolf_vote': return wolfVotePick(req.seat);
          case 'speak':     return renderLine(req.seat, req.day === 1 ? 'd1' : 'd2');
          case 'vote':      return agentVote(req.seat);

          /* 女巫：模板策略保守——有药、有刀口、且随机数偏低时才救；毒药默认不用 */
          case 'witch_save': {
            if (!req.potions || !req.potions.save || !req.wolfTarget) return false;
            return rng() < 0.5;
          }
          case 'witch_poison': return 0;

          /* 预言家：优先验没验过的人，好人/狼人都先验最靠前的 */
          case 'seer_check': {
            var done = {};
            (req.checks || []).forEach(function (c) { done[c.seat] = 1; });
            var pool = (req.aliveSeats || []).filter(function (s) {
              return s !== req.seat && !done[s];
            });
            if (!pool.length) return 0;
            return pool[(req.seat * 7 + req.day * 11) % pool.length];
          }

          /* 守卫：排除上一晚守过的人，按座位号错开 */
          case 'guard_pick': {
            var gpool2 = (req.aliveSeats || []).filter(function (s) { return s !== req.guardLast; });
            if (!gpool2.length) return 0;
            return gpool2[(req.seat * 3 + req.day * 7) % gpool2.length];
          }

          /* 猎人：优先带走还没带走过的可疑对象，模板里按座位号错开 */
          case 'hunter_gun': {
            var gpool = (req.aliveSeats || []).filter(function (s) { return s !== req.seat; });
            if (!gpool.length) return 0;
            return gpool[(req.seat * 5 + req.day * 13) % gpool.length];
          }

          default:          return null;
        }
      }
    };
    st.brain = templateBrain;

    /* ------------------------------------------------------------
       9. 胜负判定
       ------------------------------------------------------------ */
    function checkOver() {
      var wolves = 0, goods = 0;
      seats.forEach(function (s) {
        if (!s.alive) return;
        if (roleOf(s.seat) === WOLF) wolves++; else goods++;
      });
      if (wolves === 0) return { winner: 'good', reason: '所有狼人已出局' };
      if (wolves >= goods) return { winner: 'wolf', reason: '狼人数量已不少于好人' };
      return null;
    }

    /* ------------------------------------------------------------
       10. 状态机：每一步只做一件事
       ------------------------------------------------------------ */
    function aNightOpen() {
      st.day += 1;
      st.phase = 'night';
      st.stage = 'night_start';
      st.votes = {};
      st.wolfVotes = {};
      st.wolfTarget = 0;
      st.wolfTalkQueue = [];
      st.wolfTalkAt = -1;
      st.lastExile = 0;
      /* 猎人：只重置「本次」开枪状态，gunUsed 跨夜保留（一人只开一次枪） */
      st.gunFor = 0;
      st.gunNext = '';
      /* 守卫：只重置「本晚」守护状态，guardLast（不能连守）跨夜保留 */
      st.guardSaved = 0;
      st.guardActor = 0;
      st.guardStage = 'idle';
      /* 女巫：只重置「本晚」用药状态，药品余量跨夜保留 */
      st.witchSaved = 0;
      st.witchPoisonTarget = 0;
      st.witchSaveUsedTonight = false;
      st.witchStage = 'idle';
      /* 预言家：只重置本晚查验，历史查验结果跨夜保留 */
      st.seerLastCheck = 0;
      st.seerStage = 'idle';
      /* 投票队列 */
      st.voteQueue = [];
      st.voteAt = -1;
      push('第 ' + st.day + ' 夜 · 天黑请闭眼');
      st.cursor = 'night_guard';
      return true;
    }

    /* ---- 守卫：夜里第一个睁眼，守一个人免于狼刀 ---- */
    function aNightGuard() {
      st.guardSaved = 0;
      st.guardActor = 0;
      var gs = guardSeat();
      if (!gs) {
        st.guardStage = 'idle';
        st.guardLast = 0;
        st.cursor = 'wolf_talk_start';
        return true;
      }
      st.stage = 'night_guard';
      st.guardActor = gs;
      st.guardStage = 'pick';
      push('守卫请睁眼。', 'system', 'guard');
      st.cursor = 'guard_pick';
      return true;
    }

    function applyGuardPick(gs, target) {
      var s = Number(target) || 0;
      var p = s ? seatOf(s) : null;
      /* 非法目标（空、已出局、上一晚刚守过）一律当作没守 */
      if (!s || !p || !p.alive || s === st.guardLast) {
        st.guardSaved = 0;
        st.guardLast = 0;
        push('你今晚没有守护任何人。', 'guard', 'guard');
        return;
      }
      st.guardSaved = s;
      st.guardLast = s;
      push('你守护了 ' + s + ' 号「' + p.name + '」。', 'guard', 'guard');
    }

    function aGuardPick() {
      var gs = guardSeat();
      if (!gs) { st.guardStage = 'done'; st.cursor = 'wolf_talk_start'; return true; }

      if (gs === selfSeat) { st.pending = 'self_guard_pick'; return false; }

      var out = takeDecision('guard_pick', gs);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      applyGuardPick(gs, out);
      st.guardStage = 'done';
      st.cursor = 'wolf_talk_start';
      return true;
    }

    /* 狼人第一件事：内部讨论 */
    function aWolfTalkStart() {
      st.stage = 'night_wolves';
      st.wolfTalkQueue = aliveWolves();
      st.wolfTalkAt = -1;
      if (!st.wolfTalkQueue.length) {
        st.cursor = 'wolf_vote_start';
        return true;
      }
      push('狼人请睁眼，先商量今晚刀谁。', 'system', 'wolf');
      st.cursor = 'wolf_talk_next';
      return true;
    }

    function aWolfTalkNext() {
      if (st.wolfTalkAt < 0) st.wolfTalkAt = 0;
      while (st.wolfTalkAt < st.wolfTalkQueue.length && !seatOf(st.wolfTalkQueue[st.wolfTalkAt]).alive) {
        st.wolfTalkAt += 1;
      }
      if (st.wolfTalkAt >= st.wolfTalkQueue.length) {
        st.cursor = 'wolf_vote_start';
        return true;
      }
      var seat = st.wolfTalkQueue[st.wolfTalkAt];

      if (seat === selfSeat) {
        st.pending = 'self_wolf_talk';
        return false;
      }

      var out = takeDecision('wolf_talk', seat);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      pushSpeech(seat, String(out), { kind: 'wolf', audience: 'wolf' });
      st.wolfTalkAt += 1;
      return true;
    }

    function aWolfVoteStart() {
      st.stage = 'night_wolves';
      st.wolfVotes = {};
      push('狼人开始投票，决定今晚的刀口。', 'system', 'wolf');
      st.cursor = 'wolf_vote_next';
      return true;
    }

    function aWolfVoteNext() {
      var wolves = aliveWolves();
      if (!wolves.length) { st.cursor = 'wolf_vote_resolve'; return true; }

      var next = 0;
      for (var i = 0; i < wolves.length; i++) {
        if (st.wolfVotes[wolves[i]] == null) { next = wolves[i]; break; }
      }
      if (!next) { st.cursor = 'wolf_vote_resolve'; return true; }

      if (next === selfSeat) {
        st.pending = 'self_wolf_vote';
        return false;
      }

      var out = takeDecision('wolf_vote', next);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      var target = Number(out) || 0;
      var tp = seatOf(target);
      if (!tp || !tp.alive || roleOf(target) === WOLF) target = 0;
      st.wolfVotes[next] = target;
      return true;
    }

    function aWolfVoteResolve() {
      var tally = {};
      var detail = [];
      Object.keys(st.wolfVotes).sort(num).forEach(function (k) {
        var t = st.wolfVotes[k];
        if (!t) return;
        tally[t] = (tally[t] || 0) + 1;
        detail.push(k + '→' + t);
      });

      if (detail.length) push('狼人票型：' + detail.join('　'), 'system', 'wolf');

      var max = 0, top = [];
      Object.keys(tally).forEach(function (s) {
        var c = tally[s];
        if (c > max) { max = c; top = [Number(s)]; }
        else if (c === max) top.push(Number(s));
      });

      if (!top.length) {
        st.wolfTarget = 0;
        push('狼人没有达成一致，今晚空刀。', 'system', 'wolf');
      } else {
        /* 平票取座位号最小的那个，保证结果确定 */
        var target = top.slice().sort(num)[0];
        st.wolfTarget = target;
        var p = seatOf(target);
        var note = top.length > 1 ? '（意见不一，最后按 ' + target + ' 号）' : '';
        push('今晚刀口定了：' + target + ' 号「' + (p ? p.name : '') + '」' + note + '。天亮前别露。',
             'wolf', 'wolf');
      }

      /* 顺序：狼人 → 女巫 → 预言家（预言家最后一个睁眼） */
      st.cursor = 'night_witch';
      return true;
    }

    /* ---- 预言家：夜里最后一个睁眼，验一个人是狼还是好人 ---- */
    function aNightSeer() {
      st.seerLastCheck = 0;
      if (!seerSeat()) {
        st.seerStage = 'idle';
        st.cursor = 'dawn';
        return true;
      }
      st.stage = 'night_seer';
      st.seerStage = 'check';
      push('预言家请睁眼。', 'system', 'seer');
      st.cursor = 'seer_check';
      return true;
    }

    function applySeerCheck(ss, target) {
      var s = Number(target) || 0;
      if (!s) { push('你今晚没有查验任何人。', 'seer', 'seer'); return; }
      var p = seatOf(s);
      var isWolf = roleOf(s) === WOLF;
      st.seerChecks[s] = isWolf ? 'wolf' : 'good';
      st.seerLastCheck = s;
      push('你查验了 ' + s + ' 号「' + (p ? p.name : '') + '」——' +
           (isWolf ? '是狼人。' : '是好人。'), 'seer', 'seer');
    }

    function aSeerCheck() {
      var ss = seerSeat();
      if (!ss) { st.seerStage = 'done'; st.cursor = 'dawn'; return true; }

      if (ss === selfSeat) { st.pending = 'self_seer_check'; return false; }

      var out = takeDecision('seer_check', ss);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      applySeerCheck(ss, out);
      st.seerStage = 'done';
      st.cursor = 'dawn';
      return true;
    }

    /* ---- 女巫：先解药，后毒药；一晚只能用一瓶 ---- */
    function aNightWitch() {
      st.witchSaved = 0;
      st.witchPoisonTarget = 0;
      st.witchSaveUsedTonight = false;

      if (!witchSeat()) {
        st.witchStage = 'idle';
        st.cursor = 'night_seer';
        return true;
      }
      st.stage = 'night_witch';
      st.witchStage = 'save';
      push('女巫请睁眼。', 'system', 'witch');
      st.cursor = 'witch_save';
      return true;
    }

    function applyWitchSave(ws, use) {
      var victim = seatOf(st.wolfTarget);
      var who = st.wolfTarget + ' 号「' + (victim ? victim.name : '') + '」';
      if (use) {
        st.witchSaveLeft -= 1;
        st.witchSaved = st.wolfTarget;
        st.witchSaveUsedTonight = true;
        push('你用解药救下了 ' + who + '。今晚不能再动毒药了。', 'witch', 'witch');
      } else {
        push('你没有使用解药。' + who + ' 会在天亮时倒下。', 'witch', 'witch');
      }
    }

    function applyWitchPoison(ws, target) {
      var s = Number(target) || 0;
      if (!s) {
        push('你没有使用毒药。', 'witch', 'witch');
        return;
      }
      var p = seatOf(s);
      st.witchPoisonLeft -= 1;
      st.witchPoisonTarget = s;
      push('你把毒药倒给了 ' + s + ' 号「' + (p ? p.name : '') + '」，他会在天亮时倒下。', 'witch', 'witch');
    }

    function aWitchSave() {
      var ws = witchSeat();
      /* 没药 / 今晚没人被刀 / 女巫已出局 → 直接进入毒药环节 */
      if (!ws || !st.witchSaveLeft || !st.wolfTarget) {
        st.witchStage = 'poison';
        st.cursor = 'witch_poison';
        return true;
      }
      var victim = seatOf(st.wolfTarget);
      if (!victim || !victim.alive) {
        st.witchStage = 'poison';
        st.cursor = 'witch_poison';
        return true;
      }

      if (ws === selfSeat) { st.pending = 'self_witch_save'; return false; }

      var out = takeDecision('witch_save', ws);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      applyWitchSave(ws, out === true || out === 1 || out === 'yes');
      st.witchStage = 'poison';
      st.cursor = 'witch_poison';
      return true;
    }

    function aWitchPoison() {
      var ws = witchSeat();
      /* 用了解药这晚就跳过毒药；没药 / 女巫已出局也跳过 */
      if (!ws || !st.witchPoisonLeft || st.witchSaveUsedTonight) {
        st.witchStage = 'done';
        st.cursor = 'night_seer';
        return true;
      }

      if (ws === selfSeat) { st.pending = 'self_witch_poison'; return false; }

      var out = takeDecision('witch_poison', ws);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      applyWitchPoison(ws, out);
      st.witchStage = 'done';
      st.cursor = 'night_seer';
      return true;
    }

    /* 天亮：夜里被刀标记的人真正出局 */
    function aDawn() {
      st.phase = 'day';
      st.stage = 'day_announce';
      st.lastNightDeaths = [];

      /* 刀口：守卫守护 / 女巫解药都能救人，但「同守同救」时两者一起失效 */
      var guarded = st.wolfTarget > 0 && st.guardSaved === st.wolfTarget;
      var rescued = st.wolfTarget > 0 && st.witchSaved === st.wolfTarget;
      var both = guarded && rescued;
      /* 只被守、只被救 → 活下来；都没人管、或者同守同救 → 倒下 */
      if (st.wolfTarget && guarded === rescued) {
        var p = seatOf(st.wolfTarget);
        if (p && p.alive) {
          p.alive = false;
          st.lastNightDeaths.push(st.wolfTarget);
        }
      }
      /* 私下把结果告诉当事人，免得守了/救了却不知道有没有用 */
      if (st.wolfTarget) {
        var wp = seatOf(st.wolfTarget);
        var wname = st.wolfTarget + ' 号「' + (wp ? wp.name : '') + '」';
        if (both) {
          push('你的守护和女巫的解药撞在一起了——同守同救，' + wname + ' 还是倒下了。', 'guard', 'guard');
          push('你的解药和守卫的守护撞在一起了——同守同救，' + wname + ' 还是倒下了。', 'witch', 'witch');
        } else if (guarded) {
          push('你的守护生效了：' + wname + ' 今晚没有倒下。', 'guard', 'guard');
        } else if (rescued) {
          push('你的解药生效了：' + wname + ' 活了下来。', 'witch', 'witch');
        }
      }
      /* 毒药：天亮直接致死（万一和刀口同一人，不重复记） */
      if (st.witchPoisonTarget) {
        var q = seatOf(st.witchPoisonTarget);
        if (q && q.alive) {
          q.alive = false;
          if (st.lastNightDeaths.indexOf(st.witchPoisonTarget) < 0) {
            st.lastNightDeaths.push(st.witchPoisonTarget);
          }
        }
      }
      st.wolfTarget = 0;
      st.witchSaved = 0;
      st.witchPoisonTarget = 0;
      st.witchSaveUsedTonight = false;
      st.seerLastCheck = 0;
      st.guardSaved = 0;
      st.guardActor = 0;
      st.guardStage = 'idle';

      push('第 ' + st.day + ' 天 · 天亮了');
      st.cursor = 'announce';
      return true;
    }

    function aAnnounce() {
      if (!st.lastNightDeaths.length) {
        push('昨夜是平安夜，没有人出局。', 'death');
      } else {
        st.lastNightDeaths.forEach(function (s) {
          var p = seatOf(s);
          push('昨夜 ' + s + ' 号「' + (p ? p.name : '') + '」倒在了自家门口。', 'death');
        });
      }
      /* 猎人夜里倒下（被刀或被毒）：先公布死讯，再让他开最后一枪 */
      var gunner = 0;
      for (var gi = 0; gi < st.lastNightDeaths.length; gi++) {
        var gs = st.lastNightDeaths[gi];
        if (roleOf(gs) === HUNTER && !st.gunUsed[gs]) { gunner = gs; break; }
      }
      if (gunner) {
        st.gunFor = gunner;
        st.gunNext = 'speak_start';
        st.cursor = 'gun_start';
        return true;
      }

      st.over = checkOver();
      st.cursor = 'speak_start';
      return true;
    }

    /* ---- 猎人开枪：插入的阶段，谁倒下都能开（刀、毒、放逐） ---- */
    function aGunStart() {
      var seat = st.gunFor;
      var p = seatOf(seat);
      st.stage = 'day_gun';

      if (!seat || !p || st.gunUsed[seat]) {
        st.gunFor = 0;
        st.cursor = st.gunNext || 'speak_start';
        return true;
      }

      var targets = aliveSeats().filter(function (s) { return s !== seat; });
      if (!targets.length) {
        push(seat + ' 号「' + p.name + '」是猎人，但没有可以带走的人了。', 'death');
        st.gunUsed[seat] = 1;
        st.gunFor = 0;
        if (st.gunNext === 'speak_start') st.over = checkOver();
        st.cursor = st.gunNext || 'speak_start';
        return true;
      }

      push(seat + ' 号「' + p.name + '」是猎人，可以开枪带走一个人。', 'death');

      if (seat === selfSeat) { st.pending = 'self_hunter_gun'; return false; }

      var out = takeDecision('hunter_gun', seat);
      if (out === PENDING) { st.pending = 'agent'; return false; }
      return applyGun(seat, out);
    }

    function applyGun(seat, target) {
      var p = seatOf(seat);
      var s = Number(target) || 0;
      var tp = seatOf(s);
      if (!tp || !tp.alive || s === seat) s = 0;

      st.gunUsed[seat] = 1;
      st.gunFor = 0;
      st.pending = 'none';

      if (s) {
        tp.alive = false;
        push(seat + ' 号「' + (p ? p.name : '') + '」开枪带走了 ' + s + ' 号「' + tp.name + '」。', 'death');
      } else {
        push(seat + ' 号「' + (p ? p.name : '') + '」没有开枪。', 'death');
      }

      /* 夜里倒下开的枪：开完直接看胜负，白天流程不再继续 */
      if (st.gunNext === 'speak_start') st.over = checkOver();
      st.cursor = st.gunNext || 'speak_start';
      return true;
    }

    function aSpeakStart() {
      st.stage = 'day_speak';
      st.speakQueue = aliveSeats();     /* 从 1 号开始，跳过已出局 */
      st.speakAt = -1;
      st.lastWordsFor = 0;
      push('现在从 1 号开始依次发言，出局的人跳过。');
      st.cursor = 'speak_next';
      return true;
    }

    function aSpeakNext() {
      if (st.speakAt < 0) st.speakAt = 0;
      /* 跳过中途出局的人（猎人开枪等场景会用到） */
      while (st.speakAt < st.speakQueue.length && !seatOf(st.speakQueue[st.speakAt]).alive) {
        st.speakAt += 1;
      }
      if (st.speakAt >= st.speakQueue.length) {
        st.cursor = 'vote_start';
        return true;
      }
      var seat = st.speakQueue[st.speakAt];
      if (seat === selfSeat) {
        st.pending = 'self_speak';
        return false;
      }

      var out = takeDecision('speak', seat);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      pushSpeech(seat, String(out));
      st.speakAt += 1;
      return true;
    }

    function aVoteStart() {
      st.stage = 'day_vote';
      st.speakQueue = [];
      st.speakAt = -1;
      st.votes = {};
      /* 投票按座位号升序逐个进行，自己在自己那一号被问 */
      st.voteQueue = aliveSeats();
      st.voteAt = -1;
      push('发言结束，进入投票。从 1 号开始，依次投出自己的一票。');
      st.cursor = 'vote_next';
      return true;
    }

    /* 逐个投票：每个存活玩家按座位顺序停一次，等它自己决定 */
    function aVoteNext() {
      if (st.voteAt < 0) st.voteAt = 0;

      /* 跳过已经出局或已经投过的人 */
      while (st.voteAt < st.voteQueue.length) {
        var s = st.voteQueue[st.voteAt];
        var p = seatOf(s);
        if (p && p.alive && st.votes[s] == null) break;
        st.voteAt += 1;
      }
      if (st.voteAt >= st.voteQueue.length) {
        st.cursor = 'vote_resolve';
        return true;
      }

      var seat = st.voteQueue[st.voteAt];

      if (seat === selfSeat) { st.pending = 'self_vote'; return false; }

      var out = takeDecision('vote', seat);
      if (out === PENDING) { st.pending = 'agent'; return false; }

      var target = Number(out) || 0;
      var tp = seatOf(target);
      if (!tp || !tp.alive || target === seat) target = 0;
      st.votes[seat] = target;
      st.voteAt += 1;
      return true;
    }

    function aVoteResolve() {
      var tally = {};
      var keys = Object.keys(st.votes).sort(num);
      var detail = [];
      keys.forEach(function (k) {
        var t = st.votes[k];
        if (!t) return;
        tally[t] = (tally[t] || 0) + 1;
        detail.push(k + '→' + t);
      });

      if (detail.length) push('票型：' + detail.join('　'));

      var max = 0, top = [];
      Object.keys(tally).forEach(function (s) {
        var c = tally[s];
        if (c > max) { max = c; top = [Number(s)]; }
        else if (c === max) top.push(Number(s));
      });

      if (!top.length) {
        push('没有人投票，本轮无人出局。', 'death');
        st.lastExile = 0;
      } else if (top.length > 1) {
        push('平票（' + top.map(function (s) { return s + ' 号'; }).join('、') + '），本轮无人出局。', 'death');
        st.lastExile = 0;
      } else {
        st.lastExile = top[0];
        seatOf(top[0]).alive = false;
        push(top[0] + ' 号「' + seatOf(top[0]).name + '」以 ' + max + ' 票被放逐。', 'death');
      }
      st.stage = 'day_exile';
      st.cursor = 'exile';
      return true;
    }

    function aExile() {
      if (!st.lastExile) {
        st.over = checkOver();
        st.cursor = 'night_next';
        return true;
      }
      var seat = st.lastExile;

      /* 局内不公开身份：出局就是出局，身份留到结算再说 */

      /* 猎人被投出去：先开枪，开完枪再回来留遗言 */
      if (roleOf(seat) === HUNTER && !st.gunUsed[seat]) {
        st.gunFor = seat;
        st.gunNext = 'exile_words';
        st.cursor = 'gun_start';
        return true;
      }
      return aExileWords();
    }

    /* 放逐者的遗言。被猎人开枪打死的人走不到这里——枪下没有遗言 */
    function aExileWords() {
      var seat = st.lastExile;
      if (!seat) {
        st.over = checkOver();
        st.cursor = 'night_next';
        return true;
      }

      /* 玩家自己的遗言已经说完：收尾，进黑夜 */
      if (st.lastWordsFor === seat) {
        st.lastWordsFor = 0;
        st.over = checkOver();
        st.cursor = 'night_next';
        return true;
      }

      if (seat === selfSeat) {
        st.lastWordsFor = seat;
        st.pending = 'self_speak';
        return false;
      }
      pushSpeech(seat, renderLine(seat, 'last'));
      st.over = checkOver();
      st.cursor = 'night_next';
      return true;
    }

    function aNightNext() {
      st.lastExile = 0;
      st.lastWordsFor = 0;
      st.cursor = 'night_open';
      return true;
    }

    function advanceOnce() {
      if (st.over) return false;
      switch (st.cursor) {
        case 'night_open':       return aNightOpen();
        case 'night_guard':      return aNightGuard();
        case 'guard_pick':       return aGuardPick();
        case 'wolf_talk_start':  return aWolfTalkStart();
        case 'wolf_talk_next':   return aWolfTalkNext();
        case 'wolf_vote_start':  return aWolfVoteStart();
        case 'wolf_vote_next':   return aWolfVoteNext();
        case 'wolf_vote_resolve':return aWolfVoteResolve();
        case 'night_seer':       return aNightSeer();
        case 'night_witch':      return aNightWitch();
        case 'witch_save':       return aWitchSave();
        case 'witch_poison':     return aWitchPoison();
        case 'seer_check':       return aSeerCheck();
        case 'dawn':             return aDawn();
        case 'announce':         return aAnnounce();
        case 'speak_start':      return aSpeakStart();
        case 'speak_next':       return aSpeakNext();
        case 'vote_start':       return aVoteStart();
        case 'vote_next':        return aVoteNext();
        case 'vote_resolve':     return aVoteResolve();
        case 'gun_start':        return aGunStart();
        case 'exile':            return aExile();
        case 'exile_words':      return aExileWords();
        case 'night_next':       return aNightNext();
        default:                 return false;
      }
    }

    /* ------------------------------------------------------------
       11. view()：唯一出口，只输出 selfSeat 有权看到的东西
       ------------------------------------------------------------ */
    function buildNotes() {
      var out = [];
      var selfRole = roleOf(selfSeat);
      var selfAlive = seatOf(selfSeat).alive;

      if (selfRole === WOLF) {
        var mates = aliveWolves().filter(function (s) { return s !== selfSeat; });
        if (mates.length) {
          out.push('你的同伴：' + mates.map(function (s) {
            var p = seatOf(s);
            return s + ' 号「' + (p ? p.name : '') + '」';
          }).join('、') + '。');
        } else {
          out.push('你是最后一头狼，独自行动。');
        }
        if (st.phase === 'night' && st.wolfTarget) {
          var t = seatOf(st.wolfTarget);
          out.push('今晚刀口：' + st.wolfTarget + ' 号「' + (t ? t.name : '') + '」。');
        }
        if (selfAlive) out.push('白天要藏好，别让人看出你认识谁。');
      } else if (selfRole === SEER) {
        var checked = Object.keys(st.seerChecks).sort(num);
        if (checked.length) {
          out.push('你已经验过：' + checked.map(function (k) {
            var p = seatOf(Number(k));
            return k + ' 号「' + (p ? p.name : '') + '」' +
              (st.seerChecks[k] === 'wolf' ? '是狼' : '是好人');
          }).join('、') + '。');
        } else {
          out.push('你还没验过人。');
        }
        if (st.phase === 'night' && st.seerStage === 'check') {
          out.push('每晚可以查验一名存活玩家，得知他是狼人还是好人。');
        }
        if (selfAlive) out.push('白天要选时机报查验，报早了容易被狼人盯上。');
      } else if (selfRole === WITCH) {
        out.push('解药剩 ' + st.witchSaveLeft + ' 瓶，毒药剩 ' + st.witchPoisonLeft + ' 瓶。');
        if (st.phase === 'night' && st.wolfTarget) {
          var wt = seatOf(st.wolfTarget);
          out.push('今晚被狼人选中的是：' + st.wolfTarget + ' 号「' + (wt ? wt.name : '') + '」。');
          out.push('解药只能救这个人，也可以救你自己。');
        }
        if (st.witchSaveUsedTonight) out.push('你今晚已经用了解药，不能再动毒药。');
        else out.push('一晚只能用一瓶药：救人就毒不了，下毒就救不了。');
      } else if (selfRole === GUARD) {
        out.push('你每晚第一个行动，可以守护一名存活玩家（也可以守自己），被守的人当晚不会被狼刀带走。');
        if (st.guardLast) {
          var gl = seatOf(st.guardLast);
          out.push('你上一晚守的是 ' + st.guardLast + ' 号「' + (gl ? gl.name : '') + '」，今晚不能重复守他。');
        } else {
          out.push('今晚可以守任何人，包括你自己。');
        }
        out.push('注意：你守的人和女巫救的人是同一个时，同守同救一起失效，狼刀照样生效。');
        if (st.phase === 'night' && st.guardSaved) {
          var gsd = seatOf(st.guardSaved);
          out.push('今晚你在守：' + st.guardSaved + ' 号「' + (gsd ? gsd.name : '') + '」。');
        }
      } else if (selfRole === HUNTER) {
        out.push('你没有夜间行动，白天靠发言和投票找狼。');
        out.push('你倒下时可以开枪带走一个人——被刀、被毒、被投票放逐都能开枪。');
      } else {
        out.push('你没有夜间行动，白天靠发言和投票找狼。');
      }

      if (st.lastNightDeaths.length) {
        out.push('第 ' + st.day + ' 夜出局：' + st.lastNightDeaths.map(function (s) {
          var p = seatOf(s);
          return s + ' 号「' + (p ? p.name : '') + '」';
        }).join('、'));
      }
      if (!selfAlive) {
        out.push('你已经出局，现在是旁观视角。');
      }
      return out;
    }

    function buildActions() {
      /* 遗言 / 白天发言优先级最高：玩家自己出局也要能说最后一句 */
      if (st.pending === 'self_speak') {
        var isLast = st.lastWordsFor === selfSeat;
        return {
          kind: 'speak',
          title: isLast ? '留下你的遗言' : '轮到你发言',
          hint: isLast ? '说完就进入黑夜' : '所有人可见'
        };
      }

      /* 狼人内部讨论：只有狼看得见 */
      if (st.pending === 'self_wolf_talk') {
        return {
          kind: 'speak',
          title: '狼人内部讨论',
          hint: '只有狼人能看到',
          private: true
        };
      }

      if (st.pending === 'self_vote') {
        var cands = aliveSeats().filter(function (s) { return s !== selfSeat; });
        var vchips = cands.map(function (s) {
          var p = seatOf(s);
          return { id: 'vote-' + s, label: s + ' 号 ' + (p ? p.name : ''), target: s };
        });
        /* 弃票：target 0，选中它表示本轮不投任何人 */
        vchips.push({ id: 'vote-pass', label: '弃票', target: 0, pass: true });
        return {
          kind: 'chips',
          title: '投票放逐',
          hint: '点一个头像再点确认；不想投就选「弃票」',
          confirm: { label: '确认放逐' },
          chips: vchips
        };
      }

      /* 狼人夜间投票：刀口目标只能是好人 */
      if (st.pending === 'self_wolf_vote') {
        var targets = aliveSeats().filter(function (s) { return roleOf(s) !== WOLF; });
        return {
          kind: 'chips',
          title: '选择今晚要击杀的人',
          hint: '只有狼人能看到，天亮才公布',
          confirm: { label: '确认击杀' },
          chips: targets.map(function (s) {
            var p = seatOf(s);
            return { id: 'wolf-' + s, label: s + ' 号 ' + (p ? p.name : ''), target: s };
          })
        };
      }

      /* 预言家：选一个人查验（验过的人不再列出） */
      /* 猎人开枪：身份已经翻牌，点一个人再确认 */
      if (st.pending === 'self_hunter_gun') {
        var gseat = st.selfSeat;
        var gchips = aliveSeats().filter(function (s) { return s !== gseat; }).map(function (s) {
          var p = seatOf(s);
          return { id: 'gun-' + s, label: s + ' 号 ' + (p ? p.name : ''), target: s };
        });
        return {
          kind: 'chips',
          title: '开枪带走一个人',
          hint: '你是猎人，倒下时能开最后一枪；只有一次机会',
          private: false,
          confirm: { label: '确认开枪' },
          chips: gchips
        };
      }

      if (st.pending === 'self_seer_check') {
        var doneMap = st.seerChecks;
        var schips = aliveSeats().filter(function (s) {
          return s !== selfSeat && !doneMap[s];
        }).map(function (s) {
          var p = seatOf(s);
          return { id: 'seer-' + s, label: s + ' 号 ' + (p ? p.name : ''), target: s };
        });
        return {
          kind: 'chips',
          title: '今晚要查验谁',
          hint: '验过的人不会再列出来；结果只有你自己看得到',
          private: true,
          chips: schips
        };
      }

      /* 守卫：夜里第一个行动，守一个人（可守自己，不能连守同一个） */
      if (st.pending === 'self_guard_pick') {
        var gpchips = guardPool().map(function (s) {
          var p = seatOf(s);
          return {
            id: 'guard-' + s,
            label: s + ' 号 ' + (p ? p.name : '') + (s === selfSeat ? '（自己）' : ''),
            target: s
          };
        });
        return {
          kind: 'chips',
          title: '今晚要守护谁',
          hint: '可以守自己；不能连续两晚守同一个人',
          private: true,
          chips: gpchips
        };
      }

      /* 女巫：先用解药（只能救今晚被刀的人，可自救） */
      if (st.pending === 'self_witch_save') {
        var victimSeat = st.wolfTarget;
        var victim = seatOf(victimSeat);
        var chips = [];
        if (victimSeat && victim && victim.alive) {
          chips.push({
            id: 'wsave-yes',
            label: '用解药救 ' + victimSeat + ' 号 ' + victim.name,
            target: victimSeat
          });
        }
        chips.push({ id: 'wsave-no', label: '不用解药' });
        return {
          kind: 'chips',
          title: '要使用解药吗',
          hint: '解药剩 ' + st.witchSaveLeft + ' 瓶，只能救今晚被狼人选中的人',
          private: true,
          chips: chips
        };
      }

      /* 女巫：再决定毒药（可以毒任何人，包括自己） */
      if (st.pending === 'self_witch_poison') {
        var pchips = aliveSeats().map(function (s) {
          var p = seatOf(s);
          return { id: 'wpoison-' + s, label: s + ' 号 ' + (p ? p.name : ''), target: s };
        });
        pchips.push({ id: 'wpoison-no', label: '不用毒药' });
        return {
          kind: 'chips',
          title: '要使用毒药吗',
          hint: '毒药剩 ' + st.witchPoisonLeft + ' 瓶，选中的人天亮会倒下',
          private: true,
          chips: pchips
        };
      }

      if (st.over) {
        return {
          kind: 'idle',
          title: st.over.winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利',
          hint: st.over.reason,
          idle: '本局结束。点右上角「重开」再来一局，或「退出」回大厅。'
        };
      }

      var selfAlive = seatOf(selfSeat).alive;
      var idleText = '等待其他人……';
      if (!selfAlive) idleText = '你已经出局，只能看着他们。';
      else if (st.phase === 'night') {
        if (st.stage === 'night_wolves') idleText = '狼人正在行动，你闭上眼睛。';
        else idleText = '天黑着，你没有夜间行动。';
      }
      else if (st.cursor === 'speak_next') idleText = '正在等其他人发言。';
      else if (st.cursor === 'vote_start' || st.cursor === 'vote_resolve') idleText = '正在计票。';

      return {
        kind: 'idle',
        title: st.phase === 'night' ? '夜间' : '白天',
        hint: '仅你可见',
        idle: idleText
      };
    }

    function buildView() {
      var selfRole = roleOf(selfSeat);
      var role = global.WWRoles[selfRole] || { id: selfRole, name: selfRole, camp: 'good' };
      var isWolf = selfRole === WOLF;

      var speakingSeat = 0;
      if (st.cursor === 'speak_next' && st.speakAt >= 0 && st.speakAt < st.speakQueue.length) {
        speakingSeat = st.speakQueue[st.speakAt];
      }

      return {
        modeId: st.modeId,
        modeTitle: st.modeTitle,
        day: st.day,
        phase: st.phase,
        stage: st.stage,
        selfSeat: selfSeat,
        speakingSeat: speakingSeat,
        seats: seats.map(function (s) {
          return {
            seat: s.seat,
            name: s.name,
            avatarId: s.avatarId,
            avatarData: s.avatarData,
            alive: s.alive,
            isSelf: s.seat === selfSeat,
            isAlly: isWolf && roleOf(s.seat) === WOLF && s.seat !== selfSeat,
            voted: !!st.votes[s.seat],
            /* 被刀标记：狼人、女巫，且还在夜里时才看得到 */
            marked: (isWolf || selfRole === WITCH) && st.phase === 'night' &&
                    st.wolfTarget === s.seat
          };
        }),
        role: { id: role.id, name: role.name, camp: role.camp },
        roleNotes: buildNotes(),
        log: st.log.filter(function (m) { return visibleTo(m, selfRole); }).map(function (m) {
          return {
            kind: m.kind, seat: m.seat, name: m.name,
            avatarId: m.avatarId, avatarData: m.avatarData,
            isSelf: m.isSelf, text: m.text
          };
        }),
        actions: buildActions()
      };
    }

    /* ------------------------------------------------------------
       12. 对外接口
       ------------------------------------------------------------ */
    function snap() {
      return {
        view: buildView(),
        pending: st.pending,
        over: st.over,
        done: !!st.over && st.pending === 'over'
      };
    }

    function step() {
      var before = st.log.length;
      var guard = 0;
      while (guard++ < 400) {
        /* 玩家待办优先：即使本局已经分出胜负，也要先把遗言说完 */
        if (st.pending === 'self_speak' || st.pending === 'self_vote' ||
            st.pending === 'self_wolf_talk' || st.pending === 'self_wolf_vote' ||
            st.pending === 'self_witch_save' || st.pending === 'self_witch_poison' ||
            st.pending === 'self_seer_check' || st.pending === 'self_hunter_gun' ||
            st.pending === 'self_guard_pick' ||
            st.pending === 'agent') break;
        if (st.over) { st.pending = 'over'; break; }
        var moved = advanceOnce();
        if (!moved) break;
        if (st.log.length > before) break;   /* 产出了内容，先让前端播出去 */
      }
      return snap();
    }

    /* ---- 玩家操作 ---- */
    /* 守卫选人：target=0 表示今晚不守 */
    function guardPick(target) {
      if (st.pending !== 'self_guard_pick') return false;
      if (st.guardActor !== selfSeat) return false;
      var s = Number(target) || 0;
      if (s) {
        var p = seatOf(s);
        if (!p || !p.alive || s === st.guardLast) return false;
      }
      st.pending = 'none';
      applyGuardPick(selfSeat, s);
      st.guardStage = 'done';
      st.cursor = 'wolf_talk_start';
      return true;
    }

    function speak(text) {
      var t = String(text == null ? '' : text).trim();
      if (!t) return false;

      if (st.pending === 'self_wolf_talk') {
        pushSpeech(selfSeat, t, { kind: 'wolf', audience: 'wolf' });
        st.pending = 'none';
        st.wolfTalkAt += 1;
        return true;
      }

      if (st.pending === 'self_speak') {
        var isLast = st.lastWordsFor === selfSeat;
        pushSpeech(selfSeat, (isLast ? '【遗言】' : '') + t);
        st.pending = 'none';
        /* 遗言不属于发言队列，别动 speakAt，否则下一轮发言会跳人 */
        if (!isLast) st.speakAt += 1;
        return true;
      }
      return false;
    }

    /* 猎人：开枪带走谁（0 = 不开枪） */
    function hunterGun(target) {
      if (st.pending !== 'self_hunter_gun') return false;
      if (st.gunFor !== selfSeat) return false;
      var s = Number(target) || 0;
      if (s) {
        var p = seatOf(s);
        if (!p || !p.alive || s === selfSeat) return false;
      }
      st.pending = 'none';
      applyGun(selfSeat, s);
      return true;
    }

    /* 女巫：是否使用解药（只能救今晚被刀的人） */
    function witchSave(use) {
      if (st.pending !== 'self_witch_save') return false;
      var ws = witchSeat();
      if (!ws || ws !== selfSeat) return false;
      applyWitchSave(ws, !!use);
      st.pending = 'none';
      st.witchStage = 'poison';
      st.cursor = 'witch_poison';
      return true;
    }

    /* 女巫：用毒药毒谁（0 = 不用） */
    function witchPoison(target) {
      if (st.pending !== 'self_witch_poison') return false;
      var ws = witchSeat();
      if (!ws || ws !== selfSeat) return false;
      var s = Number(target) || 0;
      if (s) {
        var p = seatOf(s);
        if (!p || !p.alive) return false;
      }
      applyWitchPoison(ws, s);
      st.pending = 'none';
      st.witchStage = 'done';
      st.cursor = 'dawn';
      return true;
    }

    /* 预言家：今晚查验谁（0 = 不验） */
    function seerCheck(target) {
      if (st.pending !== 'self_seer_check') return false;
      var ss = seerSeat();
      if (!ss || ss !== selfSeat) return false;
      var s = Number(target) || 0;
      if (s) {
        var p = seatOf(s);
        if (!p || !p.alive) return false;
      }
      applySeerCheck(ss, s);
      st.pending = 'none';
      st.seerStage = 'done';
      st.cursor = 'dawn';
      return true;
    }

    function vote(target) {
      var s = Number(target) || 0;

      if (st.pending === 'self_wolf_vote') {
        if (!s) return false;                 /* 狼队必须刀一个人 */
        if (roleOf(s) === WOLF) return false;
        var wp = seatOf(s);
        if (!wp || !wp.alive) return false;
        st.wolfVotes[selfSeat] = s;
        st.pending = 'none';
        return true;
      }

      if (st.pending === 'self_vote') {
        /* target 0 = 弃票：记 0 票并直接推进到下一个投票者 */
        if (!s) {
          st.votes[selfSeat] = 0;
          st.pending = 'none';
          st.cursor = 'vote_next';
          return true;
        }
        if (s === selfSeat) return false;
        var p = seatOf(s);
        if (!p || !p.alive) return false;
        st.votes[selfSeat] = s;
        st.pending = 'none';
        st.cursor = 'vote_next';
        return true;
      }
      return false;
    }

    /* 统一入口：接 DSH / 自动化测试都用它 */
    function act(type, payload) {
      if (type === 'speak') return speak(payload);
      if (type === 'vote') return vote(payload);
      if (type === 'witch_save') return witchSave(payload);
      if (type === 'witch_poison') return witchPoison(payload);
      if (type === 'seer_check') return seerCheck(payload);
      if (type === 'hunter_gun') return hunterGun(payload);
      if (type === 'guard_pick') return guardPick(payload);
      return false;
    }

    /* ---- 子代理接口 ---- */
    function setBrain(brain) {
      st.brain = brain || templateBrain;
      return true;
    }

    /* 外部（DSH 子代理）把结论喂回来 */
    function resumeAgent(payload) {
      if (st.pending !== 'agent' || !st.awaiting) return false;
      var key = st.awaiting.type + ':' + st.awaiting.seat;
      st.decided[key] = payload;
      st.awaiting = null;
      st.pending = 'none';
      return true;
    }

    return {
      step: step,
      speak: speak,
      hunterGun: hunterGun,
      guardPick: guardPick,
      vote: vote,
      witchSave: witchSave,
      witchPoison: witchPoison,
      seerCheck: seerCheck,
      act: act,
      view: buildView,
      state: st,
      seats: seats,
      roles: roles,

      setBrain: setBrain,
      resumeAgent: resumeAgent,
      awaiting: function () { return st.awaiting; },

      isOver: function () { return !!st.over; },
      result: function () { return st.over; }
    };
  }

  global.WWEngine = {
    create: create,
    createRoster: createRoster,
    LINES: LINES,
    PENDING: PENDING,
    DEFAULT_ENABLED: DEFAULT_ENABLED
  };
})(window);
