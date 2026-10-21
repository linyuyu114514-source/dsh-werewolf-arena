/* ============================================================
   大肥鱼狼人杀 · 本地存档（localStorage）
   ------------------------------------------------------------
   只存三样东西：玩家档案 / 上次选的模式 / 版本号。
   头像两种来源：
     avatarId = 内置头像 id（wolf / fish ...）
     avatarId = 'custom'，图片数据在 avatarData（dataURL）
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'ww.profile.v1';
  var NAME_MIN = 2;
  var NAME_MAX = 12;
  var CUSTOM = 'custom';
  var MAX_AVATAR_CHARS = 900 * 1024;   /* dataURL 字符上限，防止撑爆 localStorage */

  var DEFAULT = {
    version: 1,
    name: '',
    avatarId: '',
    avatarData: '',
    mode: '',
    /* 开局方式：normal=身份座位全随机；custom=自己指定身份与座位 */
    playMode: 'normal',
    pickSeat: 0,
    pickRole: '',
    createdAt: 0,
    updatedAt: 0
  };

  function now() { return Date.now(); }

  function read() {
    var raw;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return Object.assign({}, DEFAULT);
    var data;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') return Object.assign({}, DEFAULT);
    var avatarId = typeof data.avatarId === 'string' ? data.avatarId : '';
    var avatarData = typeof data.avatarData === 'string' ? data.avatarData : '';
    /* 自定义头像但数据丢了 → 退回内置头像，避免出现空白圆 */
    if (avatarId === CUSTOM && !avatarData) avatarId = '';
    return {
      version: 1,
      name: typeof data.name === 'string' ? data.name : '',
      avatarId: avatarId,
      avatarData: avatarId === CUSTOM ? avatarData : '',
      mode: typeof data.mode === 'string' ? data.mode : '',
      playMode: data.playMode === 'custom' ? 'custom' : 'normal',
      pickSeat: typeof data.pickSeat === 'number' ? data.pickSeat : 0,
      pickRole: typeof data.pickRole === 'string' ? data.pickRole : '',
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0
    };
  }

  function write(patch) {
    var cur = read();
    var next = Object.assign({}, cur, patch, { updatedAt: now() });
    if (!next.createdAt) next.createdAt = next.updatedAt;

    /* 换成内置头像时清掉自定义图，别把几 MB 垃圾留在存档里 */
    if (next.avatarId !== CUSTOM) next.avatarData = '';

    /* 存储配额满了就降级：丢掉自定义图并抛给调用方 */
    try {
      global.localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      next.avatarData = '';
      if (next.avatarId === CUSTOM) next.avatarId = '';
      try { global.localStorage.setItem(KEY, JSON.stringify(next)); } catch (e2) {}
      return next;
    }
    return next;
  }

  /* ---- 名称校验：返回 {ok, msg, name} ---- */
  function validateName(raw) {
    var name = String(raw == null ? '' : raw).trim();
    if (!name) return { ok: false, code: 'empty', msg: '先取个名字吧' };
    /* 用 Array.from 按字符数算，避免 emoji / 中文被算成两三个字符 */
    var len = Array.from(name).length;
    if (len < NAME_MIN) return { ok: false, code: 'short', msg: '名字至少 ' + NAME_MIN + ' 个字' };
    if (len > NAME_MAX) return { ok: false, code: 'long', msg: '名字最多 ' + NAME_MAX + ' 个字' };
    if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, code: 'ctrl', msg: '名字里不能有控制字符' };
    if (/[<>]/.test(name)) return { ok: false, code: 'angle', msg: '名字里不能有尖括号' };
    return { ok: true, code: 'ok', msg: '', name: name };
  }

  function hasProfile(p) {
    var data = p || read();
    return !!(data.name && data.avatarId);
  }

  global.WWStore = {
    KEY: KEY,
    NAME_MIN: NAME_MIN,
    NAME_MAX: NAME_MAX,
    CUSTOM: CUSTOM,
    MAX_AVATAR_CHARS: MAX_AVATAR_CHARS,
    read: read,
    write: write,
    validateName: validateName,
    hasProfile: hasProfile,
    clear: function () {
      try { global.localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})(window);
