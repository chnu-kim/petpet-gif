/* global GIF, requestInterval, clearRequestInterval, requestAnimFrame */

export const MAX_FRAME = 4;
export const OUT_SIZE = 112;

const CACHE_SIZE = 256;

export const DEFAULTS = Object.freeze({
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
  powerPreference: 'low-power',
});

const GIF_BASE_OPTIONS = Object.freeze({
  workers: 2,
  width: OUT_SIZE,
  height: OUT_SIZE,
  transparent: 0x00ff00,
});

export const FRAME_OFFSETS = [
  { x: 0,   y: 0,  w: 0,  h: 0   },
  { x: -4,  y: 12, w: 4,  h: -12 },
  { x: -12, y: 18, w: 12, h: -18 },
  { x: -8,  y: 12, w: 4,  h: -12 },
  { x: -4,  y: 0,  w: 0,  h: 0   },
];

export const g = { ...DEFAULTS };

export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

export const truncate = (str, len) =>
  str.length < len ? str : `${str.slice(0, ~~(len / 2))}⋯${str.slice(-(~~(len / 2)))}`;

export const getSpriteFrame = (frame, state) => {
  const off = FRAME_OFFSETS[frame];
  return {
    dx: ~~(state.spriteX + off.x * (state.squish * 0.4)),
    dy: ~~(state.spriteY + off.y * (state.squish * 0.9)),
    dw: ~~((state.spriteWidth  + off.w * state.squish) * state.scale),
    dh: ~~((state.spriteHeight + off.h * state.squish) * state.scale),
  };
};

export const calcHandY = (cfDy, spriteY) =>
  Math.max(0, ~~(cfDy * 0.75 - Math.max(0, spriteY) - 0.5));

export const fixTransparency = (data) => {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 1] > 250) data[i + 1] = 250;
    if (data[i + 3] < 120) { data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; }
    data[i + 3] = 255;
  }
};

export const createDefaultSprite = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const cx = c.getContext('2d');

  // 귀 (몸보다 먼저 그려야 뒤에 위치)
  cx.fillStyle = '#FFCC4D';
  cx.beginPath();
  cx.moveTo(42, 62); cx.lineTo(28, 20); cx.lineTo(72, 48); cx.closePath();
  cx.moveTo(158, 62); cx.lineTo(172, 20); cx.lineTo(128, 48); cx.closePath();
  cx.fill();

  cx.fillStyle = '#FFB3C6';
  cx.beginPath();
  cx.moveTo(46, 58); cx.lineTo(36, 30); cx.lineTo(65, 50); cx.closePath();
  cx.moveTo(154, 58); cx.lineTo(164, 30); cx.lineTo(135, 50); cx.closePath();
  cx.fill();

  cx.fillStyle = '#FFCC4D';
  cx.beginPath();
  cx.arc(100, 108, 82, 0, Math.PI * 2);
  cx.fill();

  cx.fillStyle = 'rgba(255, 140, 140, 0.32)';
  cx.beginPath();
  cx.ellipse(62, 130, 24, 15, 0, 0, Math.PI * 2);
  cx.ellipse(138, 130, 24, 15, 0, 0, Math.PI * 2);
  cx.fill();

  cx.fillStyle = '#fff';
  cx.beginPath();
  cx.ellipse(76, 90, 18, 20, 0, 0, Math.PI * 2);
  cx.ellipse(124, 90, 18, 20, 0, 0, Math.PI * 2);
  cx.fill();

  cx.fillStyle = '#222';
  cx.beginPath();
  cx.arc(78, 92, 10, 0, Math.PI * 2);
  cx.arc(126, 92, 10, 0, Math.PI * 2);
  cx.fill();

  cx.fillStyle = '#fff';
  cx.beginPath();
  cx.arc(82, 87, 4, 0, Math.PI * 2);
  cx.arc(130, 87, 4, 0, Math.PI * 2);
  cx.fill();

  cx.fillStyle = '#e07070';
  cx.beginPath();
  cx.moveTo(100, 112); cx.lineTo(94, 119); cx.lineTo(106, 119); cx.closePath();
  cx.fill();

  cx.strokeStyle = '#c06060';
  cx.lineWidth = 2.5;
  cx.lineCap = 'round';
  cx.beginPath();
  cx.moveTo(94, 120); cx.lineTo(87, 127);
  cx.moveTo(106, 120); cx.lineTo(113, 127);
  cx.stroke();

  return c.toDataURL();
};

export const ImageLoader = (onLoad, onError) => {
  const cache = document.createElement('canvas');
  const cacheCtx = cache.getContext('2d');
  cache.width = cache.height = CACHE_SIZE;

  let dataURLCache = '';
  let toRevoke = '';
  const img = new Image();
  img.crossOrigin = 'Anonymous';

  const flushRevoke = () => {
    if (toRevoke) { URL.revokeObjectURL(toRevoke); toRevoke = ''; }
  };

  img.onload = () => {
    flushRevoke();
    cache.height = CACHE_SIZE * (img.naturalHeight / img.naturalWidth);
    cacheCtx.clearRect(0, 0, cache.width, cache.height);
    cacheCtx.drawImage(img, 0, 0, cache.width, cache.height);
    dataURLCache = cache.toDataURL();
    onLoad(dataURLCache);
  };

  img.addEventListener('error', (e) => {
    flushRevoke();
    onError(e, dataURLCache);
  });

  return {
    loadImage(src) {
      // revoke the superseded URL immediately (its load was already cancelled);
      // keep the current img.src pending revocation until the new one loads
      if (toRevoke) URL.revokeObjectURL(toRevoke);
      toRevoke = img.src;
      img.src = src;
    },
  };
};

export const PetPetAnimation = (canvas, hand, sprite, callbacks = {}) => {
  let allowAdjust = false;
  let loop = null;

  const ctx = canvas.getContext('2d', CANVAS_OPTIONS);
  ctx.imageSmoothingEnabled = false;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ff0000';
  canvas.tabIndex = 0;

  const refreshSprite = () => {
    g.spriteHeight = g.spriteWidth * (sprite.naturalHeight / sprite.naturalWidth);
  };
  sprite.addEventListener('load', refreshSprite);

  const renderFrame = (frame, _ctx, showAdjust) => {
    const cf = getSpriteFrame(frame, g);

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
      calcHandY(cf.dy, g.spriteY),
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

  const restartIfPlaying = () => {
    if (loop) { loop = clearRequestInterval(loop); play(); }
  };

  const isPlaying = () => !!loop;

  let relX = 0, relY = 0, relScale = 1;
  let startX = 0, startY = 0, dragging = false;

  const inSpriteBounds = (frame, px, py) => {
    const cf = getSpriteFrame(frame, g);
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
    if (allowAdjust) {
      g.currentFrame = 0;
      stop();
      updateRelativeOffset();
      window.addEventListener('scroll', onScroll);
      window.addEventListener('resize', onResize);
    } else {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    }
    tick();
  };

  const onScroll = updateRelativeOffset;
  const onResize = updateRelativeOffset;

  canvas.addEventListener('pointerdown', (e) => {
    if (!allowAdjust) return;
    e.preventDefault();
    e.stopPropagation();
    startX = ~~((e.clientX - relX) * relScale);
    startY = ~~((e.clientY - relY) * relScale);
    dragging = inSpriteBounds(g.currentFrame, startX, startY);
  });

  canvas.addEventListener('pointermove', (e) => {
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

  ['pointerup', 'pointerout'].forEach((ev) => {
    canvas.addEventListener(ev, (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
    });
  });

  const KEY_DELTAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  canvas.addEventListener('keydown', (e) => {
    const moved = KEY_DELTAS[e.key];
    if (!moved) return;
    e.preventDefault();
    g.spriteX += moved[0];
    g.spriteY += moved[1];
    callbacks.onSpriteMove?.(g.spriteX, g.spriteY);
    tick();
  });

  const destroy = () => {
    if (loop) loop = clearRequestInterval(loop);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    sprite.removeEventListener('load', refreshSprite);
  };

  return { tick, play, stop, seek, renderFrame, toggleAdjust, refreshSprite, restartIfPlaying, isPlaying, destroy };
};

export const GifRenderer = (animation, workerScriptUrl, onStart, onProgress, onFinish) => {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d', CANVAS_OPTIONS);
  tempCanvas.width = tempCanvas.height = OUT_SIZE;

  return {
    render() {
      const gif = new GIF({ ...GIF_BASE_OPTIONS, workerScript: workerScriptUrl });
      const delay = clamp(g.delay, 20, 1000);

      for (let i = 0; i <= MAX_FRAME; i++) {
        animation.renderFrame(i, tempCtx, false);
        const imgData = tempCtx.getImageData(0, 0, OUT_SIZE, OUT_SIZE);
        fixTransparency(imgData.data);
        gif.addFrame(imgData, { copy: false, delay });
      }

      gif.on('start',    () => onStart(performance.now()));
      gif.on('progress', (p) => onProgress(p));
      gif.on('finished', (blob) => onFinish(blob, performance.now()));
      gif.render();
    },
  };
};
