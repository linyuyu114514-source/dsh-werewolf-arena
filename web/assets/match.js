/* ============================================================
   大肥鱼狼人杀 · 对局驱动器
   ------------------------------------------------------------
   职责：把「规则引擎」和「界面」接起来，并控制节奏。
     engine  → 纯状态机（rules.js），一次 step 推进一步
     game    → 纯渲染（game.js），只认 view 对象
     match   → 定时泵：一步一步走，每走一步刷新界面、等一会儿

   本文件不含任何规则判断，也不含任何 DOM 细节。
   将来接 DSH 时，只需要把 engine 里的 decide 换成异步子代理调用，
   把 pump 改成 async/await，这里的骨架不用动。
   ============================================================ */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* 每一步之间的停顿（毫秒）。发言要留出阅读时间。 */
  var PACE = {
    system: 520,
    death: 900,
    speech: 1250,
    wolf: 1150,      /* 狼人内部讨论，只有狼看得见 */
    witch: 1150,     /* 女巫的药品消息，只有女巫看得见 */
    seer: 1150,      /* 预言家的查验结果，只有预言家看得见 */
    guard: 1150,     /* 守卫的守护消息，只有守卫看得见 */
    gun: 1150,       /* 猎人开枪 */
    idle: 320
  };

  var engine = null;
  var timer = 0;
  var busy = false;
  var lastPhase = '';
  var lastStage = '';
  var revealOpen = false;

  /* ------------------------------------------------------------
     1. 渲染一帧
     ------------------------------------------------------------ */
  /* 女巫的药品操作：点 chip 立刻生效，不走「选人 + 确认」那套 */
  function witchChip(chipId, target) {
    if (!engine) return;
    var pend = engine.state.pending;
    if (pend === 'self_witch_save') {
      if (engine.witchSave(chipId === 'wsave-yes')) afterInput();
      return;
    }
    if (pend === 'self_witch_poison') {
      var seat = chipId === 'wpoison-no' ? 0 : (Number(target) || 0);
      if (engine.witchPoison(seat)) afterInput();
    }
  }

  /* 预言家查验：点一个头像即生效 */
  function seerChip(chipId, target) {
    if (!engine) return;
    var seat = Number(target) || 0;
    if (!seat) {
      var m = /^seer-(\d+)$/.exec(chipId || '');
      seat = m ? Number(m[1]) : 0;
    }
    if (seat && engine.seerCheck(seat)) afterInput();
  }

  /* 守卫守护：点一个头像即生效 */
  function guardChip(chipId, target) {
    if (!engine) return;
    var seat = Number(target) || 0;
    if (!seat) {
      var m = /^guard-(\d+)$/.exec(chipId || '');
      seat = m ? Number(m[1]) : 0;
    }
    if (seat && engine.guardPick(seat)) afterInput();
  }

  function paint(snap) {
    var view = snap.view;
    /* 女巫的 chips 是「点即生效」，把回调挂到 view 上给渲染层用 */
    if (snap.pending === 'self_witch_save' || snap.pending === 'self_witch_poison') {
      view.onChip = witchChip;
    }
    if (snap.pending === 'self_seer_check') {
      view.onChip = seerChip;
    }
    if (snap.pending === 'self_guard_pick') {
      view.onChip = guardChip;
    }
    WWGame.setState(view);

    /* 昼夜切换：放一次幕布 */
    if (lastPhase && lastPhase !== view.phase) {
      WWGame.setPhase(view.phase, {
        text: view.phase === 'day' ? '天亮了' : '天黑请闭眼'
      });
    }
    lastPhase = view.phase;

    /* 夜间 → 白天的第一次公布，单独提示一下 */
    if (lastStage !== view.stage) lastStage = view.stage;

    var bar = $('demoBar');
    if (bar) bar.dataset.over = snap.over ? '1' : '0';
  }

  /* ------------------------------------------------------------
     2. 定时泵
     ------------------------------------------------------------ */
  function waitFor() {
    var log = engine.state.log;
    var last = log.length ? log[log.length - 1] : null;
    if (!last) return PACE.system;
    return PACE[last.kind] || PACE.system;
  }

  function isWaitingOnMe(snap) {
    return snap.pending === 'self_speak' || snap.pending === 'self_vote' ||
           snap.pending === 'self_wolf_talk' || snap.pending === 'self_wolf_vote' ||
           snap.pending === 'self_witch_save' || snap.pending === 'self_witch_poison' ||
           snap.pending === 'self_seer_check' || snap.pending === 'self_hunter_gun' ||
           snap.pending === 'self_guard_pick';
  }

  function pump() {
    if (!engine || aborted) return;
    if (busy) return;
    busy = true;

    var snap;
    try {
      snap = engine.step();
    } catch (e) {
      /* 规则引擎抛错时把锁放掉，否则泵会永久停住 */
      busy = false;
      lastError = e;
      global.__WW_ERR = String(e && e.stack || e);
      if (global.console) console.error('[WWMatch] step 失败', e);
      return;
    }
    busy = false;
    paint(snap);

    /* 玩家待办优先：哪怕本局已经分出胜负，也要先把遗言说完 */
    if (isWaitingOnMe(snap)) return;      /* 等玩家操作，泵停下 */

    /* 子代理待办：接 DSH 后由子代理回报结论，再 resumeAgent 唤醒。
       目前 brain 是内置模板，同步返回，所以这条分支不会进。 */
    if (snap.pending === 'agent') { onAgentWait(snap); return; }

    if (snap.over) { onOver(snap); return; }

    timer = setTimeout(pump, waitFor());
  }

  /* 泵里最近一次异常，供排查用 */
  var lastError = null;
  /* 本局是否已经中止（中止后泵不再推进） */
  var aborted = false;

  function resume() {
    if (!engine) return;
    clearTimeout(timer);
    timer = setTimeout(pump, 260);
  }

  /* ------------------------------------------------------------
     2b. 子代理接管
     ------------------------------------------------------------ */
  /* 有后端时，把决策权整个交出去：brain 一律回答「等我」，
       引擎就会停下并把 req（已按身份过滤）交到 onAgentWait。 */
  function remoteBrain() {
    return global.WWEngine.PENDING;
  }

  function fallbackFor(type) {
    if (type === 'witch_save') return false;      /* 不用解药 */
    if (type === 'witch_poison') return 0;        /* 不用毒药 */
    if (type === 'seer_check') return 0;          /* 不查验 */
    if (type === 'hunter_gun') return 0;          /* 不开枪 */
    if (type === 'guard_pick') return 0;          /* 不守护 */
    if (type === 'vote' || type === 'wolf_vote') return 0;
    return '……';
  }

  function onAgentWait(snap) {
    var req = engine.awaiting();
    if (!req) { resume(); return; }

    if (!global.WWDshBridge || typeof WWDshBridge.ask !== 'function') {
      engine.resumeAgent(fallbackFor(req.type));
      resume();
      return;
    }

    WWDshBridge.ask(req, function (answer) {
      if (!engine) return;
      engine.resumeAgent(answer == null ? fallbackFor(req.type) : answer);
      resume();
    });
  }

  /* ------------------------------------------------------------
     2c. 中止
     子代理没回应、后端挂了——不糊弄，直接停下来告诉玩家重试。
     ------------------------------------------------------------ */
  function abort(msg) {
    if (aborted) return;
    aborted = true;
    clearTimeout(timer);
    engine = null;
    revealOpen = false;
    var rv = $('roleReveal');
    if (rv) rv.hidden = true;
    if (document.body) document.body.dataset.phase = '';

    var box = $('matchError');
    var txt = $('meText');
    if (txt) txt.textContent = msg || '子代理没有回应，本局已中止。';
    if (box) box.hidden = false;

    /* 后端那边也一并收掉，别留孤儿进程 */
    if (global.WWDshBridge) global.WWDshBridge.close();
  }

  function closeError() {
    var box = $('matchError');
    if (box) box.hidden = true;
    aborted = false;
    if (global.WWShowView) global.WWShowView('view-modes');
  }

  /* ------------------------------------------------------------
     3. 结束
     ------------------------------------------------------------ */
  function onOver(snap) {
    var r = snap.over;
    if (!r) return;
    var t = $('adTitle');
    if (t) t.textContent = r.winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利';
    /* 泵在 over 后可能被再唤醒一次（比如玩家点了最后一个操作），
       弹窗只开一次，别把身份名单重画两遍 */
    if (overShown) return;
    overShown = true;
    showSettle(r);
  }

  /* ------------------------------------------------------------
      3b. 结算弹窗
      ------------------------------------------------------------ */
  var overShown = false;      /* 本局的结算弹窗是否已经开过 */

  function escHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function avatarOf(p) {
    if (p.avatarId === 'custom' && p.avatarData) {
      return '<img src="' + p.avatarData + '" alt="">';
    }
    return global.WWAvatars ? WWAvatars.render(p.avatarId) : '';
  }

  /* 结算时的全员名单：身份全部公开 */
  function rosterHTML() {
    if (!engine) return '';
    var roles = engine.roles || {};
    var seats = engine.seats || [];
    return seats.map(function (s) {
      var rid = roles[s.seat] || 'villager';
      var meta = global.WWRoleCards ? WWRoleCards.meta(rid) : { name: rid, camp: 'good', id: rid };
      return '<div class="st-seat" data-camp="' + meta.camp + '" data-dead="' + (s.alive ? '0' : '1') + '">' +
        '<span class="st-seat-av">' + avatarOf(s) + '</span>' +
        '<span class="st-seat-info">' +
          '<b>' + s.seat + '号 ' + escHTML(s.name) + '</b>' +
          '<i>' + escHTML(meta.name) + (s.isSelf ? ' · 你' : '') + '</i>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function showSettle(over) {
    var modal = $('settleModal');
    if (!modal) return;
    var good = over.winner === 'good';
    var t = $('stTitle');
    if (t) { t.textContent = good ? '好人阵营胜利' : '狼人阵营胜利'; t.dataset.camp = over.winner; }
    var rs = $('stReason');
    if (rs) rs.textContent = over.reason || '';

    var rb = $('stRoster');
    if (rb) rb.innerHTML = rosterHTML();

    modal.hidden = false;
  }

  function hideSettle() {
    var modal = $('settleModal');
    if (modal) modal.hidden = true;
  }

  /* ------------------------------------------------------------
     4. 身份揭示
     ------------------------------------------------------------ */
  function showReveal(view) {
    var box = $('revealCard');
    var root = $('roleReveal');
    if (!box || !root) return;
    box.innerHTML = global.WWRoleCards ? WWRoleCards.card(view.role.id) : '';
    root.hidden = false;
    root.dataset.camp = view.role.camp;
    revealOpen = true;
  }

  function hideReveal() {
    var root = $('roleReveal');
    if (root) root.hidden = true;
    revealOpen = false;
    resume();
  }

  /* ------------------------------------------------------------
     5. 开局
     ------------------------------------------------------------ */
  function start(modeId, opts) {
    hideSettle();
    overShown = false;
    opts = opts || {};
    clearTimeout(timer);
    busy = false;
    aborted = false;
    var eb = $('matchError');
    if (eb) eb.hidden = true;
    lastPhase = '';
    lastStage = '';

    var profile = global.WWStore ? WWStore.read() : {};
    var mode = global.WWModes.byId(modeId) || global.WWModes.list()[0];

    /* 座位随机：自己可能在任何一号位 */
    var selfSeat = opts.selfSeat || (1 + Math.floor(Math.random() * mode.seats));

    engine = global.WWEngine.create({
      modeId: mode.id,
      profile: profile,
      selfSeat: selfSeat,
      /* 不传 selfRole 就是随机发牌（已实现的身份参与洗牌，未实现的降级成村民） */
      selfRole: opts.selfRole || '',
      enabledRoles: opts.enabledRoles,
      protectSelf: opts.protectSelf !== false   /* 首夜不刀玩家本人，避免刚开局就观战 */
    });

    var first = engine.step();
    paint(first);
    if (global.WWShowView) global.WWShowView('view-game');
    WWGame.setPhase('night', { text: '天黑请闭眼', hold: 700 });
    showReveal(first.view);

    /* 起子代理：后端会为一局开一个 DSH 子进程，每个座位一个 session。
       同时把 brain 换成「等我」——这样每个非玩家座位的行动都会停下来问后端。
       后端起不来也不影响玩：ask 立刻回 null，走本地兜底。 */
    if (global.WWDshBridge) {
      engine.setBrain({ act: remoteBrain });
      global.WWDshBridge.open(engine, abort);
    }
  }

  function exit() {
    clearTimeout(timer);
    aborted = false;
    overShown = false;
    hideSettle();
    var eb = $('matchError');
    if (eb) eb.hidden = true;
    /* 释放子代理：后端 shutdown 进程并删掉临时目录，一点不剩 */
    if (global.WWDshBridge) global.WWDshBridge.close();
    engine = null;
    busy = false;
    revealOpen = false;
    var root = $('roleReveal');
    if (root) root.hidden = true;
    if (document.body) document.body.dataset.phase = '';
    if (global.WWShowView) global.WWShowView('view-modes');
  }

  /* ------------------------------------------------------------
     6. 玩家输入
     ------------------------------------------------------------ */
  /* 玩家完成一次输入后：重画一帧再唤醒泵 */
  function afterInput() {
    paint({ view: engine.view(), pending: engine.state.pending, over: engine.state.over });
    resume();
  }

  function speak(text) {
    if (!engine) return false;
    if (!engine.speak(text)) return false;
    afterInput();
    return true;
  }

  function vote(seat) {
    if (!engine) return false;
    if (!engine.vote(seat)) return false;
    afterInput();
    return true;
  }

  function witchSave(use) {
    if (!engine) return false;
    if (!engine.witchSave(!!use)) return false;
    afterInput();
    return true;
  }

  function witchPoison(seat) {
    if (!engine) return false;
    if (!engine.witchPoison(Number(seat) || 0)) return false;
    afterInput();
    return true;
  }

  function seerCheck(seat) {
    if (!engine) return false;
    if (!engine.seerCheck(Number(seat) || 0)) return false;
    afterInput();
    return true;
  }

  function hunterGun(seat) {
    if (!engine) return false;
    if (!engine.hunterGun(Number(seat) || 0)) return false;
    afterInput();
    return true;
  }

  function guardPick(seat) {
    if (!engine) return false;
    if (!engine.guardPick(Number(seat) || 0)) return false;
    afterInput();
    return true;
  }

  /* ------------------------------------------------------------
     7. 绑定
     ------------------------------------------------------------ */
  function bind() {
    /* 中止面板：点「返回」回模式选择 */
    var back = $('meBack');
    if (back) back.addEventListener('click', closeError);

    /* 结算弹窗：再来一局 / 返回首页 */
    var again = $('stAgain');
    if (again) again.addEventListener('click', function () {
      var mid = engine ? engine.state.modeId : (WWStore.read().mode || 'mode6');
      exit();
      setTimeout(function () { start(mid); }, 60);
    });
    var home = $('stHome');
    if (home) home.addEventListener('click', function () { exit(); });

    /* 身份揭示卡：点「我知道了」继续 */
    var ok = $('revealOk');
    if (ok) ok.addEventListener('click', function () {
      if (revealOpen) hideReveal();
    });

    /* 操作区确认按钮：投票 / 狼人刀人 / 猎人开枪共用一条确认条 */
    var btn = $('adConfirmBtn');
    if (btn) btn.addEventListener('click', function () {
      var bar = $('adConfirm');
      if (!bar || bar.hidden) return;
      var tip = $('adPicked');
      /* 优先读 data-seat：0=没选，-1=弃票，正数=座位号 */
      var seat = 0;
      if (tip && tip.dataset && tip.dataset.seat != null) {
        seat = Number(tip.dataset.seat) || 0;
      } else if (tip) {
        var m = /(\d+)/.exec(tip.textContent);
        if (m) seat = Number(m[1]);
      }
      if (!seat) return;
      var pend = engine ? engine.state.pending : '';
      if (pend === 'self_hunter_gun') { if (seat > 0) hunterGun(seat); }
      else if (seat < 0) vote(0);        /* 弃票 */
      else vote(seat);
    });

    /* 发言框 */
    var box = $('talkBox');
    var send = $('talkSend');
    function doSend() {
      var t = (box && box.value || '').trim();
      if (!t) return;
      if (!speak(t)) return;
      box.value = '';
    }
    if (send) send.addEventListener('click', doSend);
    if (box) box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSend(); }
    });

    /* 顶栏控制：重开 / 退出 */
    var bar = $('demoBar');
    if (bar) bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-demo]');
      if (!b) return;
      if (b.dataset.demo === 'exit') { exit(); return; }
      if (b.dataset.demo === 'restart') {
        var mid = engine ? engine.state.modeId : (WWStore.read().mode || 'mode6');
        exit();
        setTimeout(function () { start(mid); }, 60);
      }
    });
  }

  global.WWMatch = {
    start: start,
    exit: exit,
    speak: speak,
    vote: vote,
    witchSave: witchSave,
    witchPoison: witchPoison,
    seerCheck: seerCheck,
    hunterGun: hunterGun,
    guardPick: guardPick,
    abort: abort,
    engine: function () { return engine; },
    _pump: pump
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})(window);
