"use strict";
/* global GIF, requestInterval, clearRequestInterval */

const MAX_FRAME = 4;
const OUT_SIZE = 112;
const CACHE_SIZE = 256;

const DEFAULTS = Object.freeze({
  squish: 1.25,
  scale: 0.875,
  delay: 60,
  spriteX: 14,
  spriteY: 20,
  spriteWidth: 112,
  spriteHeight: 112,
  currentFrame: 0,
  flip: false,
});

const CANVAS_OPTIONS = Object.freeze({
  antialias: false,
  powerPreference: "low-power",
});

const GIF_RENDERER_OPTIONS = Object.freeze({
  workers: 2,
  workerScript: "gif.worker.js",
  width: OUT_SIZE,
  height: OUT_SIZE,
  transparent: 0x00ff00,
});

const g = { ...DEFAULTS };

(() => {
  const $ = (sel) => document.querySelector(sel);
  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
  const truncate = (str, len) =>
    str.length < len ? str : `${str.slice(0, ~~(len / 2))}⋯${str.slice(-(~~(len / 2)))}`;

  // ── Default sprite (직접 그린 캐릭터, 외부 파일 의존성 없음) ───────────────
  const createDefaultSprite = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 200;
    const cx = c.getContext("2d");

    // 귀 (몸보다 먼저 그려야 뒤에 위치)
    cx.fillStyle = "#FFCC4D";
    cx.beginPath();
    cx.moveTo(42, 62); cx.lineTo(28, 20); cx.lineTo(72, 48); cx.closePath();
    cx.moveTo(158, 62); cx.lineTo(172, 20); cx.lineTo(128, 48); cx.closePath();
    cx.fill();

    // 귀 안쪽
    cx.fillStyle = "#FFB3C6";
    cx.beginPath();
    cx.moveTo(46, 58); cx.lineTo(36, 30); cx.lineTo(65, 50); cx.closePath();
    cx.moveTo(154, 58); cx.lineTo(164, 30); cx.lineTo(135, 50); cx.closePath();
    cx.fill();

    // 얼굴
    cx.fillStyle = "#FFCC4D";
    cx.beginPath();
    cx.arc(100, 108, 82, 0, Math.PI * 2);
    cx.fill();

    // 뺨 홍조
    cx.fillStyle = "rgba(255, 140, 140, 0.32)";
    cx.beginPath();
    cx.ellipse(62, 130, 24, 15, 0, 0, Math.PI * 2);
    cx.ellipse(138, 130, 24, 15, 0, 0, Math.PI * 2);
    cx.fill();

    // 눈 흰자
    cx.fillStyle = "#fff";
    cx.beginPath();
    cx.ellipse(76, 90, 18, 20, 0, 0, Math.PI * 2);
    cx.ellipse(124, 90, 18, 20, 0, 0, Math.PI * 2);
    cx.fill();

    // 눈동자
    cx.fillStyle = "#222";
    cx.beginPath();
    cx.arc(78, 92, 10, 0, Math.PI * 2);
    cx.arc(126, 92, 10, 0, Math.PI * 2);
    cx.fill();

    // 눈 하이라이트
    cx.fillStyle = "#fff";
    cx.beginPath();
    cx.arc(82, 87, 4, 0, Math.PI * 2);
    cx.arc(130, 87, 4, 0, Math.PI * 2);
    cx.fill();

    // 코 (작은 삼각형)
    cx.fillStyle = "#e07070";
    cx.beginPath();
    cx.moveTo(100, 112); cx.lineTo(94, 119); cx.lineTo(106, 119); cx.closePath();
    cx.fill();

    // 입 (고양이 스타일 W)
    cx.strokeStyle = "#c06060";
    cx.lineWidth = 2.5;
    cx.lineCap = "round";
    cx.beginPath();
    cx.moveTo(94, 120); cx.lineTo(87, 127);
    cx.moveTo(106, 120); cx.lineTo(113, 127);
    cx.stroke();

    return c.toDataURL();
  };

  // ── ImageLoader ──────────────────────────────────────────────────────────────
  const ImageLoader = (onLoad, onError) => {
    const cache = document.createElement("canvas");
    const cacheCtx = cache.getContext("2d");
    cache.width = cache.height = CACHE_SIZE;

    let dataURLCache = "";
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      cache.height = CACHE_SIZE * (img.naturalHeight / img.naturalWidth);
      cacheCtx.clearRect(0, 0, cache.width, cache.height);
      cacheCtx.drawImage(img, 0, 0, cache.width, cache.height);
      dataURLCache = cache.toDataURL();
      onLoad(dataURLCache);
    };

    img.addEventListener("error", (e) => onError(e, dataURLCache));

    return {
      loadImage: (src) => {
        URL.revokeObjectURL(img.src);
        img.src = src;
      },
    };
  };

  // ── Animation loop handle ─────────────────────────────────────────────────────
  let loop = null;

  // ── PetPetAnimation ───────────────────────────────────────────────────────────
  const PetPetAnimation = (canvas, hand, sprite, callbacks = {}) => {
    let allowAdjust = false;
    const ctx = canvas.getContext("2d", CANVAS_OPTIONS);
    ctx.imageSmoothingEnabled = false;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ff0000";
    canvas.tabIndex = 0;

    const refreshSprite = () => {
      g.spriteHeight = g.spriteWidth * (sprite.naturalHeight / sprite.naturalWidth);
    };
    sprite.addEventListener("load", refreshSprite);

    const frameOffsets = [
      { x: 0,   y: 0,  w: 0,  h: 0   },
      { x: -4,  y: 12, w: 4,  h: -12 },
      { x: -12, y: 18, w: 12, h: -18 },
      { x: -8,  y: 12, w: 4,  h: -12 },
      { x: -4,  y: 0,  w: 0,  h: 0   },
    ];

    const getSpriteFrame = (frame) => {
      const off = frameOffsets[frame];
      return {
        dx: ~~(g.spriteX + off.x * (g.squish * 0.4)),
        dy: ~~(g.spriteY + off.y * (g.squish * 0.9)),
        dw: ~~((g.spriteWidth  + off.w * g.squish) * g.scale),
        dh: ~~((g.spriteHeight + off.h * g.squish) * g.scale),
      };
    };

    const renderFrame = (frame, _ctx, showAdjust) => {
      const cf = getSpriteFrame(frame);

      if (_ctx.globalAlpha !== 1) _ctx.globalAlpha = 1;
      _ctx.clearRect(0, 0, OUT_SIZE, OUT_SIZE);

      _ctx.save();
      _ctx.translate(cf.dx, cf.dy);
      if (g.flip) {
        _ctx.scale(-1, 1);
        cf.dw *= -1;
      }
      _ctx.drawImage(sprite, 0, 0, cf.dw, cf.dh);
      if (showAdjust) _ctx.strokeRect(0, 0, cf.dw, cf.dh);
      _ctx.restore();

      if (showAdjust) _ctx.globalAlpha = 0.75;
      _ctx.drawImage(
        hand,
        frame * OUT_SIZE, 0, OUT_SIZE, OUT_SIZE,
        0,
        Math.max(0, ~~(cf.dy * 0.75 - Math.max(0, g.spriteY) - 0.5)),
        OUT_SIZE, OUT_SIZE
      );
    };

    const tick = () => {
      requestAnimFrame(() => renderFrame(g.currentFrame, ctx, allowAdjust));
    };

    const play = () => {
      if (!loop) {
        loop = requestInterval(() => {
          renderFrame(g.currentFrame, ctx, allowAdjust);
          g.currentFrame = (g.currentFrame + 1) % (MAX_FRAME + 1);
        }, g.delay);
      }
    };

    const stop = () => {
      if (loop) loop = clearRequestInterval(loop);
      tick();
    };

    const seek = (delta) => {
      stop();
      const next = (g.currentFrame + delta) % (MAX_FRAME + 1);
      g.currentFrame = next < 0 ? MAX_FRAME : next;
      tick();
    };

    let relX = 0, relY = 0, relScale = 1;
    let startX = 0, startY = 0, dragging = false;

    const inSpriteBounds = (frame, px, py) => {
      const cf = getSpriteFrame(frame);
      return px > cf.dx && px < cf.dx + cf.dw && py > cf.dy && py < cf.dy + cf.dh;
    };

    const updateRelativeOffset = () => {
      if (!allowAdjust) return;
      const r = canvas.getBoundingClientRect();
      relX = r.left;
      relY = r.top;
      relScale = OUT_SIZE / r.width;
    };

    const toggleAdjust = (force) => {
      allowAdjust = force !== undefined ? force : !allowAdjust;
      if (allowAdjust) { g.currentFrame = 0; stop(); }
      updateRelativeOffset();
      tick();
    };

    window.addEventListener("scroll", updateRelativeOffset);
    window.addEventListener("resize", updateRelativeOffset);

    canvas.addEventListener("pointerdown", (e) => {
      if (!allowAdjust) return;
      e.preventDefault();
      e.stopPropagation();
      startX = ~~((e.clientX - relX) * relScale);
      startY = ~~((e.clientY - relY) * relScale);
      dragging = inSpriteBounds(g.currentFrame, startX, startY);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const mx = ~~((e.clientX - relX) * relScale);
      const my = ~~((e.clientY - relY) * relScale);
      g.spriteX += mx - startX;
      g.spriteY += my - startY;
      startX = mx;
      startY = my;
      tick();
      callbacks.onSpriteMove?.(g.spriteX, g.spriteY);
    });

    ["pointerup", "pointerout"].forEach((ev) => {
      canvas.addEventListener(ev, (e) => {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = false;
      });
    });

    const KEY_DELTAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    canvas.addEventListener("keydown", (e) => {
      const moved = KEY_DELTAS[e.key];
      if (!moved) return;
      e.preventDefault();
      g.spriteX += moved[0];
      g.spriteY += moved[1];
      callbacks.onSpriteMove?.(g.spriteX, g.spriteY);
      tick();
    });

    return { tick, play, stop, seek, renderFrame, toggleAdjust, refreshSprite };
  };

  // ── GifRenderer ───────────────────────────────────────────────────────────────
  const GifRenderer = (animation, onStart, onProgress, onFinish) => {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d", CANVAS_OPTIONS);
    tempCanvas.width = tempCanvas.height = OUT_SIZE;

    const fixTransparency = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 1] > 250) data[i + 1] = 250;
        if (data[i + 3] < 120) { data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; }
        data[i + 3] = 255;
      }
    };

    return {
      render() {
        const gif = new GIF(GIF_RENDERER_OPTIONS);
        const delay = clamp(g.delay, 20, 1000);

        for (let i = 0; i <= MAX_FRAME; i++) {
          animation.renderFrame(i, tempCtx, false);
          const imgData = tempCtx.getImageData(0, 0, OUT_SIZE, OUT_SIZE);
          fixTransparency(imgData.data);
          tempCtx.putImageData(imgData, 0, 0);
          gif.addFrame(tempCtx, { copy: true, delay });
        }

        gif.on("start",    () => onStart(performance.now()));
        gif.on("progress", (p) => onProgress(p));
        gif.on("finished", (blob) => onFinish(blob, performance.now()));
        gif.render();
      },
    };
  };

  // ── DOMContentLoaded ──────────────────────────────────────────────────────────
  window.addEventListener("DOMContentLoaded", () => {
    const $canvas  = $("#canvas");
    const $preview = $("#uploadPreview");
    const $hand    = new Image();
    $hand.crossOrigin = "Anonymous";

    const $spriteXSlider = $("#spriteXSlider");
    const $spriteXVal    = $("#spriteXVal");
    const $spriteYSlider = $("#spriteYSlider");
    const $spriteYVal    = $("#spriteYVal");

    // ── State ──────────────────────────────────────────────────────────────────
    const $emptyState = $("#emptyState");
    const $editor     = $("#editor");

    const showEditor = () => {
      $emptyState.style.display = "none";
      $editor.style.display = "grid";
    };

    // ── Animation ─────────────────────────────────────────────────────────────
    const animation = PetPetAnimation($canvas, $hand, $preview, {
      onSpriteMove: (x, y) => {
        const rx = Math.round(x), ry = Math.round(y);
        $spriteXSlider.value = rx;
        $spriteYSlider.value = ry;
        $spriteXVal.textContent = rx;
        $spriteYVal.textContent = ry;
      },
    });

    const imageLoader = ImageLoader(
      (data) => {
        showEditor();
        $preview.src = data;
        animation.tick();
      },
      () => {
        $("#uploadError").textContent = "이미지를 불러올 수 없습니다.";
        $("#uploadErrorEditor").textContent = "이미지를 불러올 수 없습니다.";
      }
    );

    // ── Reset ──────────────────────────────────────────────────────────────────
    const $flipBtn   = $("#toggleFlip");
    const $adjustBtn = $("#toggleAdjust");

    const reset = () => {
      Object.assign(g, DEFAULTS);
      animation.refreshSprite();
      if (loop) { loop = clearRequestInterval(loop); animation.play(); }
      else animation.tick();

      const sqPct = ~~(DEFAULTS.squish * 100);
      const scPct = ~~(DEFAULTS.scale * 100);
      $("#squish").value          = sqPct;
      $("#squishVal").textContent = `${sqPct}%`;
      $("#scale").value           = scPct;
      $("#scaleVal").textContent  = `${scPct}%`;
      $("#fps").value = $("#fpsVal").value = ~~(1000 / DEFAULTS.delay);

      $spriteXSlider.value    = DEFAULTS.spriteX;
      $spriteXVal.textContent = DEFAULTS.spriteX;
      $spriteYSlider.value    = DEFAULTS.spriteY;
      $spriteYVal.textContent = DEFAULTS.spriteY;

      $flipBtn.setAttribute("aria-pressed", "false");
      $adjustBtn.setAttribute("aria-pressed", "false");
      $canvas.classList.remove("adjust-mode");
    };

    $("#reset").addEventListener("click", reset);

    // ── File upload ────────────────────────────────────────────────────────────
    const $dropArea       = $("#dropArea");
    const $dropAreaEditor = $("#dropAreaEditor");
    const $fileInput      = $("#uploadFile");
    const $fileName       = $("#uploadFileName");

    const handleFile = (file) => {
      if (!file?.type.startsWith("image/")) return;
      $("#uploadError").textContent = "";
      $("#uploadErrorEditor").textContent = "";
      $fileName.textContent = truncate(file.name, 26);
      imageLoader.loadImage(URL.createObjectURL(file));
    };

    // 빈 상태 드롭존 이벤트
    ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) =>
      $dropArea.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); })
    );
    ["dragenter", "dragover"].forEach((ev) =>
      $dropArea.addEventListener(ev, () => $dropArea.classList.add("highlight"))
    );
    ["dragleave", "drop"].forEach((ev) =>
      $dropArea.addEventListener(ev, () => $dropArea.classList.remove("highlight"))
    );
    $dropArea.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
    $fileInput.addEventListener("change", () => handleFile($fileInput.files[0]));

    // 에디터 이미지 변경 버튼 — 파일 input 직접 트리거
    $dropAreaEditor.addEventListener("click", (e) => {
      e.preventDefault();
      $fileInput.click();
    });

    // 에디터 화면에서도 드래그 드롭 허용
    ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) =>
      $dropAreaEditor.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); })
    );
    ["dragenter", "dragover"].forEach((ev) =>
      $dropAreaEditor.addEventListener(ev, () => $dropAreaEditor.classList.add("highlight"))
    );
    ["dragleave", "drop"].forEach((ev) =>
      $dropAreaEditor.addEventListener(ev, () => $dropAreaEditor.classList.remove("highlight"))
    );
    $dropAreaEditor.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

    const loadFromUrl = () => {
      const url = $("#uploadUrl").value.trim();
      if (!url) return;
      $("#uploadError").textContent = "";
      imageLoader.loadImage(url);
    };
    $("#uploadUrlBtn").addEventListener("click", loadFromUrl);
    $("#uploadUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") loadFromUrl(); });

    // ── Playback ───────────────────────────────────────────────────────────────
    const $playBtn = $("#play");
    const togglePlay = (forceStop = false) => {
      const isPaused = $playBtn.classList.contains("paused");
      if (forceStop || !isPaused) {
        animation.stop();
        $playBtn.classList.add("paused");
        $playBtn.textContent = "▶";
      } else {
        animation.play();
        $playBtn.classList.remove("paused");
        $playBtn.textContent = "⏸";
      }
    };

    $playBtn.addEventListener("click", () => togglePlay());
    [$("#prev"), $("#next")].forEach((el) =>
      el.addEventListener("click", (e) => {
        togglePlay(true);
        animation.seek(e.target.id === "prev" ? -1 : 1);
      })
    );

    // ── Image controls ─────────────────────────────────────────────────────────
    $("#squish").addEventListener("input", (e) => {
      const v = clamp(parseInt(e.target.value), 100, 300);
      g.squish = +(v / 100).toFixed(3);
      $("#squishVal").textContent = `${v}%`;
      animation.tick();
    }, { passive: true });

    $("#scale").addEventListener("input", (e) => {
      const v = clamp(parseInt(e.target.value), 20, 200);
      g.scale = +(v / 100).toFixed(3);
      $("#scaleVal").textContent = `${v}%`;
      animation.tick();
    }, { passive: true });

    $spriteXSlider.addEventListener("input", (e) => {
      g.spriteX = parseInt(e.target.value);
      $spriteXVal.textContent = g.spriteX;
      animation.tick();
    });

    $spriteYSlider.addEventListener("input", (e) => {
      g.spriteY = parseInt(e.target.value);
      $spriteYVal.textContent = g.spriteY;
      animation.tick();
    });

    // 좌우 반전 — 토글 버튼
    $flipBtn.addEventListener("click", () => {
      const active = $flipBtn.getAttribute("aria-pressed") === "true";
      $flipBtn.setAttribute("aria-pressed", String(!active));
      g.flip = !active;
      animation.tick();
    });

    // 드래그 모드 — 토글 버튼
    $adjustBtn.addEventListener("click", () => {
      const active = $adjustBtn.getAttribute("aria-pressed") === "true";
      const next = !active;
      $adjustBtn.setAttribute("aria-pressed", String(next));
      $canvas.classList.toggle("adjust-mode", next);
      if (next) togglePlay(true);
      animation.toggleAdjust(next);
    });

    // ── Speed ──────────────────────────────────────────────────────────────────
    const $fps    = $("#fps");
    const $fpsVal = $("#fpsVal");

    const updateSpeed = (val) => {
      const newDelay = ~~(1000 / clamp(parseInt(val), 2, 60));
      if (newDelay !== g.delay) {
        g.delay = newDelay;
        if (loop) { loop = clearRequestInterval(loop); animation.play(); }
      }
    };

    $fps.addEventListener("change",  (e) => updateSpeed(e.target.value));
    $fpsVal.addEventListener("change", (e) => updateSpeed(e.target.value));
    $fps.addEventListener("input",   (e) => { $fpsVal.value = e.target.value; });
    $fpsVal.addEventListener("input", (e) => { $fps.value = e.target.value; });

    // ── GIF Export ─────────────────────────────────────────────────────────────
    const $exportBtn  = $("#export");
    const $info       = $("#info");
    const $result     = $("#result");
    const $download   = $("#download");
    const $overlay    = $("#overlay");
    const $overlayMeta = $("#overlayMeta");
    let exportBtnText = "";
    let gifStartTime  = 0;

    const renderer = GifRenderer(
      animation,
      (t) => {
        gifStartTime = t;
        URL.revokeObjectURL($result.src);
        $exportBtn.disabled = true;
        exportBtnText = $exportBtn.textContent;
        $exportBtn.textContent = "생성 중…";
      },
      (p) => {
        const pct = Math.round(p * 100);
        $exportBtn.textContent = `${pct}%`;
        $info.textContent = `${pct}%`;
      },
      (blob, t) => {
        const sec  = ((t - gifStartTime) / 1000).toFixed(2);
        const size = (blob.size / 1000).toFixed(1);
        $info.textContent = `${sec}초 · ${size}KB`;
        $exportBtn.textContent = exportBtnText;
        $exportBtn.disabled = false;

        const url = URL.createObjectURL(blob);
        $result.src = url;
        $download.href = url;
        $overlayMeta.textContent = `${sec}초 · ${size}KB`;
        $overlay.classList.add("open");
      }
    );

    $exportBtn.addEventListener("click", () => renderer.render());

    // 오버레이 닫기
    $("#closeOverlay").addEventListener("click", () => $overlay.classList.remove("open"));
    $overlay.addEventListener("click", (e) => {
      if (e.target === $overlay) $overlay.classList.remove("open");
    });

    // ── Theme toggle ───────────────────────────────────────────────────────────
    const $themeBtn = $("#themeToggle");
    let theme = localStorage.getItem("petpet-theme") ||
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    const applyTheme = (t) => {
      document.documentElement.setAttribute("data-theme", t);
      $themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
      localStorage.setItem("petpet-theme", t);
    };

    applyTheme(theme);
    $themeBtn.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      applyTheme(theme);
    });

    // ── Load assets ────────────────────────────────────────────────────────────
    $hand.src = "./img/sprite.png";
    imageLoader.loadImage(createDefaultSprite());
    window.addEventListener("load", () => animation.play());

    window.petpet = { g, animation, imageLoader, renderer, reset, DEFAULTS };
  });
})();
