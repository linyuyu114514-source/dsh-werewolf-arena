/* 浏览器和后端之间的桥。
   只有三件事：开局建对局、每个子代理行动问一次、局末释放。

   注意这里**只发 req**。req 是规则引擎按 visibleTo 过滤好的那个座位视角，
   后端拿到的就是那个子代理该看到的全部信息——桥不额外附带任何东西。

   子代理迟迟不回应怎么办？
   不兜底、不假装它说话了——超时就直接报错，交给上层中止本局。
   糊弄过去只会让人看到一堆「……」，那还不如明说卡住了。 */
(function (global) {
  'use strict';

  var BASE = '';            /* 同源部署，留空 */
  var TIMEOUT_MS = 50000;   /* 单次行动等这么久还没回应就判失败（后端自己 2×18 秒就会先报错） */
  
  var matchId = null;
  var starting = null;      /* Promise：开局中 */
  var failed = false;
  var onFail = null;        /* 出错时通知上层的回调 */
  var queue = [];           /* 开局没完成就来的 ask 先排队 */

  /* 后端根本没在跑时的提示，比 "Failed to fetch" 有用得多 */
  var OFFLINE = '连不上后端。请先在项目目录运行 node server/index.mjs，再用 http://127.0.0.1:8787 打开页面。';

  /* 双击 index.html 用 file:// 打开时，页面里的 fetch 发不到后端去——
     这种情况必须一眼看出来，否则只会显示成「子代理没起来」。 */
  function fileProtocol() {
    return typeof location !== 'undefined' && location.protocol === 'file:';
  }

  function api(path, body) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).catch(function () {
      throw new Error(OFFLINE);
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      }, function () {
        throw new Error('后端返回的不是 JSON（HTTP ' + r.status + '）');
      });
    });
  }

  /* 后端在不在 */
  function probe() {
    return fetch(BASE + '/api/health').then(function (r) { return r.json(); });
  }

  function live() {
    return !!matchId && !failed;
  }

  /* 出事了：置失败位，通知上层中止本局。只报第一次，后面不重复弹 */
  function boom(msg) {
    if (failed) return;
    failed = true;
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) q[i].cb(null);
    if (onFail) onFail(msg);
    else if (global.WWToast) WWToast(msg);
  }

  /* 开局：把子代理的座位表交给后端，后端起一个 DSH 子进程 */
  function open(engine, fail) {
    matchId = null;
    failed = false;
    starting = null;
    queue = [];
    onFail = fail || null;
    if (!engine || !engine.seats) return Promise.resolve(null);

    if (fileProtocol()) {
      boom('页面是用 file:// 打开的，连不到后端。请运行 node server/index.mjs，然后访问 http://127.0.0.1:8787');
      return Promise.resolve(null);
    }

    var seats = engine.seats
      .filter(function (s) { return !s.isSelf; })
      .map(function (s) { return { seat: s.seat, name: s.name }; });
    if (!seats.length) return Promise.resolve(null);

    starting = api('/api/match', { seats: seats }).then(function (j) {
      matchId = j.matchId;
      /* 排队的请求放出去 */
      var q = queue; queue = [];
      for (var i = 0; i < q.length; i++) send(q[i]);
      if (global.WWToast) WWToast('子代理已就位（' + seats.length + ' 名）');
      return matchId;
    }).catch(function (e) {
      starting = null;
      boom('子代理没起来：' + e.message);
      return null;
    });
    return starting;
  }

  function send(item) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      boom('子代理超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没有回应');
    }, TIMEOUT_MS);

    api('/api/match/' + matchId + '/ask', { req: item.req }).then(function (j) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      item.cb(j && j.payload != null ? j.payload : null);
    }).catch(function (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      boom('子代理出错：' + e.message);
    });
  }

  /* 让某个座位的子代理做决定。cb 收到 null 表示它明确什么都没做（合法） */
  function ask(req, cb) {
    if (failed) { cb(null); return; }
    if (!matchId) {
      if (!starting) { cb(null); return; }
      queue.push({ req: req, cb: cb });
      return;
    }
    send({ req: req, cb: cb });
  }

  function close() {
    var id = matchId;
    matchId = null;
    failed = false;
    starting = null;
    onFail = null;
    queue = [];
    if (!id) return Promise.resolve();
    return api('/api/match/' + id + '/stop', {}).catch(function () {});
  }

  global.WWDshBridge = {
    open: open,
    ask: ask,
    close: close,
    live: live,
    probe: probe,
    id: function () { return matchId; },
    /* 页面是不是用 file:// 打开的——UI 上也要据此提示 */
    fileProtocol: fileProtocol
  };
})(window);
