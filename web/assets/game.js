/* ============================================================
   大肥鱼狼人杀 · 局内界面（白天 / 黑夜通用）
   ------------------------------------------------------------
   布局：顶部天象栏 / 左头像列 · 中央文本框 · 右头像列 / 底部可变操作区

   本文件只负责「渲染」，不含任何规则判断。
   规则引擎（后端）产出 view 对象，本文件把 view 画出来。
   唯一契约：WWGame.setState(view)

   view = {
     modeId, modeTitle, day, phase:'night'|'day', stage,
     selfSeat, speakingSeat,
     seats: [{ seat, name, avatarId, avatarData, alive, isSelf, isAlly, voted }],
     role:  { id, name, camp },
     roleNotes: [ '私密情报' ],
     log:   [{ kind:'system'|'death'|'whisper'|'speech', seat, name, avatarId, avatarData, text, isSelf }],
     actions: {
       kind: 'chips' | 'speak' | 'idle',
       title, hint,
       chips: [{ id, label, target, count, on, disabled }],
       idle:  '无事可做的提示文案'
     }
   }
   ============================================================ */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------
     1. 常量
     ------------------------------------------------------------ */
  var ROLE_DESC = {
    werewolf: '每晚与同伴共同选择一名玩家击杀。白天要隐藏身份，把怀疑引向别人。',
    villager: '没有特殊能力。靠听发言、盘逻辑，把狼人投出去。',
    seer:     '每晚可以查验一名玩家的阵营，是好人最重要的信息来源。',
    witch:    '有一瓶解药和一瓶毒药，各只能使用一次。夜里能救人或杀人。',
    hunter:   '倒下时可以开枪带走一名玩家——被刀、被毒、被投票放逐都能开枪。',
    guard:    '夜里第一个行动，每晚守一个人免于狼刀；可以守自己，不能连续两晚守同一个人。'
  };

  var ROLE_EN = {
    werewolf: 'WEREWOLF', villager: 'VILLAGER', seer: 'SEER',
    witch: 'WITCH', hunter: 'HUNTER', guard: 'GUARD'
  };

  var ROLE_ICON = {
    werewolf: '<path d="M12 3 L20 6 L22 13 Q22 20 12 23 Q2 20 2 13 L4 6 Z" fill="currentColor"/>',
    villager: '<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 22 Q4 14 12 14 Q20 14 20 22 Z" fill="currentColor"/>',
    seer:     '<path d="M1 12 Q12 3 23 12 Q12 21 1 12 Z" fill="currentColor"/><circle cx="12" cy="12" r="4" fill="#0a0f1a"/>',
    witch:    '<rect x="8" y="2" width="8" height="3" rx="1" fill="currentColor"/><path d="M9 5 L15 5 L15 9 Q21 12 21 17 Q21 23 12 23 Q3 23 3 17 Q3 12 9 9 Z" fill="currentColor"/>',
    hunter:   '<path d="M12 2 L14 9 L21 9 L15 13 L17 21 L12 16 L7 21 L9 13 L3 9 L10 9 Z" fill="currentColor"/>',
    guard:    '<path d="M12 2 L21 6 V13 Q21 20 12 23 Q3 20 3 13 V6 Z" fill="currentColor"/><path d="M12 7 L14 11 L18 11 L15 14 L16 18 L12 15 L8 18 L9 14 L6 11 L10 11 Z" fill="#0a0f1a"/>'
  };

  var STAGES = {
    night: [
      { id: 'night_start',  label: '入夜' },
      { id: 'night_guard',  label: '守卫' },
      { id: 'night_wolves', label: '狼人' },
      { id: 'night_witch',  label: '女巫' },
      { id: 'night_seer',   label: '预言家' }
    ],
    day: [
      { id: 'day_announce', label: '公布' },
      { id: 'day_gun',      label: '开枪' },
      { id: 'day_speak',    label: '发言' },
      { id: 'day_vote',     label: '投票' },
      { id: 'day_exile',    label: '放逐' }
    ]
  };

  var HUB = {
    night_start:  { t: '天黑请闭眼',   n: '今夜无人睁眼' },
    night_wolves: { t: '狼人请睁眼',   n: '选择今晚要击杀的人' },
    night_seer:   { t: '预言家请睁眼', n: '选择今晚要查验的人' },
    night_witch:  { t: '女巫请睁眼',   n: '要不要用药，用在哪' },
    night_guard:  { t: '守卫请睁眼',   n: '选择今晚要守护的人' },
    night_idle:   { t: '天黑请闭眼',   n: '你今晚没有行动' },
    day_announce: { t: '天亮了',       n: '公布昨夜结果' },
    day_gun:      { t: '猎人开枪',     n: '选择带走一个人' },
    day_speak:    { t: '自由发言',     n: '依次陈述你的判断' },
    day_vote:     { t: '投票放逐',     n: '选出你认为最可疑的人' },
    day_exile:    { t: '结果揭晓',     n: '本轮放逐结果' }
  };

  /* ------------------------------------------------------------
     2. 内部状态
     ------------------------------------------------------------ */
  var state = null;
  var logSeen = 0;
  var picked = 0;          /* 当前选中的目标座位；0=未选，-1=弃票 */

  /* ------------------------------------------------------------
     3. 头像
     ------------------------------------------------------------ */
  function avatarHTML(p) {
    if (p && p.avatarId === 'custom' && p.avatarData) {
      return '<img src="' + p.avatarData + '" alt="">';
    }
    return WWAvatars.render(p && p.avatarId ? p.avatarId : 'wolf');
  }

  function pcardHTML(s, pickable) {
    var cls = 'pcard' + (pickable ? ' is-pickable' : '');
    if (picked && picked === s.seat && pickable) cls += ' is-picked';
    return '<button type="button" class="' + cls + '"' +
      ' data-seat="' + s.seat + '"' +
      ' data-self="' + (s.isSelf ? 1 : 0) + '"' +
      ' data-ally="' + (s.isAlly ? 1 : 0) + '"' +
      ' data-alive="' + (s.alive === false ? 0 : 1) + '"' +
      ' data-speaking="' + (s.speaking ? 1 : 0) + '"' +
      ' data-voted="' + (s.voted ? 1 : 0) + '"' +
      ' data-marked="' + (s.marked ? 1 : 0) + '"' +
      ' aria-label="' + s.seat + ' 号 ' + s.name + (s.alive === false ? '（已出局）' : '') + '">' +
        '<span class="pcard-av">' + avatarHTML(s) +
          '<span class="pcard-no">' + s.seat + '</span>' +
        '</span>' +
        '<span class="pcard-text">' +
          '<span class="pcard-name">' + s.name + '</span>' +
          '<span class="pcard-id">' + String(s.seat).padStart(2, '0') + ' 号</span>' +
        '</span>' +
      '</button>';
  }

  /* ------------------------------------------------------------
     4. 左右两列头像
        自己固定在左列最底部；其他人按座位号先填左列（自下而上），
        再填右列（自上而下）。
     ------------------------------------------------------------ */
  function renderSeats(view) {
    var left = $('railLeft');
    var right = $('railRight');
    if (!left || !right) return;

    var seats = (view.seats || []).slice();
    var self = null, others = [];
    seats.forEach(function (s) {
      s.speaking = (s.seat === view.speakingSeat);
      if (s.isSelf) self = s; else others.push(s);
    });
    others.sort(function (a, b) { return a.seat - b.seat; });

    var pickable = !!(view.actions && view.actions.kind === 'chips' && view.actions.pickable !== false);

    /* 两列要对称：按含自己的总人数分，自己在左列最底部 */
    var total = seats.length;
    var leftSlots = Math.ceil(total / 2);        /* 左列容纳的卡片数（含自己） */
    var leftOthers = leftSlots - (self ? 1 : 0);
    var leftGroup = others.slice(0, leftOthers);
    var rightGroup = others.slice(leftOthers);

    var leftHTML = leftGroup.slice().reverse().map(function (s) { return pcardHTML(s, pickable); }).join('');
    if (self) leftHTML += pcardHTML(self, false);
    left.innerHTML = leftHTML;

    right.innerHTML = rightGroup.map(function (s) { return pcardHTML(s, pickable); }).join('');

    /* 点击：可选中目标时选中，否则提示 */
    [left, right].forEach(function (rail) {
      rail.querySelectorAll('.pcard').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sid = Number(btn.dataset.seat);
          if (btn.dataset.alive === '0') { if (global.WWToast) WWToast('该玩家已出局'); return; }
          if (!btn.classList.contains('is-pickable')) { if (global.WWToast) WWToast(sid + ' 号'); return; }
          pickSeat(sid);
        });
      });
    });
  }

  /* 选中一个座位：同步 chip 高亮 + 回调 */
  function pickSeat(seat) {
    picked = seat;
    var chips = $('adChips');
    if (chips) {
      chips.querySelectorAll('.na-chip').forEach(function (b) {
        var bt = b.dataset.pass === '1' ? -1 : (Number(b.dataset.target) || 0);
        b.classList.toggle('is-on', bt === seat);
      });
    }
    ['railLeft', 'railRight'].forEach(function (rid) {
      var rail = $(rid);
      if (!rail) return;
      rail.querySelectorAll('.pcard').forEach(function (b) {
        b.classList.toggle('is-picked', Number(b.dataset.seat) === seat);
      });
    });
    var btn2 = $('adConfirmBtn');
    if (btn2) {
      var bar = $('adConfirm');
      if (bar && !bar.hidden) {
        btn2.disabled = !seat;
        var tip = $('adPicked');
        if (tip) {
          tip.dataset.seat = String(seat || 0);
          tip.textContent = seat === -1 ? '已弃票' : (seat ? ('已选 ' + seat + ' 号') : '还没选人');
        }
      }
    }
    if (state && typeof state.onPick === 'function') state.onPick(seat);
  }

  /* ------------------------------------------------------------
     5. 身份胶囊 + 弹层
     ------------------------------------------------------------ */
  function renderIdCard(view) {
    var role = view.role || {};
    var camp = role.camp || 'good';

    var chip = $('idChip');
    if (chip) chip.dataset.camp = camp;

    var orb = $('idOrb');
    if (orb) orb.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      (ROLE_ICON[role.id] || '') + '</svg>';

    var nm = $('idName');
    if (nm) nm.textContent = role.name || '—';

    var campShort = $('idCamp');
    if (campShort) campShort.textContent = camp === 'wolf' ? '狼人阵营' : '好人阵营';

    var pop = $('idPop');
    if (pop) pop.dataset.camp = camp;

    var campFull = $('idCampFull');
    if (campFull) campFull.textContent = camp === 'wolf' ? '狼人阵营' : '好人阵营';

    /* 弹层里放一整张身份卡（纯 SVG 绘制） */
    var cardBox = $('idPopCard');
    if (cardBox && global.WWRoleCards) {
      var html = WWRoleCards.card(role.id);
      if (cardBox.dataset.role !== role.id) {
        cardBox.innerHTML = html;
        cardBox.dataset.role = role.id;
      }
    }

    var extra = $('idExtra');
    if (extra) {
      var notes = view.roleNotes || [];
      extra.innerHTML = notes.map(function (t) {
        return '<li><i></i><span>' + t + '</span></li>';
      }).join('');
      extra.hidden = notes.length === 0;
    }

    var st = $('idState');
    if (st) st.textContent = view.phase === 'night' ? '夜间 · 身份保密' : '白天 · 身份保密';
  }

  function bindIdChip() {
    var chip = $('idChip');
    var pop = $('idPop');
    if (!chip || !pop) return;
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = pop.hidden;
      pop.hidden = !open;
      chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (pop.hidden) return;
      if (pop.contains(e.target) || chip.contains(e.target)) return;
      pop.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
    });
  }

  /* ------------------------------------------------------------
     6. 中央文本框：日志
     ------------------------------------------------------------ */
  function msgHTML(m) {
    if (m.kind === 'system' || m.kind === 'death') {
      return '<div class="msg" data-kind="' + m.kind + '">' +
        '<p class="msg-text">' + m.text + '</p></div>';
    }
    if (m.kind === 'whisper') {
      return '<div class="msg" data-kind="whisper">' +
        '<p class="msg-text">' + m.text + '</p></div>';
    }
    if (m.kind === 'wolf' || m.kind === 'witch' || m.kind === 'seer' || m.kind === 'guard') {
      var tag = m.kind === 'wolf' ? '狼'
        : (m.kind === 'witch' ? '药' : (m.kind === 'seer' ? '验' : '守'));
      return '<div class="msg" data-kind="' + m.kind + '" data-self="' + (m.isSelf ? 1 : 0) + '">' +
        '<span class="msg-av">' + avatarHTML(m) + '</span>' +
        '<div class="msg-body">' +
          '<div class="msg-meta">' +
            '<span class="msg-tag">' + tag + '</span>' +
            '<span class="msg-who">' + (m.name || '') + '</span>' +
            (m.seat ? '<span class="msg-seat">' + m.seat + ' 号</span>' : '') +
          '</div>' +
          '<p class="msg-text">' + (m.text || '') + '</p>' +
        '</div></div>';
    }
    return '<div class="msg" data-kind="' + (m.kind || 'speech') + '"' +
        ' data-self="' + (m.isSelf ? 1 : 0) + '">' +
        '<span class="msg-av">' + avatarHTML(m) + '</span>' +
        '<div class="msg-body">' +
          '<div class="msg-meta">' +
            '<span class="msg-who">' + (m.name || '') + '</span>' +
            (m.seat ? '<span class="msg-seat">' + m.seat + ' 号</span>' : '') +
          '</div>' +
          '<p class="msg-text">' + (m.text || '') + '</p>' +
        '</div></div>';
  }

  function renderLog(view, force) {
    var box = $('talkLog');
    if (!box) return;
    var log = view.log || [];
    if (force || log.length < logSeen) { box.innerHTML = ''; logSeen = 0; }
    if (log.length === logSeen) return;

    var frag = document.createElement('div');
    frag.innerHTML = log.slice(logSeen).map(msgHTML).join('');
    while (frag.firstChild) box.appendChild(frag.firstChild);
    logSeen = log.length;
    box.scrollTop = box.scrollHeight;
  }

  /* ------------------------------------------------------------
     7. 底部可变操作区
        kind = 'chips' → 夜间行动 / 投票
        kind = 'speak' → 轮到你发言
        kind = 'idle'  → 无事可做
     ------------------------------------------------------------ */
  function renderActions(view) {
    var dock = $('actionDock');
    var title = $('adTitle');
    var hint = $('adHint');
    var chips = $('adChips');
    var speak = $('adSpeak');
    var idle = $('adIdle');
    if (!dock) return;

    var a = view.actions || {};
    var kind = a.kind || 'idle';
    if (kind === 'chips' && (!a.chips || !a.chips.length)) kind = 'idle';

    dock.dataset.kind = kind;
    dock.dataset.private = a.private ? '1' : '0';
    dock.dataset.role = (view.role && view.role.id) || '';
    if (title) title.textContent = a.title || (kind === 'speak' ? '轮到你发言' : '—');
    if (hint) hint.textContent = a.hint || '';

    if (chips) chips.innerHTML = '';
    if (speak) speak.hidden = kind !== 'speak';
    if (idle) {
      idle.hidden = kind !== 'idle';
      idle.textContent = a.idle || '这一轮你无需行动，等待其他人。';
    }

    /* 需要二次确认的动作（投票）：选中一个人才能点确认 */
    var confirmBar = $('adConfirm');
    if (confirmBar) {
      var needConfirm = kind === 'chips' && !!a.confirm;
      confirmBar.hidden = !needConfirm;
      if (needConfirm) {
        var btn = $('adConfirmBtn');
        var tip = $('adPicked');
        if (btn) btn.textContent = a.confirm.label || '确认';
        if (tip) {
          tip.dataset.seat = String(picked || 0);
          tip.textContent = picked === -1 ? '已弃票'
            : (picked ? ('已选 ' + picked + ' 号') : '还没选人');
        }
        if (btn) btn.disabled = !picked;
      }
    }

    if (kind === 'chips' && chips) {
      var stillThere = a.chips.some(function (c) {
        return (c.pass ? -1 : (Number(c.target) || 0)) === picked;
      });
      if (picked && !stillThere) picked = 0;
      chips.innerHTML = a.chips.map(function (c) {
        var val = c.pass ? -1 : (Number(c.target) || 0);
        var on = c.on || (picked && val === picked);
        return '<button type="button" class="na-chip' + (on ? ' is-on' : '') + '"' +
          ' data-chip="' + c.id + '"' +
          (c.pass ? ' data-pass="1"' : '') +
          (c.target ? ' data-target="' + c.target + '"' : '') +
          (c.disabled ? ' disabled' : '') + '>' +
          (c.label || '') + (c.count != null ? ' <b>' + c.count + '</b>' : '') +
          '</button>';
      }).join('');

      chips.querySelectorAll('.na-chip').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          var t = Number(btn.dataset.target) || 0;
          if (btn.dataset.pass === '1') pickSeat(-1);      /* 弃票：选中态走 -1 */
          else if (t) pickSeat(t);
          else {
            chips.querySelectorAll('.na-chip').forEach(function (b) { b.classList.remove('is-on'); });
            btn.classList.add('is-on');
          }
          if (typeof view.onChip === 'function') view.onChip(btn.dataset.chip, t);
        });
      });
    }

    /* 发言框焦点 */
    if (kind === 'speak') {
      var box = $('talkBox');
      if (box) {
        box.disabled = false;
        setTimeout(function () { try { box.focus(); } catch (e) {} }, 60);
      }
    }
  }

  /* ------------------------------------------------------------
     8. 顶部天象栏
     ------------------------------------------------------------ */
  function renderTop(view) {
    var root = $('view-game');
    if (root) root.dataset.phase = view.phase === 'day' ? 'day' : 'night';
    if (document.body) document.body.dataset.phase = view.phase === 'day' ? 'day' : 'night';

    var dn = $('dayNum');
    if (dn) dn.textContent = view.day || 1;

    var pn = $('phaseName');
    if (pn) pn.textContent = view.phase === 'day' ? '天亮了' : '天黑请闭眼';

    var gl = $('gameModeLabel');
    if (gl) gl.textContent = view.modeTitle || '';

    var alive = 0, total = (view.seats || []).length;
    (view.seats || []).forEach(function (s) { if (s.alive !== false) alive++; });
    var an = $('aliveNum'); if (an) an.textContent = alive;
    var at = $('aliveTotal'); if (at) at.textContent = total;

    var track = $('phaseTrack');
    if (track) {
      var list = STAGES[view.phase === 'day' ? 'day' : 'night'];
      var cur = view.stage || '';
      var curIdx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === cur) { curIdx = i; break; }
      if (curIdx < 0) curIdx = 0;   /* 未知阶段退回第一条，别让进度条空着 */
      track.innerHTML = list.map(function (s, idx) {
        var cls = '';
        if (curIdx >= 0 && idx < curIdx) cls = 'is-done';
        else if (idx === curIdx) cls = 'is-now';
        return '<li class="' + cls + '"><i></i><span>' + s.label + '</span></li>';
      }).join('');
    }

    var h = HUB[view.stage] || HUB[view.phase === 'day' ? 'day_announce' : 'night_idle'];
    var ht = $('hubTitle'); if (ht) ht.textContent = h.t;
    var hn = $('hubNote'); if (hn) hn.textContent = h.n;
  }

  /* ------------------------------------------------------------
     9. 对外接口
     ------------------------------------------------------------ */
  function setState(view) {
    if (!view) return;
    state = view;
    picked = 0;
    renderTop(view);
    renderSeats(view);
    renderIdCard(view);
    renderActions(view);
    renderLog(view, true);
  }

  function pushMessage(m) {
    var box = $('talkLog');
    if (!box || !m) return;
    var d = document.createElement('div');
    d.innerHTML = msgHTML(m);
    box.appendChild(d.firstChild);
    box.scrollTop = box.scrollHeight;
    if (state && state.log) state.log.push(m);
    logSeen = state && state.log ? state.log.length : logSeen + 1;
  }

  function setPhase(phase, opts) {
    opts = opts || {};
    var root = $('view-game');
    if (root) root.dataset.phase = phase === 'day' ? 'day' : 'night';
    if (document.body) document.body.dataset.phase = phase === 'day' ? 'day' : 'night';

    var curtain = $('phaseCurtain');
    var text = $('curtainText');
    if (curtain && text) {
      text.textContent = opts.text || (phase === 'day' ? '天亮了' : '天黑请闭眼');
      curtain.classList.add('is-on');
      clearTimeout(curtain._t);
      curtain._t = setTimeout(function () { curtain.classList.remove('is-on'); }, opts.hold || 900);
    }
  }

  /* ------------------------------------------------------------
     10. 预览数据
     ------------------------------------------------------------ */
  function demoView(modeId, phase, opts) {
    opts = opts || {};
    var mode = WWModes.byId(modeId) || WWModes.list()[0];
    var profile = WWStore.read();
    var deck = WWModes.deckOf(mode);

    var POOL = ['灰鳍', '铁锚', '夜莺', '青鳞', '老鲸', '银钩', '雾角', '沙丁',
                '礁石', '灯塔', '碎冰', '暖流'];
    var AV = WWAvatars.all().map(function (a) { return a.id; });

    var seats = [];
    for (var i = 0; i < mode.seats; i++) {
      var isSelf = i === 0;
      seats.push({
        seat: i + 1,
        name: isSelf ? (profile.name || '你') : POOL[i % POOL.length],
        avatarId: isSelf ? (profile.avatarId || 'fish') : AV[(i * 5 + 3) % AV.length],
        avatarData: isSelf ? (profile.avatarData || '') : '',
        alive: true,
        isSelf: isSelf,
        isAlly: false,
        voted: false
      });
    }

    var roleId = deck.indexOf('seer') >= 0 ? 'seer' : 'werewolf';
    var role = WWRoles[roleId];

    var isDay = phase === 'day';
    var isVote = phase === 'vote';

    var log = (isDay || isVote) ? [
      { kind: 'system', text: '第 1 天 · 天亮了' },
      { kind: 'death',  text: '昨晚 4 号「青鳞」倒在了自家门口。' },
      { kind: 'speech', seat: 2, name: seats[1].name, avatarId: seats[1].avatarId,
        text: '我昨晚听到三号那边有动静，说不清，但我第一轮先给他记一笔。' },
      { kind: 'speech', seat: 3, name: seats[2].name, avatarId: seats[2].avatarId,
        text: '二号这是凭空泼脏水。我是村民，没什么好藏的，你要投我就投。' },
      { kind: 'speech', seat: 5, name: seats[4].name, avatarId: seats[4].avatarId,
        text: '我倾向先看二号的逻辑。他说「有动静」但说不出所以然，很像是编的。' }
    ] : [
      { kind: 'system',  text: '第 1 夜 · 天黑请闭眼' },
      { kind: 'whisper', text: '你查验了 3 号「夜莺」，结果是好人。' }
    ];

    var actions;
    if (isVote) {
      actions = {
        kind: 'chips',
        title: '投票放逐',
        hint: '点左边的头像或下面的按钮',
        chips: seats.filter(function (s) { return !s.isSelf && s.alive; }).map(function (s) {
          return { id: 'vote-' + s.seat, label: s.seat + ' 号 ' + s.name, target: s.seat, count: 0 };
        })
      };
    } else if (isDay) {
      actions = {
        kind: 'speak',
        title: '轮到你发言',
        hint: '所有人可见'
      };
    } else if (opts.idle) {
      actions = { kind: 'idle', title: '夜间行动', hint: '仅你可见',
                  idle: '你今晚没有行动，等待其他人。' };
    } else {
      actions = {
        kind: 'chips',
        title: '请选择查验目标',
        hint: '仅你可见',
        chips: seats.filter(function (s) { return !s.isSelf; }).map(function (s) {
          return { id: 'check-' + s.seat, label: s.seat + ' 号 ' + s.name, target: s.seat };
        })
      };
    }

    return {
      modeId: mode.id,
      modeTitle: mode.title,
      day: 1,
      phase: isDay || isVote ? 'day' : 'night',
      stage: isVote ? 'day_vote' : (isDay ? 'day_speak' : 'night_seer'),
      selfSeat: 1,
      speakingSeat: isDay ? 4 : 0,
      seats: seats,
      role: { id: role.id, name: role.name, camp: role.camp },
      roleNotes: (isDay || isVote)
        ? ['3 号 夜莺 —— 好人']
        : ['解药 1 瓶 · 毒药 1 瓶'],
      log: log,
      actions: actions
    };
  }

  /* 发言框、投票确认、顶栏按钮都由 match.js 绑定（对局逻辑在那边），
     这里只管纯界面的交互。 */
  function mount() {
    bindIdChip();
  }

  global.WWGame = {
    mount: mount,
    setState: setState,
    pushMessage: pushMessage,
    setPhase: setPhase,
    showView: function (id) { if (global.WWShowView) global.WWShowView(id); },
    demoView: demoView,
    ROLE_DESC: ROLE_DESC
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(window);
