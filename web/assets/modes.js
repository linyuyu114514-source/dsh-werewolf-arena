/* ============================================================
   大肥鱼狼人杀 · 模式与角色定义（前端唯一数据源）
   ------------------------------------------------------------
   角色 ID 与后端规则引擎保持同名，后续接 DSH 时直接复用。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---- 角色 ---- */
  var ROLES = {
    werewolf: { id: 'werewolf', name: '狼人',   camp: 'wolf', short: '狼', color: '#a78bfa' },
    villager: { id: 'villager', name: '村民',   camp: 'good', short: '民', color: '#5eead4' },
    seer:     { id: 'seer',     name: '预言家', camp: 'good', short: '预', color: '#7dd3fc' },
    witch:    { id: 'witch',    name: '女巫',   camp: 'good', short: '巫', color: '#f0abfc' },
    hunter:   { id: 'hunter',   name: '猎人',   camp: 'good', short: '猎', color: '#fca5a5' },
    guard:    { id: 'guard',    name: '守卫',   camp: 'good', short: '守', color: '#fcd34d' }
  };

  /* ---- 三种模式：6 / 9 / 12 ---- */
  var MODES = [
    {
      id: 'mode6',
      seats: 6,
      name: '初夜',
      title: '6 人局 · 标准入门',
      desc: '两狼潜伏，一预言家一女巫。白天只有两轮发言空间，错一次就出局。',
      lineup: [['werewolf', 2], ['villager', 2], ['seer', 1], ['witch', 1]],
      tag: '推荐新手'
    },
    {
      id: 'mode9',
      seats: 9,
      name: '长夜',
      title: '9 人局 · 进阶博弈',
      desc: '三狼对三民，猎人入局。出局时能开枪带走一人，投票压力陡增。',
      lineup: [['werewolf', 3], ['villager', 3], ['seer', 1], ['witch', 1], ['hunter', 1]],
      tag: '经典配置'
    },
    {
      id: 'mode12',
      seats: 12,
      name: '永夜',
      title: '12 人局 · 完整对局',
      desc: '四狼四民，猎人守卫齐上。守卫与女巫的守护重叠规则决定整局节奏。',
      lineup: [['werewolf', 4], ['villager', 4], ['seer', 1], ['witch', 1], ['hunter', 1], ['guard', 1]],
      tag: '硬核'
    }
  ];

  function byId(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  /* 展开成逐个座位可用的角色序列（发牌时用） */
  function deckOf(mode) {
    var out = [];
    for (var i = 0; i < mode.lineup.length; i++) {
      var id = mode.lineup[i][0], n = mode.lineup[i][1];
      for (var k = 0; k < n; k++) out.push(id);
    }
    return out;
  }

  /* 狼 / 好人人数，用于卡片底部的势力条 */
  function campsOf(mode) {
    var wolf = 0, good = 0;
    for (var i = 0; i < mode.lineup.length; i++) {
      var r = ROLES[mode.lineup[i][0]];
      if (!r) continue;
      if (r.camp === 'wolf') wolf += mode.lineup[i][1];
      else good += mode.lineup[i][1];
    }
    return { wolf: wolf, good: good };
  }

  /* 该模式下「你之外」还有几个子代理要扮演 */
  function agentCount(mode) { return mode.seats - 1; }

  global.WWRoles = ROLES;
  global.WWModes = {
    list: function () { return MODES.slice(); },
    byId: byId,
    deckOf: deckOf,
    campsOf: campsOf,
    agentCount: agentCount
  };
})(window);
