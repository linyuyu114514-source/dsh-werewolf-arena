/* ============================================================
   大肥鱼狼人杀 · 身份卡（纯 SVG 绘制，无外部素材）
   ------------------------------------------------------------
   用法：
     WWRoleCards.card(roleId)   → 整张卡的 HTML 字符串
     WWRoleCards.art(roleId)    → 只要中间那幅画（200×200 viewBox）
     WWRoleCards.meta(roleId)   → { name, en, camp, campName, no, desc, tags }
   ============================================================ */
(function (global) {
  'use strict';

  var GLOW = 'rc-glow';

  /* ------------------------------------------------------------
     1. 六个角色的图形（viewBox 0 0 200 200）
        统一的类名语义：
          .rc-fill  实心主体（角色主色）
          .rc-line  描边线条（麦穗、裂纹、指针…）
          .rc-dark  挖空/阴影（眼睛、瓶内液体暗部）
          .rc-band  强调色带（帽带、腰带、宝石）
          .rc-glow  背后光晕
     ------------------------------------------------------------ */
  var ART = {

    /* ---- 村民：草帽 + 麦穗 ---- */
    villager:
      '<circle class="rc-glow" cx="100" cy="102" r="66"/>' +
      '<g class="rc-line">' +
        '<path d="M36 178 C42 152 44 128 39 106"/>' +
        '<path d="M39 106 l-11 -7 M41 124 l-12 -7 M43 142 l-12 -7 M45 160 l-12 -7"/>' +
      '</g>' +
      '<g class="rc-line">' +
        '<path d="M164 178 C158 152 156 128 161 106"/>' +
        '<path d="M161 106 l11 -7 M159 124 l12 -7 M157 142 l12 -7 M155 160 l12 -7"/>' +
      '</g>' +
      '<path class="rc-fill" d="M62 97 C62 64 76 46 100 46 C124 46 138 64 138 97 Z"/>' +
      '<ellipse class="rc-fill" cx="100" cy="99" rx="58" ry="13"/>' +
      '<rect class="rc-band" x="62" y="84" width="76" height="10" rx="5"/>' +
      '<path class="rc-fill" d="M64 198 C64 169 80 157 100 157 C120 157 136 169 136 198 Z"/>' +
      '<circle class="rc-fill" cx="100" cy="132" r="24"/>' +
      '<circle class="rc-dark" cx="92" cy="130" r="3.2"/>' +
      '<circle class="rc-dark" cx="108" cy="130" r="3.2"/>' +
      '<path class="rc-line" d="M92 143 Q100 149 108 143"/>',

    /* ---- 狼人：正面狼头 ---- */
    werewolf:
      '<circle class="rc-glow" cx="100" cy="100" r="66"/>' +
      '<path class="rc-fill" d="M100 32 L154 54 L172 112 Q172 168 100 190 Q28 168 28 112 L46 54 Z"/>' +
      '<path class="rc-fill" d="M46 54 L28 8 L80 34 Z"/>' +
      '<path class="rc-fill" d="M154 54 L172 8 L120 34 Z"/>' +
      '<path class="rc-dark" d="M64 96 L92 103 L64 118 Z"/>' +
      '<path class="rc-dark" d="M136 96 L108 103 L136 118 Z"/>' +
      '<path class="rc-dark" d="M100 140 L86 162 L100 176 L114 162 Z"/>' +
      '<path class="rc-line" d="M74 132 l16 8 M126 132 l-16 8"/>',

    /* ---- 预言家：星轨环绕的水晶球，球心一只睁开的眼 ---- */
    seer:
      '<circle class="rc-glow" cx="100" cy="94" r="66"/>' +
      /* 背后两条交叉星轨 */
      '<g class="rc-line">' +
        '<ellipse cx="100" cy="92" rx="78" ry="25" transform="rotate(-18 100 92)"/>' +
        '<ellipse cx="100" cy="92" rx="78" ry="25" transform="rotate(18 100 92)"/>' +
      '</g>' +
      /* 水晶球 */
      '<circle class="rc-fill" cx="100" cy="92" r="50"/>' +
      '<circle class="rc-dark" cx="100" cy="92" r="39"/>' +
      /* 球心里的眼睛 */
      '<path class="rc-line" d="M64 92 Q100 60 136 92 Q100 124 64 92 Z"/>' +
      '<circle class="rc-fill" cx="100" cy="92" r="15"/>' +
      '<circle class="rc-dark" cx="100" cy="92" r="6.5"/>' +
      '<circle class="rc-band" cx="94.5" cy="86.5" r="3.4"/>' +
      /* 球面高光 */
      '<path class="rc-line" d="M69 62 C59 74 55 86 56 96"/>' +
      /* 球内星点 */
      '<circle class="rc-fill" cx="76" cy="116" r="2.6"/>' +
      '<circle class="rc-fill" cx="126" cy="118" r="2"/>' +
      '<circle class="rc-fill" cx="120" cy="70" r="1.8"/>' +
      /* 托座 */
      '<path class="rc-fill" d="M78 140 L122 140 L116 160 L84 160 Z"/>' +
      '<path class="rc-line" d="M84 150 h32"/>' +
      '<path class="rc-dark" d="M100 144 l6.5 5.5 l-6.5 5.5 l-6.5 -5.5 Z"/>' +
      '<rect class="rc-band" x="66" y="160" width="68" height="14" rx="7"/>' +
      '<path class="rc-line" d="M76 167 h48"/>' +
      /* 四周的星符 */
      '<g class="rc-line">' +
        '<path d="M30 56 v12 M24 62 h12"/>' +
        '<path d="M172 72 v10 M167 77 h10"/>' +
        '<path d="M40 124 v9 M35.5 128.5 h9"/>' +
      '</g>' +
      '<circle class="rc-fill" cx="166" cy="44" r="3"/>' +
      '<circle class="rc-fill" cx="34" cy="98" r="2.4"/>' +
      '<circle class="rc-fill" cx="156" cy="132" r="2.8"/>',

    /* ---- 女巫：双色药水瓶（上解药、下毒药） ---- */
    witch:
      '<circle class="rc-glow" cx="100" cy="104" r="66"/>' +
      /* 瓶塞 */
      '<rect class="rc-band" x="80" y="22" width="40" height="15" rx="7"/>' +
      '<path class="rc-line" d="M84 30 h32"/>' +
      /* 瓶颈 */
      '<rect class="rc-fill" x="87" y="37" width="26" height="24" rx="5"/>' +
      '<path class="rc-line" d="M87 46 h26"/>' +
      /* 瓶身 */
      '<path class="rc-fill" d="M87 59 L113 59 L113 92 C152 107 160 142 149 164 C138 186 62 186 51 164 C40 142 48 107 87 92 Z"/>' +
      /* 上半：解药 */
      '<path class="rc-band" d="M87 59 L113 59 L113 92 C120 95 126 99 132 104 L68 104 C74 99 80 95 87 92 Z"/>' +
      /* 下半：毒药 */
      '<path class="rc-dark" d="M68 104 L132 104 C146 113 152 132 148 148 L52 148 C48 132 54 113 68 104 Z"/>' +
      /* 液面 */
      '<path class="rc-line" d="M68 104 L132 104"/>' +
      /* 气泡 */
      '<circle class="rc-band" cx="80" cy="126" r="6"/>' +
      '<circle class="rc-band" cx="114" cy="138" r="4.2"/>' +
      '<circle class="rc-band" cx="96" cy="146" r="3"/>' +
      /* 高光 */
      '<path class="rc-line" d="M60 118 C56 132 58 146 64 156"/>' +
      /* 瓶底的影子 */
      '<ellipse class="rc-line" cx="100" cy="176" rx="34" ry="6"/>' +
      /* 左右飘出的药气 */
      '<path class="rc-line" d="M26 66 q11 -9 22 0 q11 9 22 0"/>' +
      '<path class="rc-line" d="M130 54 q11 -9 22 0 q11 9 22 0"/>' +
      /* 星点 */
      '<path class="rc-line" d="M40 116 v10 M35 121 h10"/>' +
      '<path class="rc-line" d="M158 118 v8 M154 122 h8"/>' +
      '<circle class="rc-fill" cx="46" cy="88" r="3"/>' +
      '<circle class="rc-fill" cx="156" cy="92" r="2.6"/>',

    /* ---- 猎人：宽檐帽 + 羽饰 + 斜挎猎枪 ---- */
    hunter:
      '<circle class="rc-glow" cx="100" cy="100" r="66"/>' +
      /* 肩与躯干 */
      '<path class="rc-fill" d="M54 174 C54 134 74 120 100 120 C126 120 146 134 146 174 Z"/>' +
      /* 猎枪：斜挎在胸前 */
      '<g transform="rotate(-38 100 100)">' +
        '<rect class="rc-dark" x="44" y="95" width="126" height="10" rx="5"/>' +
        '<rect class="rc-fill" x="18" y="87" width="36" height="26" rx="8"/>' +
        '<rect class="rc-band" x="120" y="85" width="15" height="29" rx="4"/>' +
        '<rect class="rc-dark" x="150" y="97" width="20" height="6" rx="3"/>' +
      '</g>' +
      /* 帽檐与帽身 */
      '<ellipse class="rc-band" cx="100" cy="77" rx="54" ry="12"/>' +
      '<path class="rc-fill" d="M66 77 C66 46 80 29 100 29 C120 29 134 46 134 77 Z"/>' +
      '<rect class="rc-dark" x="66" y="65" width="68" height="9" rx="4.5"/>' +
      /* 羽饰 */
      '<path class="rc-band" d="M131 64 C146 44 153 22 148 9 C135 20 127 43 127 64 Z"/>' +
      '<path class="rc-line" d="M133 62 C140 48 145 32 147 16"/>' +
      /* 头与五官 */
      '<circle class="rc-fill" cx="100" cy="104" r="23"/>' +
      '<circle class="rc-dark" cx="91" cy="101" r="3.6"/>' +
      '<circle class="rc-dark" cx="109" cy="101" r="3.6"/>' +
      '<path class="rc-line" d="M92 113 Q100 118 108 113"/>' +
      /* 领口 */
      '<path class="rc-line" d="M79 124 L100 143 L121 124"/>' +
      /* 准星暗示：一道细环 */
      '<circle class="rc-line" cx="100" cy="100" r="70" opacity=".28"/>',

    /* ---- 守卫：交叉长矛 + 大盾 + 守夜灯 ---- */
    guard:
      '<circle class="rc-glow" cx="100" cy="100" r="68"/>' +
      /* 背后交叉的两根长矛 */
      '<g transform="rotate(33 100 100)">' +
        '<rect class="rc-dark" x="96" y="8" width="8" height="184" rx="4"/>' +
        '<path class="rc-band" d="M100 0 L111 26 L100 34 L89 26 Z"/>' +
      '</g>' +
      '<g transform="rotate(-33 100 100)">' +
        '<rect class="rc-dark" x="96" y="8" width="8" height="184" rx="4"/>' +
        '<path class="rc-band" d="M100 0 L111 26 L100 34 L89 26 Z"/>' +
      '</g>' +
      /* 盾牌：外壳 + 内衬 */
      '<path class="rc-fill" d="M100 34 L156 57 V104 Q156 154 100 178 Q44 154 44 104 V57 Z"/>' +
      '<path class="rc-dark" d="M100 50 L142 68 V103 Q142 143 100 163 Q58 143 58 103 V68 Z"/>' +
      /* 盾面中央的守夜灯：灯罩 + 灯身 + 火苗 */
      '<rect class="rc-band" x="86" y="64" width="28" height="8" rx="4"/>' +
      '<path class="rc-band" d="M88 72 L112 72 L106 104 L94 104 Z"/>' +
      '<path class="rc-fill" d="M100 80 C108 90 109 98 100 102 C91 98 92 90 100 80 Z"/>' +
      '<rect class="rc-dark" x="92" y="104" width="16" height="6" rx="3"/>' +
      /* 盾面两侧的守护之星 */
      '<path class="rc-band" d="M70 92 l4 9 l9 4 l-9 4 l-4 9 l-4 -9 l-9 -4 l9 -4 Z"/>' +
      '<path class="rc-band" d="M130 92 l4 9 l9 4 l-9 4 l-4 9 l-4 -9 l-9 -4 l9 -4 Z"/>' +
      /* 盾底细线 */
      '<path class="rc-line" d="M86 130 h28"/>' +
      /* 顶部月光弧，暗示守夜 */
      '<path class="rc-line" d="M74 24 C82 12 118 12 126 24" opacity=".45"/>'
  };

  /* ------------------------------------------------------------
     2. 角色元信息
     ------------------------------------------------------------ */
  var META = {
    villager: {
      name: '村民', en: 'VILLAGER', no: '02',
      desc: '没有特殊能力。白天靠听发言、盘逻辑，把狼人投出去。',
      tags: ['白天发言', '白天投票', '夜间无行动']
    },
    werewolf: {
      name: '狼人', en: 'WEREWOLF', no: '01',
      desc: '每晚与同伴共同选择一名玩家击杀。白天要隐藏身份，把怀疑引向别人。',
      tags: ['夜间刀人', '认识同伴', '白天伪装']
    },
    seer: {
      name: '预言家', en: 'SEER', no: '03',
      desc: '夜里最后一个行动，每晚可以查验一名玩家的身份，得知他是狼人还是好人。' +
            '结果只有你自己看得到，验过的人不用再验。白天要选时机把情报说出来。',
      tags: ['每晚验一人', '只认狼/好人', '最后行动']
    },
    witch: {
      name: '女巫', en: 'WITCH', no: '04',
      desc: '有一瓶解药和一瓶毒药，整局各只能用一次。夜里在狼人之后行动，' +
            '能看见今晚被刀的人；一晚只能用一瓶药，用了解药就跳过毒药。',
      tags: ['解药 ×1', '毒药 ×1', '一晚一瓶']
    },
    hunter: {
      name: '猎人', en: 'HUNTER', no: '05',
      desc: '平时和村民一样，白天靠发言和投票找狼。倒下时可以开枪带走一个人——' +
            '被狼刀、被女巫毒、被投票放逐都能开枪，整局只有一次机会。' +
            '开枪之后仍然可以留遗言，但被你打死的人没有遗言。',
      tags: ['倒下开枪', '被毒也能开', '仅一次']
    },
    guard: {
      name: '守卫', en: 'GUARD', no: '06',
      desc: '夜里第一个行动，每晚守护一名存活玩家，被守的人当晚不会被狼刀带走。可以守自己，但不能连续两晚守同一个人。如果守的人和女巫用解药救的人是同一个，同守同救一起失效，狼刀照样生效。',
      tags: ['可守自己', '不能连守', '同守同救失效']
    }
  };

  function meta(roleId) {
    var m = META[roleId];
    if (!m) m = { name: roleId || '未知', en: '', no: '--', desc: '', tags: [] };
    var camp = (global.WWRoles && global.WWRoles[roleId]) ? global.WWRoles[roleId].camp : 'good';
    return {
      id: roleId,
      name: m.name, en: m.en, no: m.no, desc: m.desc, tags: m.tags.slice(),
      camp: camp,
      campName: camp === 'wolf' ? '狼人阵营' : '好人阵营'
    };
  }

  function art(roleId) {
    return '<svg class="rc-svg" viewBox="0 0 200 200" aria-hidden="true">' +
      (ART[roleId] || ART.villager) + '</svg>';
  }

  /* ------------------------------------------------------------
     3. 整张卡
     ------------------------------------------------------------ */
  function card(roleId) {
    var m = meta(roleId);
    return '<div class="role-card" data-camp="' + m.camp + '" data-role="' + m.id + '">' +
      '<span class="rc-corner tl"></span><span class="rc-corner tr"></span>' +
      '<span class="rc-corner bl"></span><span class="rc-corner br"></span>' +
      '<div class="rc-head">' +
        '<span class="rc-camp">' + m.campName + '</span>' +
        '<span class="rc-no">NO.' + m.no + '</span>' +
      '</div>' +
      '<div class="rc-art">' + art(m.id) + '</div>' +
      '<div class="rc-body">' +
        '<h3 class="rc-name">' + m.name + '</h3>' +
        '<p class="rc-en">' + m.en + '</p>' +
        '<p class="rc-desc">' + m.desc + '</p>' +
      '</div>' +
      '<ul class="rc-tags">' +
        m.tags.map(function (t) { return '<li>' + t + '</li>'; }).join('') +
      '</ul>' +
    '</div>';
  }

  global.WWRoleCards = {
    card: card,
    art: art,
    meta: meta,
    ROLES: Object.keys(META)
  };
})(window);
