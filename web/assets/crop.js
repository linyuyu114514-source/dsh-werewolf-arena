/* ============================================================
   大肥鱼狼人杀 · 头像上传与裁剪
   ------------------------------------------------------------
   纯 Canvas 实现：拖拽平移 + 滑块缩放 + 圆形裁剪。
   产出 256x256 的 dataURL，直接存进 localStorage。
   ============================================================ */
(function (global) {
  'use strict';

  var OUT_SIZE = 256;          /* 最终头像边长（像素） */
  var MAX_INPUT = 12 * 1024 * 1024;  /* 原图上限 12MB */
  var ACCEPT = /^image\/(png|jpeg|jpg|webp|gif|bmp)$/i;

  var el = {};                 /* 弹层内的 DOM 引用 */
  var ctx = null;
  var stageSize = 0;           /* 舞台边长（CSS 像素） */
  var state = null;            /* {img, base, zoom, x, y} */
  var onDone = null;           /* 裁剪确认后的回调 */
  var bound = false;

  /* ------------------------------------------------------------
     弹层骨架
     ------------------------------------------------------------ */
  function ensureModal() {
    if (el.modal) return;
    var wrap = document.createElement('div');
    wrap.className = 'crop-modal';
    wrap.id = 'cropModal';
    wrap.innerHTML =
      '<div class="crop-box" role="dialog" aria-modal="true" aria-labelledby="cropTitle">' +
        '<div class="crop-head">' +
          '<h3 id="cropTitle">调整你的头像</h3>' +
          '<p>拖动图片改变位置，拉动滑块缩放。圆形内的部分会被保留。</p>' +
        '</div>' +
        '<div class="crop-stage" id="cropStage">' +
          '<canvas id="cropCanvas"></canvas>' +
          '<div class="crop-mask"></div>' +
          '<div class="crop-ring"></div>' +
          '<div class="crop-cross"></div>' +
        '</div>' +
        '<div class="crop-zoom">' +
          '<span>缩放</span>' +
          '<input type="range" id="cropZoom" min="100" max="320" value="100" step="1" aria-label="缩放图片">' +
        '</div>' +
        '<div class="crop-foot">' +
          '<button class="btn-ghost" id="cropCancel" type="button">取消</button>' +
          '<button class="btn-primary" id="cropApply" type="button">用这张</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    el.modal = wrap;
    el.stage = wrap.querySelector('#cropStage');
    el.canvas = wrap.querySelector('#cropCanvas');
    el.zoom = wrap.querySelector('#cropZoom');
    el.apply = wrap.querySelector('#cropApply');
    el.cancel = wrap.querySelector('#cropCancel');
    ctx = el.canvas.getContext('2d');
  }

  /* ------------------------------------------------------------
     舞台尺寸与像素比
     ------------------------------------------------------------ */
  function syncCanvasSize() {
    var rect = el.stage.getBoundingClientRect();
    stageSize = Math.max(1, Math.round(rect.width));
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    el.canvas.width = Math.round(stageSize * dpr);
    el.canvas.height = Math.round(stageSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ------------------------------------------------------------
     绘制
     ------------------------------------------------------------ */
  function draw() {
    if (!state || !ctx) return;
    var s = stageSize;
    ctx.clearRect(0, 0, s, s);

    var dw = state.img.naturalWidth * state.base * state.zoom;
    var dh = state.img.naturalHeight * state.base * state.zoom;
    var dx = (s - dw) / 2 + state.x;
    var dy = (s - dh) / 2 + state.y;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.img, dx, dy, dw, dh);
  }

  /* 限制平移，保证图片始终盖满裁剪圆 */
  function clampPan() {
    if (!state) return;
    var s = stageSize;
    var dw = state.img.naturalWidth * state.base * state.zoom;
    var dh = state.img.naturalHeight * state.base * state.zoom;
    var maxX = Math.max(0, (dw - s) / 2);
    var maxY = Math.max(0, (dh - s) / 2);
    state.x = Math.min(maxX, Math.max(-maxX, state.x));
    state.y = Math.min(maxY, Math.max(-maxY, state.y));
  }

  /* ------------------------------------------------------------
     载入图片
     ------------------------------------------------------------ */
  function loadFile(file) {
    if (!file) return;
    if (!ACCEPT.test(file.type || '')) {
      toastOutside('只支持 PNG / JPG / WEBP 这类图片');
      return;
    }
    if (file.size > MAX_INPUT) {
      toastOutside('图片太大了，换一张 12MB 以内的');
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () { open(img); };
      img.onerror = function () { toastOutside('这张图片读不出来，换一张试试'); };
      img.src = String(reader.result);
    };
    reader.onerror = function () { toastOutside('读取文件失败'); };
    reader.readAsDataURL(file);
  }

  /* 供外部（拖拽 / 粘贴）直接传入图片 */
  function open(img) {
    ensureModal();
    bindOnce();

    var s = el.stage.getBoundingClientRect().width || 320;
    var base = Math.max(s / img.naturalWidth, s / img.naturalHeight);

    state = { img: img, base: base, zoom: 1, x: 0, y: 0 };
    el.zoom.value = '100';

    el.modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    /* 等弹层完成布局再量尺寸 */
    requestAnimationFrame(function () {
      syncCanvasSize();
      draw();
    });
  }

  function close() {
    if (!el.modal) return;
    el.modal.classList.remove('is-open');
    document.body.style.overflow = '';
    state = null;
    onDone = null;
  }

  /* ------------------------------------------------------------
     导出
     ------------------------------------------------------------ */
  function exportDataURL() {
    if (!state) return '';
    var out = document.createElement('canvas');
    out.width = OUT_SIZE;
    out.height = OUT_SIZE;
    var c = out.getContext('2d');
    var k = OUT_SIZE / stageSize;

    var dw = state.img.naturalWidth * state.base * state.zoom * k;
    var dh = state.img.naturalHeight * state.base * state.zoom * k;
    var dx = (OUT_SIZE - dw) / 2 + state.x * k;
    var dy = (OUT_SIZE - dh) / 2 + state.y * k;

    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(state.img, dx, dy, dw, dh);
    return out.toDataURL('image/jpeg', 0.88);
  }

  /* ------------------------------------------------------------
     事件绑定
     ------------------------------------------------------------ */
  function bindOnce() {
    if (bound) return;
    bound = true;

    /* --- 拖拽（鼠标 + 触屏统一用 Pointer 事件） --- */
    var dragging = false;
    var lastX = 0, lastY = 0;

    el.stage.addEventListener('pointerdown', function (e) {
      if (!state) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.stage.classList.add('is-dragging');
      el.stage.setPointerCapture(e.pointerId);
    });

    el.stage.addEventListener('pointermove', function (e) {
      if (!dragging || !state) return;
      state.x += e.clientX - lastX;
      state.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      clampPan();
      draw();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      el.stage.classList.remove('is-dragging');
      try { el.stage.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    el.stage.addEventListener('pointerup', endDrag);
    el.stage.addEventListener('pointercancel', endDrag);

    /* --- 滚轮缩放 --- */
    el.stage.addEventListener('wheel', function (e) {
      if (!state) return;
      e.preventDefault();
      var next = Number(el.zoom.value) + (e.deltaY < 0 ? 8 : -8);
      el.zoom.value = String(Math.min(320, Math.max(100, next)));
      applyZoom();
    }, { passive: false });

    /* --- 滑块缩放 --- */
    el.zoom.addEventListener('input', applyZoom);

    /* --- 按钮 --- */
    el.cancel.addEventListener('click', close);
    el.apply.addEventListener('click', function () {
      var url = exportDataURL();
      var cb = onDone;
      close();
      if (url && cb) cb(url);
    });

    /* 点遮罩空白处关闭 */
    el.modal.addEventListener('click', function (e) {
      if (e.target === el.modal) close();
    });

    /* Esc 关闭 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.modal.classList.contains('is-open')) close();
    });

    /* 窗口尺寸变化时重新量 */
    global.addEventListener('resize', function () {
      if (!el.modal || !el.modal.classList.contains('is-open')) return;
      syncCanvasSize();
      clampPan();
      draw();
    });
  }

  function applyZoom() {
    if (!state) return;
    state.zoom = Number(el.zoom.value) / 100;
    clampPan();
    draw();
  }

  /* 弹层外的简易提示（避免和 app.js 循环依赖） */
  function toastOutside(msg) {
    if (global.WWToast) { global.WWToast(msg); return; }
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-show');
    setTimeout(function () { t.classList.remove('is-show'); }, 2000);
  }

  /* ------------------------------------------------------------
     对外接口
     ------------------------------------------------------------ */
  global.WWCrop = {
    /* 打开系统选图 */
    pick: function (callback) {
      ensureModal();
      bindOnce();
      onDone = callback;
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
      input.style.display = 'none';
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        document.body.removeChild(input);
        if (f) loadFile(f);
      });
      document.body.appendChild(input);
      input.click();
    },
    /* 直接打开一张 File / Blob */
    openFile: function (file, callback) {
      ensureModal();
      bindOnce();
      onDone = callback;
      loadFile(file);
    },
    close: close
  };
})(window);
