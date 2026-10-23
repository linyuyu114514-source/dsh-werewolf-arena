/* ============================================================
   大肥鱼狼人杀 · AI 通道面板
   ------------------------------------------------------------
   首页「选一局」里让玩家挑这一局用哪个渠道、哪个模型。
   列表不写死：打开页面时、点「重新检测」时各问一次后端
   GET /api/providers，后端列的是「当前 DSH 接入的通道与模型」。

   选择存在 localStorage[ww.channel]，开局时由 bridge.js 取走，
   塞进 POST /api/match 的 body.channel。

   拿不到列表（后端没跑 / 接口还没就绪）不算致命：面板如实显示原因，
   页面其余部分照常，开局时后端用它自己的默认通道。
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'ww.channel';            /* localStorage 里存选择用的键 */
  var ENDPOINT = '/api/providers';   /* 同源部署，BASE 留空 */
  var OFFLINE = '连不上后端。请先在项目目录运行 node server/index.mjs，再用 http://127.0.0.1:8787 打开页面。';
  var NOFILE = '当前是直接打开的网页，连不上后端。请访问 http://127.0.0.1:8787';

  var state = {
    loaded: false,      /* 是否已经问过一次后端 */
    ok: false,          /* 后端说这次的通道列表能用吗 */
    providers: [],      /* 归一化后的通道数组 */
    current: null,      /* 后端报的「现在实际在用」的通道 */
    diagnostics: [],    /* 后端给的排查线索，原样显示 */
    listError: '',      /* 整份列表不可用时的原因（后端原文优先） */
    lastError: '',      /* 最近一次运行期错误（开局失败），换通道即清 */
    provider: '',       /* 玩家选中的通道 id */
    model: '',          /* 玩家选中的模型 id */
    reasoningEffort: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------
     1. 本地存档：读写只有这两个口子
     ------------------------------------------------------------ */
  function readSaved() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return null;
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') return null;
    var provider = typeof data.provider === 'string' ? data.provider : '';
    var model = typeof data.model === 'string' ? data.model : '';
    var effort = typeof data.reasoningEffort === 'string' && data.reasoningEffort
      ? data.reasoningEffort : null;
    if (!provider) return null;
    return { provider: provider, model: model, reasoningEffort: effort };
  }

  function save() {
    if (!state.provider) {
      try { global.localStorage.removeItem(KEY); } catch (e) {}
      return;
    }
    var data = { provider: state.provider, model: state.model || '' };
    if (state.reasoningEffort) data.reasoningEffort = state.reasoningEffort;
    try { global.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* ------------------------------------------------------------
     2. 后端数据归一化
     契约里 providers 是对象数组，但也把纯字符串数组收下来，
     免得后端先给个粗版接口就整个面板报废。
     ------------------------------------------------------------ */
  function normalizeProviders(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (p) {
      if (typeof p === 'string') {
        if (p) out.push({ id: p, label: p, kind: 'plugin', available: true, note: '', models: [] });
        return;
      }
      p = p || {};
      var id = String(p.id || '');
      if (!id) return;
      var models = [];
      if (Array.isArray(p.models)) {
        p.models.forEach(function (m) {
          if (typeof m === 'string') {
            if (m) models.push({ id: m, label: m, contextWindow: 0, efforts: [], defaultEffort: null });
            return;
          }
          m = m || {};
          var mid = String(m.id || '');
          if (!mid) return;
          models.push({
            id: mid,
            label: String(m.label || mid),
            contextWindow: Number(m.contextWindow) || 0,
            efforts: Array.isArray(m.efforts) ? m.efforts.map(String) : [],
            defaultEffort: typeof m.defaultEffort === 'string' && m.defaultEffort ? m.defaultEffort : null
          });
        });
      }
      out.push({
        id: id,
        label: String(p.label || id),
        kind: p.kind === 'official' ? 'official' : 'plugin',
        available: p.available !== false,
        note: String(p.note || ''),
        models: models
      });
    });
    return out;
  }

  function providerById(id) {
    if (!id) return null;
    for (var i = 0; i < state.providers.length; i++) {
      if (state.providers[i].id === id) return state.providers[i];
    }
    return null;
  }

  function modelById(p, id) {
    if (!p || !id) return null;
    for (var i = 0; i < p.models.length; i++) {
      if (p.models[i].id === id) return p.models[i];
    }
    return null;
  }

  function firstAvailable() {
    for (var i = 0; i < state.providers.length; i++) {
      if (state.providers[i].available) return state.providers[i];
    }
    return null;
  }

  /* ------------------------------------------------------------
     3. reasoning effort：拿不准就不带
     给模型塞它不支持的 effort，后端会直接报
     provider "X" model "Y" does not support reasoning effort "Z"。
     所以只认模型自己列出来的 efforts，没列就退回 defaultEffort，
     两者都没有就干脆不带这个字段。
     ------------------------------------------------------------ */
  function syncEffort(p, m) {
    var list = m && m.efforts && m.efforts.length ? m.efforts : null;
    if (!list) {
      state.reasoningEffort = (m && m.defaultEffort) || null;
      return;
    }
    if (state.reasoningEffort && list.indexOf(state.reasoningEffort) >= 0) return;
    state.reasoningEffort = (m && m.defaultEffort && list.indexOf(m.defaultEffort) >= 0)
      ? m.defaultEffort : null;
  }

  /* ------------------------------------------------------------
     4. 渲染
     ------------------------------------------------------------ */
  function addOption(sel, value, text, disabled, title) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    if (disabled) opt.disabled = true;
    if (title) opt.title = title;
    sel.appendChild(opt);
    return opt;
  }

  /* 选项文本 = 中文名 + 类型标记；后端的中文名自带说明就不再叠一层括号 */
  function providerText(p) {
    var label = p.label || p.id;
    if (label.indexOf('（') < 0 && label.indexOf('官方') < 0) {
      label += p.kind === 'official' ? '（官方账号）' : '（插件渠道）';
    }
    return p.available === false ? label + ' · 不可用' : label;
  }

  function modelText(m) { return m.label || m.id; }

  function reasonOf(p) { return (p && p.note) || '后端没有给出原因'; }

  function fillProviders() {
    var sel = $('channelProvider');
    if (!sel) return;
    sel.innerHTML = '';
    if (!state.providers.length) {
      sel.disabled = true;
      addOption(sel, '', state.ok ? '（后端还没接入任何通道）' : '（通道列表不可用）', true);
      return;
    }
    sel.disabled = false;
    state.providers.forEach(function (p) {
      addOption(sel, p.id, providerText(p), false);
    });
    sel.value = state.provider;
  }

  function fillModels() {
    var sel = $('channelModel');
    if (!sel) return;
    sel.innerHTML = '';
    var p = providerById(state.provider);
    var models = (p && p.models) || [];
    if (!models.length) {
      sel.disabled = true;
      addOption(sel, '', p ? '（该通道没有列出模型）' : '（先选一个通道）', true);
      return;
    }
    sel.disabled = false;
    models.forEach(function (m) {
      addOption(sel, m.id, modelText(m), false, m.contextWindow ? '上下文窗口 ' + m.contextWindow : '');
    });
    sel.value = state.model;
  }

  function paintStatus() {
    var el = $('channelStatus');
    var panel = $('channelPanel');
    if (!el) return;
    var text = '';
    var kind = 'idle';
    var p = providerById(state.provider);
    var m = p ? modelById(p, state.model) : null;

    if (state.lastError) {
      text = state.lastError;
      kind = 'bad';
    } else if (!state.loaded) {
      text = '正在检测可用通道…';
      kind = 'idle';
    } else if (!state.ok) {
      text = state.listError || '后端没有给出可用的 AI 通道';
      kind = 'bad';
    } else if (!p) {
      text = '还没有可选的通道';
      kind = 'bad';
    } else if (p.available === false) {
      text = '通道不可用：' + reasonOf(p);
      kind = 'bad';
    } else if (!m) {
      text = '当前通道：' + (p.label || p.id) + ' / 还没有可用模型';
      kind = 'bad';
    } else {
      text = '当前通道：' + (p.label || p.id) + ' / ' + m.id;
      if (state.reasoningEffort) text += '（推理强度 ' + state.reasoningEffort + '）';
      kind = 'good';
    }
    el.textContent = text;
    el.dataset.state = kind;
    if (panel) panel.dataset.state = kind;
  }

  function paintDiag() {
    var el = $('channelDiag');
    if (!el) return;
    if (state.diagnostics.length) {
      el.hidden = false;
      el.textContent = '后端诊断：' + state.diagnostics.join(' · ');
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function render() {
    fillProviders();
    fillModels();
    paintStatus();
    paintDiag();
  }

  /* ------------------------------------------------------------
     5. 选择 / 读取 / 上报
     ------------------------------------------------------------ */
  function pickProvider(id) {
    var p = providerById(id);
    if (!p) return;
    state.provider = p.id;
    state.model = p.models.length ? p.models[0].id : '';
    state.reasoningEffort = null;
    state.lastError = '';
    syncEffort(p, modelById(p, state.model));
    save();
    render();
  }

  function pickModel(id) {
    var p = providerById(state.provider);
    var m = modelById(p, id);
    if (!m) return;
    state.model = m.id;
    state.lastError = '';
    syncEffort(p, m);
    save();
    render();
  }

  /* bridge.js 开局时取这个：什么都没选就返回 null，让后端用它自己的默认通道 */
  function get() {
    var provider = state.provider;
    var model = state.model;
    var effort = state.reasoningEffort;
    if (!provider) {
      var saved = readSaved();
      if (!saved || !saved.provider) return null;
      provider = saved.provider;
      model = saved.model;
      effort = saved.reasoningEffort;
    }
    if (!provider) return null;
    var out = { provider: provider };
    if (model) out.model = model;
    if (effort) out.reasoningEffort = effort;
    return out;
  }

  /* bridge 开局失败时把后端原文交过来，面板与底部状态行如实显示（不美化） */
  function reportError(msg) {
    state.lastError = String(msg == null ? '' : msg);
    render();
    var el = $('backendNote');
    if (el) {
      el.hidden = false;
      el.dataset.state = 'bad';
      el.textContent = state.lastError;
    }
  }

  /* ------------------------------------------------------------
     6. 拉列表
     ------------------------------------------------------------ */
  function netMsg(msg) {
    if (!msg || /Failed to fetch|NetworkError|fetch failed|Load failed/i.test(msg)) return OFFLINE;
    return msg;
  }

  function fail(msg) {
    state.loaded = true;
    state.ok = false;
    state.providers = [];
    state.current = null;
    state.diagnostics = [];
    state.listError = msg;
    render();
    return state;
  }

  function apply(j) {
    state.loaded = true;
    state.ok = !!j.ok;
    state.providers = normalizeProviders(j.providers);
    state.current = j.current && j.current.provider ? j.current : null;
    state.diagnostics = Array.isArray(j.diagnostics) ? j.diagnostics.map(String) : [];
    if (state.ok) {
      state.listError = '';
    } else {
      state.listError = state.diagnostics.length ? state.diagnostics[0] : '后端没有给出可用的 AI 通道';
    }

    /* 默认选中：存档还在就用存档（选择要持久化）；否则用后端报的 current；
       再不然挑第一个能用的通道。 */
    if (!providerById(state.provider)) {
      var saved = readSaved();
      var want = '';
      if (saved && providerById(saved.provider)) want = saved.provider;
      if (!want && state.current && providerById(state.current.provider)) want = state.current.provider;
      if (!want) {
        var fa = firstAvailable();
        want = fa ? fa.id : (state.providers[0] ? state.providers[0].id : '');
      }
      state.provider = want;
      var p = providerById(want);
      var pickModelId = '';
      if (saved && saved.provider === want && modelById(p, saved.model)) pickModelId = saved.model;
      if (!pickModelId && state.current && state.current.provider === want &&
          modelById(p, state.current.model)) pickModelId = state.current.model;
      if (!pickModelId && p && p.models.length) pickModelId = p.models[0].id;
      state.model = pickModelId;
      var keepEffort = saved && saved.provider === want && saved.model === state.model
        ? saved.reasoningEffort : null;
      if (!keepEffort && state.current && state.current.provider === want &&
          state.current.model === state.model) keepEffort = state.current.reasoningEffort || null;
      state.reasoningEffort = keepEffort;
    }
    var cur = providerById(state.provider);
    syncEffort(cur, modelById(cur, state.model));
    render();
    return state;
  }

  function load(force) {
    state.lastError = '';
    if (global.location && global.location.protocol === 'file:') return Promise.resolve(fail(NOFILE));
    if (!state.loaded) paintStatus();
    var url = ENDPOINT + '?t=' + Date.now();
    return fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        return r.text().then(function (body) {
          var j = null;
          try { j = JSON.parse(body); } catch (e) { j = null; }
          if (!j) throw new Error('后端 ' + url + ' 没返回 JSON（HTTP ' + r.status + '）');
          if (!r.ok) throw new Error('后端 ' + url + ' 返回 HTTP ' + r.status);
          return j;
        });
      })
      .then(function (j) { return apply(j); }, function (e) {
        return fail(netMsg(e && e.message));
      });
  }

  /* ------------------------------------------------------------
     7. 绑定与启动
     ------------------------------------------------------------ */
  function bind() {
    var ps = $('channelProvider');
    if (ps) ps.addEventListener('change', function (e) {
      pickProvider(e && e.target ? e.target.value : ps.value);
    });
    var ms = $('channelModel');
    if (ms) ms.addEventListener('change', function (e) {
      pickModel(e && e.target ? e.target.value : ms.value);
    });
    var rf = $('channelRefresh');
    if (rf) rf.addEventListener('click', function () {
      if (!state.loaded) paintStatus();
      rf.disabled = true;
      load(true).then(function () { rf.disabled = false; }, function () { rf.disabled = false; });
    });

    /* ok:false 时不能让「开始游戏」看着像没反应：点下去先如实说一句。
       这一局仍然交给后端按它的默认通道开，真开不起来再由 bridge 报原始错误。 */
    var start = $('startGame');
    if (start) start.addEventListener('click', function () {
      if (state.loaded && !state.ok) {
        var el = $('backendNote');
        if (el) {
          el.hidden = false;
          el.dataset.state = 'bad';
          el.textContent = 'AI 通道列表不可用：' + (state.listError || '后端没有给出原因') +
            '（这一局按后端默认通道开局）';
        }
      }
    });
  }

  function boot() {
    bind();
    load(false);
  }

  global.WWChannel = {
    KEY: KEY,
    get: get,
    refresh: function () { return load(true); },
    reportError: reportError,
    state: function () { return state; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
