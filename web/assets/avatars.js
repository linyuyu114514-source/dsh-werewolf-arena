/* ============================================================
   大肥鱼狼人杀 · 头像库（纯 SVG 绘制，无外部素材）
   ============================================================ */
(function (global) {
  'use strict';

  /* 每个字形在 100x100 坐标系内绘制
     {F} = 主体浅色   {D} = 细节深色 */
  var GLYPH = {
    wolf:
      '<path d="M50 16 L74 26 L82 52 Q82 74 50 88 Q18 74 18 52 L26 26 Z" fill="{F}"/>' +
      '<path d="M26 26 L18 10 L40 19 Z" fill="{F}"/>' +
      '<path d="M74 26 L82 10 L60 19 Z" fill="{F}"/>' +
      '<path d="M33 44 L45 47 L33 53 Z" fill="{D}"/>' +
      '<path d="M67 44 L55 47 L67 53 Z" fill="{D}"/>' +
      '<path d="M50 60 L43 70 L50 77 L57 70 Z" fill="{D}"/>',

    fox:
      '<path d="M50 20 L74 22 L80 50 Q80 74 50 86 Q20 74 20 50 L26 22 Z" fill="{F}"/>' +
      '<path d="M26 22 L13 5 L40 16 Z" fill="{F}"/>' +
      '<path d="M74 22 L87 5 L60 16 Z" fill="{F}"/>' +
      '<circle cx="38" cy="46" r="4" fill="{D}"/>' +
      '<circle cx="62" cy="46" r="4" fill="{D}"/>' +
      '<path d="M50 57 L42 70 L50 78 L58 70 Z" fill="{D}"/>',

    owl:
      '<ellipse cx="50" cy="58" rx="27" ry="30" fill="{F}"/>' +
      '<path d="M29 35 L22 15 L43 26 Z" fill="{F}"/>' +
      '<path d="M71 35 L78 15 L57 26 Z" fill="{F}"/>' +
      '<circle cx="39" cy="52" r="11" fill="{D}"/>' +
      '<circle cx="61" cy="52" r="11" fill="{D}"/>' +
      '<circle cx="39" cy="52" r="4.6" fill="{F}"/>' +
      '<circle cx="61" cy="52" r="4.6" fill="{F}"/>' +
      '<path d="M50 62 L44 73 L56 73 Z" fill="{D}"/>',

    cat:
      '<path d="M50 24 Q74 26 78 52 Q78 78 50 86 Q22 78 22 52 Q26 26 50 24 Z" fill="{F}"/>' +
      '<path d="M27 31 L20 11 L43 24 Z" fill="{F}"/>' +
      '<path d="M73 31 L80 11 L57 24 Z" fill="{F}"/>' +
      '<circle cx="38" cy="50" r="4" fill="{D}"/>' +
      '<circle cx="62" cy="50" r="4" fill="{D}"/>' +
      '<path d="M50 59 L45 65 L50 68 L55 65 Z" fill="{D}"/>' +
      '<path d="M40 66 L24 61 M41 71 L26 73 M60 66 L76 61 M59 71 L74 73" stroke="{D}" stroke-width="2" fill="none" stroke-linecap="round"/>',

    fish:
      '<path d="M24 52 Q38 26 62 33 Q78 39 83 52 Q78 65 62 71 Q38 78 24 52 Z" fill="{F}"/>' +
      '<path d="M24 52 L8 34 L8 70 Z" fill="{F}"/>' +
      '<circle cx="66" cy="47" r="4.6" fill="{D}"/>' +
      '<path d="M44 33 Q49 21 60 27" stroke="{D}" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M52 40 Q58 46 52 54" stroke="{D}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>',

    octopus:
      '<path d="M50 15 Q75 15 77 46 L77 55 Q64 60 50 60 Q36 60 23 55 L23 46 Q25 15 50 15 Z" fill="{F}"/>' +
      '<path d="M28 57 Q22 72 31 85" stroke="{F}" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M41 59 Q40 76 46 87" stroke="{F}" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M59 59 Q60 76 54 87" stroke="{F}" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M72 57 Q78 72 69 85" stroke="{F}" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<circle cx="40" cy="38" r="4.6" fill="{D}"/>' +
      '<circle cx="60" cy="38" r="4.6" fill="{D}"/>',

    deer:
      '<path d="M38 27 L29 8 M29 15 L18 12 M62 27 L71 8 M71 15 L82 12" stroke="{F}" stroke-width="4.4" fill="none" stroke-linecap="round"/>' +
      '<path d="M50 25 Q70 29 70 53 Q70 77 50 87 Q30 77 30 53 Q30 29 50 25 Z" fill="{F}"/>' +
      '<circle cx="39" cy="49" r="4" fill="{D}"/>' +
      '<circle cx="61" cy="49" r="4" fill="{D}"/>' +
      '<ellipse cx="50" cy="72" rx="7.5" ry="5.5" fill="{D}"/>',

    snake:
      '<path d="M27 78 Q27 57 50 57 Q73 57 73 41 Q73 26 52 26" stroke="{F}" stroke-width="11" fill="none" stroke-linecap="round"/>' +
      '<circle cx="52" cy="24" r="9.5" fill="{F}"/>' +
      '<circle cx="55" cy="21" r="2.8" fill="{D}"/>' +
      '<path d="M60 28 L71 31 M60 32 L70 37" stroke="{D}" stroke-width="2.4" stroke-linecap="round" fill="none"/>',

    raven:
      '<path d="M50 31 Q33 21 18 33 Q27 41 23 57 Q37 50 50 59 Q63 50 77 57 Q73 41 82 33 Q67 21 50 31 Z" fill="{F}"/>' +
      '<circle cx="50" cy="46" r="8.4" fill="{F}"/>' +
      '<circle cx="47" cy="45" r="2.2" fill="{D}"/>' +
      '<path d="M58 47 L70 50 L58 53 Z" fill="{F}"/>' +
      '<path d="M50 68 L46 84 L54 84 Z" fill="{F}"/>',

    butterfly:
      '<path d="M50 51 Q28 19 15 39 Q9 63 46 57 Z" fill="{F}"/>' +
      '<path d="M50 51 Q72 19 85 39 Q91 63 54 57 Z" fill="{F}"/>' +
      '<path d="M50 56 Q31 67 26 82 Q45 82 50 62 Z" fill="{F}"/>' +
      '<path d="M50 56 Q69 67 74 82 Q55 82 50 62 Z" fill="{F}"/>' +
      '<path d="M50 42 L50 84" stroke="{D}" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M50 42 Q44 32 38 29 M50 42 Q56 32 62 29" stroke="{D}" stroke-width="2.2" fill="none" stroke-linecap="round"/>',

    moon:
      '<path d="M50 8 A42 42 0 1 0 50 92 A34 34 0 1 1 50 8 Z" fill="{F}"/>' +
      '<path d="M76 26 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 Z" fill="{F}" opacity=".85"/>',

    flame:
      '<path d="M50 10 Q63 34 69 47 Q79 63 68 75 Q60 85 50 85 Q40 85 32 75 Q21 63 31 47 Q37 34 50 10 Z" fill="{F}"/>' +
      '<path d="M50 45 Q57 57 57 65 Q57 76 50 78 Q43 76 43 65 Q43 57 50 45 Z" fill="{D}"/>',

    eye:
      '<path d="M12 50 Q50 16 88 50 Q50 84 12 50 Z" fill="{F}"/>' +
      '<circle cx="50" cy="50" r="15" fill="{D}"/>' +
      '<circle cx="50" cy="50" r="6" fill="{F}"/>' +
      '<circle cx="55" cy="44" r="2.4" fill="{F}" opacity=".7"/>',

    skull:
      '<path d="M50 12 Q77 12 77 42 Q77 57 68 63 L68 74 Q68 83 59 83 L41 83 Q32 83 32 74 L32 63 Q23 57 23 42 Q23 12 50 12 Z" fill="{F}"/>' +
      '<ellipse cx="38" cy="43" rx="9" ry="10" fill="{D}"/>' +
      '<ellipse cx="62" cy="43" rx="9" ry="10" fill="{D}"/>' +
      '<path d="M50 55 L45.5 66 L54.5 66 Z" fill="{D}"/>' +
      '<path d="M41 72 L41 83 M50 72 L50 83 M59 72 L59 83" stroke="{D}" stroke-width="3"/>',

    rose:
      '<ellipse cx="50" cy="31" rx="12" ry="16" fill="{F}"/>' +
      '<ellipse cx="38" cy="41" rx="12" ry="16" transform="rotate(-52 38 41)" fill="{F}"/>' +
      '<ellipse cx="62" cy="41" rx="12" ry="16" transform="rotate(52 62 41)" fill="{F}"/>' +
      '<ellipse cx="42" cy="55" rx="11" ry="14" transform="rotate(-26 42 55)" fill="{F}"/>' +
      '<ellipse cx="58" cy="55" rx="11" ry="14" transform="rotate(26 58 55)" fill="{F}"/>' +
      '<circle cx="50" cy="45" r="8" fill="{D}"/>' +
      '<path d="M50 64 L50 89" stroke="{F}" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M50 75 Q67 71 71 81 Q56 85 50 79 Z" fill="{F}"/>',

    sword:
      '<path d="M50 6 L58 24 L58 61 L42 61 L42 24 Z" fill="{F}"/>' +
      '<path d="M50 13 L54 26 L54 57 L46 57 L46 26 Z" fill="{D}" opacity=".55"/>' +
      '<rect x="27" y="61" width="46" height="8" rx="4" fill="{F}"/>' +
      '<rect x="46" y="69" width="8" height="17" rx="4" fill="{F}"/>' +
      '<circle cx="50" cy="90" r="5" fill="{F}"/>',

    potion:
      '<rect x="39" y="9" width="22" height="9" rx="3.5" fill="{F}"/>' +
      '<path d="M42 18 L58 18 L58 33 Q74 41 74 58 Q74 83 50 83 Q26 83 26 58 Q26 41 42 33 Z" fill="{F}"/>' +
      '<path d="M31 58 Q50 51 69 58 Q69 78 50 78 Q31 78 31 58 Z" fill="{D}"/>' +
      '<circle cx="42" cy="66" r="3" fill="{F}" opacity=".8"/>' +
      '<circle cx="56" cy="70" r="2.2" fill="{F}" opacity=".6"/>',

    crown:
      '<path d="M21 70 L16 33 L36 48 L50 22 L64 48 L84 33 L79 70 Z" fill="{F}"/>' +
      '<rect x="21" y="74" width="58" height="9" rx="3.5" fill="{F}"/>' +
      '<circle cx="50" cy="60" r="4.4" fill="{D}"/>' +
      '<circle cx="32" cy="62" r="2.8" fill="{D}"/>' +
      '<circle cx="68" cy="62" r="2.8" fill="{D}"/>'
  };

  var LIST = [
    { id: 'wolf',      name: '暗夜狼',  bg: ['#6a4bd0', '#2a1a55'], fg: '#f0eaff', dk: '#1b1038' },
    { id: 'fox',       name: '赤面狐',  bg: ['#e07a3c', '#7a2f1c'], fg: '#fff2e2', dk: '#3a160c' },
    { id: 'owl',       name: '守夜枭',  bg: ['#2f8f92', '#123a4a'], fg: '#e2fbff', dk: '#0a2330' },
    { id: 'cat',       name: '巷口猫',  bg: ['#d0578a', '#5c1d42'], fg: '#ffe8f2', dk: '#330f24' },
    { id: 'fish',      name: '大肥鱼',  bg: ['#3b8ee0', '#123a6b'], fg: '#e6f3ff', dk: '#0a2342' },
    { id: 'octopus',   name: '深水章',  bg: ['#a845c9', '#41165c'], fg: '#f8e8ff', dk: '#260d38' },
    { id: 'deer',      name: '林间鹿',  bg: ['#5f9e5a', '#1e3d2a'], fg: '#eeffe8', dk: '#102416' },
    { id: 'snake',     name: '青鳞蛇',  bg: ['#3fa86b', '#123f2c'], fg: '#e4fff0', dk: '#0a2418' },
    { id: 'raven',     name: '夜鸦',    bg: ['#4a5680', '#1a1f33'], fg: '#e6ebff', dk: '#0e1120' },
    { id: 'butterfly', name: '暮蝶',    bg: ['#8b6ce0', '#31215c'], fg: '#f2ecff', dk: '#1d1238' },
    { id: 'moon',      name: '残月',    bg: ['#6f8fc4', '#22314f'], fg: '#f2f7ff', dk: '#141d2e' },
    { id: 'flame',     name: '烬火',    bg: ['#e2603a', '#5c1a12'], fg: '#fff0e2', dk: '#38100a' },
    { id: 'eye',       name: '窥视之眼', bg: ['#38a3b8', '#123a47'], fg: '#e2fbff', dk: '#0a232c' },
    { id: 'skull',     name: '旧骨',    bg: ['#8e96a8', '#2b3040'], fg: '#f4f6fb', dk: '#1a1e29' },
    { id: 'rose',      name: '血色蔷薇', bg: ['#d24a63', '#521423'], fg: '#ffe6ec', dk: '#2e0a13' },
    { id: 'sword',     name: '断罪之刃', bg: ['#7c8ba3', '#242b3a'], fg: '#eef2fa', dk: '#141922' },
    { id: 'potion',    name: '女巫药剂', bg: ['#38a97b', '#0f3b2c'], fg: '#e6fff4', dk: '#082219' },
    { id: 'crown',     name: '旧王冠',  bg: ['#d8a53a', '#5a3a0e'], fg: '#fff6dd', dk: '#33200a' }
  ];

  var MAP = {};
  for (var i = 0; i < LIST.length; i++) MAP[LIST[i].id] = LIST[i];

  function build(a) {
    var gid = 'av-' + a.id;
    return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + a.name + '">' +
      '<defs>' +
        '<linearGradient id="' + gid + '" x1="0.15" y1="0" x2="0.85" y2="1">' +
          '<stop offset="0" stop-color="' + a.bg[0] + '"/>' +
          '<stop offset="1" stop-color="' + a.bg[1] + '"/>' +
        '</linearGradient>' +
        '<radialGradient id="' + gid + '-hi" cx="0.3" cy="0.16" r="0.85">' +
          '<stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>' +
          '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<rect width="100" height="100" fill="url(#' + gid + ')"/>' +
      '<rect width="100" height="100" fill="url(#' + gid + '-hi)"/>' +
      '<g>' + GLYPH[a.id].split('{F}').join(a.fg).split('{D}').join(a.dk) + '</g>' +
      '<circle cx="50" cy="50" r="49" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>' +
    '</svg>';
  }

  function get(id) { return MAP[id] || LIST[0]; }
  function all() { return LIST.slice(); }
  function render(id) { return build(get(id)); }

/* ---- 统一出口：内置 SVG 或用户上传图 ---- */
  function renderProfile(profile) {
    var p = profile || {};
    if (p.avatarId === 'custom' && p.avatarData) {
      return '<img src="' + p.avatarData + '" alt="' + esc(p.name || '头像') + '">';
    }
    return render(p.avatarId);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.WWAvatars = { all: all, get: get, render: render, renderProfile: renderProfile };
})(window);
