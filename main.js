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
  const $$ = (sel) => document.querySelectorAll(sel);
  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
  const truncate = (str, len) =>
    str.length < len ? str : `${str.slice(0, ~~(len / 2))}⋯${str.slice(-(~~(len / 2)))}`;

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

    // Refresh sprite height proportionally when image changes
    const refreshSprite = () => {
      g.spriteHeight = g.spriteWidth * (sprite.naturalHeight / sprite.naturalWidth);
    };
    sprite.addEventListener("load", refreshSprite);

    // Per-frame offsets applied to the subject image (squish/position change)
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

      // Draw subject image (flip if needed)
      _ctx.save();
      _ctx.translate(cf.dx, cf.dy);
      if (g.flip) {
        _ctx.scale(-1, 1);
        cf.dw *= -1;
      }
      _ctx.drawImage(sprite, 0, 0, cf.dw, cf.dh);
      if (showAdjust) _ctx.strokeRect(0, 0, cf.dw, cf.dh);
      _ctx.restore();

      // Draw hand
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
      requestAnimationFrame(() => renderFrame(g.currentFrame, ctx, allowAdjust));
    };

    const play = () => {
      if (!loop) {
        loop = requestInterval(() => {
          renderFrame(g.currentFrame, ctx, allowAdjust);
          g.currentFrame = (g.currentFrame + 1) % 5;
        }, g.delay);
      }
    };

    const stop = () => {
      if (loop) loop = clearRequestInterval(loop);
      tick();
    };

    const seek = (delta) => {
      stop();
      const next = (g.currentFrame + delta) % 5;
      g.currentFrame = next < 0 ? MAX_FRAME : next;
      tick();
    };

    // ── Drag-to-move image position ─────────────────────────────────────────────
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

    // Keyboard nudge while canvas is focused
    let lastClick = null;
    document.addEventListener("click", (e) => (lastClick = e.target));
    document.addEventListener("keydown", (e) => {
      if (lastClick !== canvas) return;
      const moved = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
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
    const renderCanvas = document.createElement("canvas");
    const renderCtx = renderCanvas.getContext("2d", CANVAS_OPTIONS);
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d", CANVAS_OPTIONS);
    renderCanvas.width = renderCanvas.height = tempCanvas.width = tempCanvas.height = OUT_SIZE;
    renderCtx.fillStyle = "#0f0";

    // Replace transparent pixels with green key color for GIF transparency
    const fixTransparency = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 1] > 250) data[i + 1] = 250; // clamp near-pure greens
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
          renderCtx.putImageData(imgData, 0, 0);
          gif.addFrame(renderCtx, { copy: true, delay });
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

    const animation = PetPetAnimation($canvas, $hand, $preview, {
      // Keep position sliders in sync with drag
      onSpriteMove: (x, y) => {
        $("#spriteXSlider").value = Math.round(x);
        $("#spriteYSlider").value = Math.round(y);
        $("#spriteXVal").textContent = Math.round(x);
        $("#spriteYVal").textContent = Math.round(y);
      },
    });

    const imageLoader = ImageLoader(
      (data) => {
        $preview.src = data;
        animation.tick();
      },
      () => {
        $("#uploadError").textContent = "이미지를 불러올 수 없습니다!";
      }
    );

    // ── Reset ──────────────────────────────────────────────────────────────────
    const reset = () => {
      Object.assign(g, DEFAULTS);
      animation.refreshSprite();
      if (loop) { loop = clearRequestInterval(loop); animation.play(); }
      else animation.tick();

      $("#squish").value       = ~~(DEFAULTS.squish * 100);
      $("#squishVal").textContent = `${~~(DEFAULTS.squish * 100)}%`;
      $("#scale").value        = ~~(DEFAULTS.scale * 100);
      $("#scaleVal").textContent  = `${~~(DEFAULTS.scale * 100)}%`;
      $("#fps").value          = $("#fpsVal").value = ~~(1000 / DEFAULTS.delay);
      $("#toggleFlip").checked = false;

      $("#spriteXSlider").value      = DEFAULTS.spriteX;
      $("#spriteXVal").textContent   = DEFAULTS.spriteX;
      $("#spriteYSlider").value      = DEFAULTS.spriteY;
      $("#spriteYVal").textContent   = DEFAULTS.spriteY;
    };

    $("#reset").addEventListener("click", reset);

    // ── File upload ────────────────────────────────────────────────────────────
    const $dropArea  = $("#dropArea");
    const $fileInput = $("#uploadFile");
    const $fileName  = $("#uploadFileName");

    const handleFile = (file) => {
      if (!file?.type.startsWith("image/")) return;
      $("#uploadError").textContent = "";
      $fileName.textContent = `🖼 ${truncate(file.name, 24)}`;
      imageLoader.loadImage(URL.createObjectURL(file));
    };

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
    $$("#prev, #next").forEach((el) =>
      el.addEventListener("click", (e) => {
        togglePlay(true);
        animation.seek(e.target.id === "prev" ? -1 : 1);
      })
    );

    // ── Image controls ─────────────────────────────────────────────────────────
    ["input", "change"].forEach((ev) => {
      $("#squish").addEventListener(ev, (e) => {
        const v = clamp(parseInt(e.target.value), 100, 300);
        g.squish = +(v / 100).toFixed(3);
        $("#squishVal").textContent = `${v}%`;
        animation.tick();
      }, { passive: true });

      $("#scale").addEventListener(ev, (e) => {
        const v = clamp(parseInt(e.target.value), 20, 200);
        g.scale = +(v / 100).toFixed(3);
        $("#scaleVal").textContent = `${v}%`;
        animation.tick();
      }, { passive: true });
    });

    $("#spriteXSlider").addEventListener("input", (e) => {
      g.spriteX = parseInt(e.target.value);
      $("#spriteXVal").textContent = g.spriteX;
      animation.tick();
    });

    $("#spriteYSlider").addEventListener("input", (e) => {
      g.spriteY = parseInt(e.target.value);
      $("#spriteYVal").textContent = g.spriteY;
      animation.tick();
    });

    $("#toggleFlip").addEventListener("change", (e) => {
      g.flip = e.target.checked;
      animation.tick();
    });

    $("#toggleAdjust").addEventListener("click", (e) => {
      $canvas.classList.toggle("adjust-mode", e.target.checked);
      if (e.target.checked) togglePlay(true);
      animation.toggleAdjust();
    });

    // ── Speed ──────────────────────────────────────────────────────────────────
    const updateSpeed = (val) => {
      const newDelay = ~~(1000 / clamp(parseInt(val), 2, 60));
      if (newDelay !== g.delay) {
        g.delay = newDelay;
        if (loop) { loop = clearRequestInterval(loop); animation.play(); }
      }
    };

    $$("#fps, #fpsVal").forEach((el) => el.addEventListener("change", (e) => updateSpeed(e.target.value)));
    $("#fps").addEventListener("input", (e) => { $("#fpsVal").value = e.target.value; });
    $("#fpsVal").addEventListener("input", (e) => { $("#fps").value = e.target.value; });

    // ── GIF Export ─────────────────────────────────────────────────────────────
    const $exportBtn    = $("#export");
    const $info         = $("#info");
    const $result       = $("#result");
    const $download     = $("#download");
    const $outputSection = $("#outputSection");
    let exportBtnText = "";
    let gifStartTime  = 0;

    const renderer = GifRenderer(
      animation,
      (t) => {
        gifStartTime = t;
        URL.revokeObjectURL($result.src);
        $exportBtn.disabled = true;
        exportBtnText = $exportBtn.textContent;
      },
      (p) => {
        const pct = `${Math.round(p * 100)}%`;
        $exportBtn.textContent = pct;
        $info.textContent = pct;
      },
      (blob, t) => {
        const sec  = ((t - gifStartTime) / 1000).toFixed(2);
        const size = (blob.size / 1000).toFixed(1);
        $info.textContent = `완료! ${sec}초, ${size}KB`;
        $exportBtn.textContent = exportBtnText;
        $exportBtn.disabled = false;

        const url = URL.createObjectURL(blob);
        $result.src = url;
        $download.href = url;
        $outputSection.style.display = "block";
        $outputSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    );

    $exportBtn.addEventListener("click", () => renderer.render());

    // ── Theme toggle ───────────────────────────────────────────────────────────
    const $themeBtn = $("#themeToggle");
    let theme = localStorage.getItem("petpet-theme") ||
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    const applyTheme = (t) => {
      document.documentElement.setAttribute("data-theme", t);
      $themeBtn.textContent = t === "dark" ? "☀️ 라이트" : "🌙 다크";
      localStorage.setItem("petpet-theme", t);
    };

    applyTheme(theme);
    $themeBtn.addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; applyTheme(theme); });

    // ── Load assets ────────────────────────────────────────────────────────────
    $hand.src = "./img/sprite.png";
    imageLoader.loadImage("./img/sample.png");
    window.addEventListener("load", () => animation.play());

    // Expose for console debugging
    window.petpet = { g, animation, imageLoader, renderer, reset, DEFAULTS };
  });
})();
