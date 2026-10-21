/* ============================================================
   大肥鱼狼人杀 · 大厅逻辑
   ------------------------------------------------------------
   当前只覆盖两个视图：
     view-create  创建档案（名字 + 头像）
     view-modes   模式选择
   全部跑在前端，localStorage 存档，无网络依赖。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------
     1. 星空背景（随机撒点，一次性生成）
     ------------------------------------------------------------ */
  function buildStars() {
    var host = $('stars');
    if (!host) return;
    var n = 120;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var s = document.createElement('i');
      var size = Math.random() < 0.82 ? 1 : (Math.random() < 0.7 ? 2 : 3);
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 100).toFixed(2) + '%';
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.setProperty('--d', (2.6 + Math.random() * 4).toFixed(2) + 's');
      s.style.setProperty('--delay', (Math.random() * 5).toFixed(2) + 's');
      s.style.opacity = (0.12 + Math.random() * 0.5).toFixed(2);
      frag.appendChild(s);
    }
    host.appendChild(frag);
  }

  /* ------------------------------------------------------------
     2. 提示条
     ------------------------------------------------------------ */
  var toastTimer = 0;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2000);
  }
  window.WWToast = toast;

  /* ------------------------------------------------------------
     3. 视图切换
     ------------------------------------------------------------ */
  var VIEWS = ['view-create', 'view-modes', 'view-game'];
  function showView(id) {
    VIEWS.forEach(function (v) {
      var el = $(v);
      if (!el) return;
      el.classList.toggle('is-active', v === id);
    });
    /* 局内视图占满屏宽，大厅保持居中窄栏 */
    var app = $('app');
    if (app) app.classList.toggle('is-game', id === 'view-game');
    if (id !== 'view-game' && document.body) document.body.dataset.phase = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.WWShowView = showView;

  /* ------------------------------------------------------------
     4. 创建视图：头像网格
     ------------------------------------------------------------ */
  var draft = {
    name: '',
    avatarId: '',
    avatarData: ''
  };

  function paintPreview() {
    var box = $('avatarPreview');
    var label = $('avatarName');
    if (box) box.innerHTML = WWAvatars.renderProfile(draft);
    if (label) {
      label.textContent = draft.avatarId === WWStore.CUSTOM
        ? '自定义头像'
        : WWAvatars.get(draft.avatarId).name;
    }
  }

  function buildAvatarGrid() {
    var grid = $('avatarGrid');
    if (!grid) return;
    var list = WWAvatars.all();
    var frag = document.createDocumentFragment();

    /* --- 上传格：永远排第一，带虚线加号 --- */
    var upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'avatar-cell';
    upBtn.dataset.upload = '1';
    upBtn.dataset.avatarId = WWStore.CUSTOM;
    upBtn.setAttribute('role', 'radio');
    upBtn.setAttribute('aria-checked', 'false');
    upBtn.setAttribute('aria-label', '上传自己的头像');
    upBtn.title = '上传自己的头像';
    upBtn.innerHTML = '<span class="cell-inner">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 5v14M5 12h14"/>' +
      '</svg></span>';
    upBtn.addEventListener('click', function () { pickCustomAvatar(); });
    frag.appendChild(upBtn);

    list.forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-cell';
      btn.dataset.avatarId = a.id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.setAttribute('aria-label', a.name);
      btn.title = a.name;

      var inner = document.createElement('span');
      inner.className = 'cell-inner';
      inner.innerHTML = WWAvatars.render(a.id);
      btn.appendChild(inner);

      btn.addEventListener('click', function () {
        draft.avatarId = a.id;
        draft.avatarData = '';
        syncAvatarActive();
        paintPreview();
        refreshConfirm();
      });

      frag.appendChild(btn);
    });

    grid.appendChild(frag);
  }

  /* --- 打开系统选图 → 裁剪 → 写回草稿 --- */
  function pickCustomAvatar() {
    WWCrop.pick(function (dataURL) {
      if (!dataURL) return;
      if (dataURL.length > WWStore.MAX_AVATAR_CHARS) {
        toast('裁剪后的图还是太大，换一张试试');
        return;
      }
      draft.avatarId = WWStore.CUSTOM;
      draft.avatarData = dataURL;
      syncAvatarActive();
      paintPreview();
      refreshConfirm();
      toast('头像已就位，别忘了点确定');
    });
  }

  function syncAvatarActive() {
    var cells = $('avatarGrid').querySelectorAll('.avatar-cell');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var on = cell.dataset.avatarId === draft.avatarId;
      cell.classList.toggle('is-active', on);
      cell.setAttribute('aria-checked', on ? 'true' : 'false');

      /* 上传格：选了自定义图就显示缩略图，否则回到加号 */
      if (cell.dataset.upload) {
        var inner = cell.querySelector('.cell-inner');
        if (draft.avatarId === WWStore.CUSTOM && draft.avatarData) {
          inner.innerHTML = '<img src="' + draft.avatarData + '" alt="自定义头像">' +
            '<svg class="cell-edit" viewBox="0 0 24 24" aria-hidden="true">' +
              '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>' +
            '</svg>';
        } else {
          inner.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 5v14M5 12h14"/></svg>';
        }
      }
    }
  }

  /* ------------------------------------------------------------
     5. 创建视图：名字输入与校验
     ------------------------------------------------------------ */
  function refreshNameHint() {
    var input = $('nameInput');
    var hint = $('nameHint');
    if (!input || !hint) return;
    var len = Array.from(input.value.trim()).length;
    hint.textContent = len + ' / ' + WWStore.NAME_MAX;
    hint.style.color = len > WWStore.NAME_MAX ? '#e6546a' : '';
  }

  function refreshConfirm() {
    var input = $('nameInput');
    var btn = $('confirmProfile');
    if (!input || !btn) return;
    var v = WWStore.validateName(input.value);
    var ok = v.ok && !!draft.avatarId;
    btn.disabled = !ok;
    btn.textContent = draft.avatarId ? '进入牌桌' : '先选个头像';
  }

  /* 随机名字：形容词 + 名词，两段拼起来 */
  var NAME_A = ['沉默的', '迟到的', '夜行的', '多疑的', '热心的', '半睡的', '爱笑的', '嘴硬的',
                '谨慎的', '暴躁的', '安静的', '冒失的', '认真的', '迷糊的', '守时的', '话多的'];
  var NAME_B = ['渔夫', '面包师', '钟表匠', '守夜人', '邮差', '铁匠', '药剂师', '裁缝',
                '牧羊人', '图书员', '车夫', '园丁', '水手', '棋手', '木匠', '船医'];

  function randomName() {
    var a = NAME_A[Math.floor(Math.random() * NAME_A.length)];
    var b = NAME_B[Math.floor(Math.random() * NAME_B.length)];
    var input = $('nameInput');
    input.value = a + b;
    refreshNameHint();
    refreshConfirm();
  }

  /* ------------------------------------------------------------
     6. 模式视图
     ------------------------------------------------------------ */
  var ROLE_ICON = {
    werewolf: '<path d="M12 3 L20 6 L22 13 Q22 20 12 23 Q2 20 2 13 L4 6 Z" fill="currentColor" opacity=".9"/>',
    villager: '<circle cx="12" cy="8" r="4" fill="currentColor" opacity=".9"/><path d="M4 22 Q4 14 12 14 Q20 14 20 22 Z" fill="currentColor" opacity=".9"/>',
    seer:     '<path d="M1 12 Q12 3 23 12 Q12 21 1 12 Z" fill="currentColor" opacity=".9"/><circle cx="12" cy="12" r="4" fill="#0a0f1a"/>',
    witch:    '<rect x="8" y="2" width="8" height="3" rx="1" fill="currentColor" opacity=".9"/><path d="M9 5 L15 5 L15 9 Q21 12 21 17 Q21 23 12 23 Q3 23 3 17 Q3 12 9 9 Z" fill="currentColor" opacity=".9"/>',
    hunter:   '<path d="M12 2 L14 9 L21 9 L15 13 L17 21 L12 16 L7 21 L9 13 L3 9 L10 9 Z" fill="currentColor" opacity=".9"/>',
    guard:    '<path d="M12 2 L21 6 V13 Q21 20 12 23 Q3 20 3 13 V6 Z" fill="currentColor" opacity=".9"/><path d="M12 7 L14 11 L18 11 L15 14 L16 18 L12 15 L8 18 L9 14 L6 11 L10 11 Z" fill="#0a0f1a"/>'
  };

  function roleIcon(id) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ROLE_ICON[id] || '') + '</svg>';
  }

  var selectedMode = '';

  function buildModeGrid() {
    var grid = $('modeGrid');
    if (!grid) return;
    var frag = document.createDocumentFragment();

    WWModes.list().forEach(function (m) {
      var camps = WWModes.campsOf(m);
      var total = camps.wolf + camps.good;
      var wolfPct = (camps.wolf / total * 100).toFixed(2);
      var goodPct = (100 - wolfPct).toFixed(2);

      var chips = m.lineup.map(function (pair) {
        var role = WWRoles[pair[0]];
        return '<span class="role-chip" data-camp="' + role.camp + '">' +
                 roleIcon(role.id) +
                 '<span>' + role.name + '</span>' +
                 '<b>×' + pair[1] + '</b>' +
               '</span>';
      }).join('');

      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      card.dataset.modeId = m.id;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', 'false');
      card.setAttribute('aria-label', m.title + '，共 ' + m.seats + ' 人');

      card.innerHTML =
        '<span class="mode-check" aria-hidden="true">✓</span>' +
        '<span class="mode-seats"><b>' + m.seats + '</b><span>人局</span></span>' +
        '<h3 class="mode-title">' + m.title + '</h3>' +
        '<p class="mode-desc">' + m.desc + '</p>' +
        '<span class="mode-roles">' + chips + '</span>' +
        '<span class="camp-bar" aria-hidden="true">' +
          '<i class="wolf" style="width:' + wolfPct + '%"></i>' +
          '<i class="good" style="width:' + goodPct + '%"></i>' +
        '</span>';

      card.addEventListener('click', function () { selectMode(m.id); });
      frag.appendChild(card);
    });

    grid.appendChild(frag);
  }

  function selectMode(id) {
    selectedMode = id;
    var cards = $('modeGrid').querySelectorAll('.mode-card');
    for (var i = 0; i < cards.length; i++) {
      var on = cards[i].dataset.modeId === id;
      cards[i].classList.toggle('is-active', on);
      cards[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var m = WWModes.byId(id);
    var btn = $('startGame');
    var note = $('modeNote');
    if (btn) btn.disabled = false;
    if (note && m) {
      note.textContent = '你 + ' + WWModes.agentCount(m) + ' 名子代理 · 共 ' + m.seats + ' 人';
    }
    WWStore.write({ mode: id });
    buildCustomPanel();
  }

  /* ------------------------------------------------------------
      6b. 开局方式（普通 / 自选）
     ------------------------------------------------------------ */
  var playMode = 'normal';
  var pickRole = '';
  var pickSeat = 0;

  function modeOf(id) { return WWModes.byId(id) || WWModes.list()[0]; }

  /* 自选身份候选：只列这个模式下真实存在的身份 */
  function roleChoices(m) {
    var out = [];
    m.lineup.forEach(function (pair) {
      if (out.indexOf(pair[0]) < 0) out.push(pair[0]);
    });
    return out;
  }

  function paintPlayMode() {
    var sw = $('pmSwitch');
    if (sw) {
      sw.querySelectorAll('.pm-opt').forEach(function (b) {
        var on = b.dataset.playmode === playMode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    var panel = $('customPanel');
    if (panel) panel.hidden = playMode !== 'custom';
    var note = $('pmNote');
    if (note) {
      note.textContent = playMode === 'custom'
        ? '身份和座位由你指定，其他玩家仍然随机。'
        : '身份和座位全部随机发放。';
    }
    /* 自选面板的内容跟当前模式绑定，切到自选就立刻铺一次 */
    if (playMode === 'custom') buildCustomPanel();
  }

  function buildCustomPanel() {
    var m = modeOf(selectedMode || WWStore.read().mode);
    var roles = roleChoices(m);
    if (roles.indexOf(pickRole) < 0) pickRole = roles[0] || '';

    var box = $('cpRoles');
    if (box) {
      box.innerHTML = roles.map(function (rid) {
        var r = WWRoles[rid];
        var n = 0;
        m.lineup.forEach(function (pair) { if (pair[0] === rid) n = pair[1]; });
        var on = rid === pickRole ? ' is-on' : '';
        return '<button type="button" class="cp-role' + on + '"' +
          ' data-role-id="' + rid + '" role="radio"' +
          ' aria-checked="' + (rid === pickRole ? 'true' : 'false') + '"' +
          ' data-camp="' + r.camp + '">' +
            roleIcon(rid) +
            '<span>' + r.name + '</span>' +
            '<b>×' + n + '</b>' +
          '</button>';
      }).join('');
    }

    var seats = $('cpSeats');
    if (seats) {
      if (!(pickSeat >= 1 && pickSeat <= m.seats)) pickSeat = 1;
      var html = '';
      for (var i = 1; i <= m.seats; i++) {
        var on2 = i === pickSeat ? ' is-on' : '';
        html += '<button type="button" class="cp-seat' + on2 + '"' +
          ' data-seat-no="' + i + '" role="radio"' +
          ' aria-checked="' + (i === pickSeat ? 'true' : 'false') + '">' + i + '</button>';
      }
      seats.innerHTML = html;
    }
  }

  function setPlayMode(mode) {
    playMode = mode === 'custom' ? 'custom' : 'normal';
    WWStore.write({ playMode: playMode });
    paintPlayMode();
    if (playMode === 'custom') buildCustomPanel();
  }

  function setPickRole(rid) {
    pickRole = rid;
    WWStore.write({ pickRole: rid });
    buildCustomPanel();
  }

  function setPickSeat(no) {
    pickSeat = Number(no) || 1;
    WWStore.write({ pickSeat: pickSeat });
    buildCustomPanel();
  }

  /* ------------------------------------------------------------
     7. 顶栏身份
     ------------------------------------------------------------ */
  function paintMe(profile) {
    var av = $('meAvatar');
    var nm = $('meName');
    if (av) av.innerHTML = WWAvatars.renderProfile(profile);
    if (nm) nm.textContent = profile.name;
  }

  /* ------------------------------------------------------------
     8. 启动
     ------------------------------------------------------------ */
  function enterModes(profile) {
    paintMe(profile);
    showView('view-modes');
  }

  function enterCreate(profile) {
    draft.name = profile.name || '';
    draft.avatarId = profile.avatarId || WWAvatars.all()[0].id;
    draft.avatarData = profile.avatarData || '';

    var input = $('nameInput');
    if (input) input.value = draft.name;

    paintPreview();
    syncAvatarActive();
    refreshNameHint();
    refreshConfirm();
    showView('view-create');
  }

  function bind() {
    var input = $('nameInput');
    if (input) {
      input.addEventListener('input', function () {
        refreshNameHint();
        refreshConfirm();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !$('confirmProfile').disabled) {
          e.preventDefault();
          $('confirmProfile').click();
        }
      });
    }

    var rnd = $('randomName');
    if (rnd) rnd.addEventListener('click', randomName);

    var confirmBtn = $('confirmProfile');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var v = WWStore.validateName($('nameInput').value);
        if (!v.ok) { toast(v.msg); return; }
        if (!draft.avatarId) { toast('先选个头像'); return; }
        var saved = WWStore.write({
          name: v.name,
          avatarId: draft.avatarId,
          avatarData: draft.avatarData
        });
        if (!saved.avatarId) {
          toast('浏览器存不下这张图，已换回内置头像');
        } else {
          toast('已保存，' + v.name);
        }
        enterModes(saved);
      });
    }

    var editBtn = $('editProfile');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        enterCreate(WWStore.read());
      });
    }

    /* 开局方式切换 */
    var sw = $('pmSwitch');
    if (sw) sw.addEventListener('click', function (e) {
      var b = e.target.closest('.pm-opt');
      if (!b) return;
      setPlayMode(b.dataset.playmode);
    });

    /* 自选面板：身份 / 座位（用事件委托，面板会被重建） */
    var roleBox = $('cpRoles');
    if (roleBox) roleBox.addEventListener('click', function (e) {
      var b = e.target.closest('.cp-role');
      if (b) setPickRole(b.dataset.roleId);
    });
    var seatBox = $('cpSeats');
    if (seatBox) seatBox.addEventListener('click', function (e) {
      var b = e.target.closest('.cp-seat');
      if (b) setPickSeat(b.dataset.seatNo);
    });

    var startBtn = $('startGame');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        var m = WWModes.byId(selectedMode);
        if (!m) { toast('先选一个模式'); return; }
        if (playMode === 'custom') {
          /* 自选：把自己的身份和座位钉死，其他座位照常随机 */
          var roles = roleChoices(m);
          var rid = roles.indexOf(pickRole) >= 0 ? pickRole : roles[0];
          var seat = (pickSeat >= 1 && pickSeat <= m.seats) ? pickSeat : 1;
          WWMatch.start(m.id, { selfSeat: seat, selfRole: rid });
        } else {
          /* 普通：身份座位全随机 */
          WWMatch.start(m.id);
        }
      });
    }
  }

  /* 模式选择页底部那行小字：告诉用户后端有没有就位 */
  function paintBackendNote() {
    var el = $('backendNote');
    if (!el) return;
    var br = window.WWDshBridge;
    if (br && br.fileProtocol && br.fileProtocol()) {
      el.hidden = false;
      el.dataset.state = 'bad';
      el.textContent = '当前是直接打开的网页，连不到子代理。请在项目目录运行 node server/index.mjs，然后访问 http://127.0.0.1:8787';
      return;
    }
    if (!br || !br.probe) { el.hidden = true; return; }
    br.probe().then(function (info) {
      el.hidden = false;
      if (info && info.dsh) {
        el.dataset.state = 'good';
        el.textContent = info.auth === 'api-key'
          ? '子代理就绪：API Key 通道'
          : '子代理就绪：DeepSeek Harness 已连接';
      } else {
        el.dataset.state = 'bad';
        el.textContent = (info && info.diagnosis) || '后端在跑，但子代理起不来';
      }
    }, function () {
      el.hidden = false;
      el.dataset.state = 'bad';
      el.textContent = '连不上后端。请先运行 node server/index.mjs，再访问 http://127.0.0.1:8787';
    });
  }

  function boot() {
    buildStars();
    buildAvatarGrid();
    buildModeGrid();
    bind();
    paintBackendNote();

    var profile = WWStore.read();
    playMode = profile.playMode === 'custom' ? 'custom' : 'normal';
    pickRole = profile.pickRole || '';
    pickSeat = Number(profile.pickSeat) || 0;
    paintPlayMode();

    if (WWStore.hasProfile(profile)) {
      enterModes(profile);
      if (profile.mode && WWModes.byId(profile.mode)) selectMode(profile.mode);
    } else {
      enterCreate(profile);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();