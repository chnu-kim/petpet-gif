import { useEffect, useRef, useState, useCallback } from 'react';
import {
  g, DEFAULTS, clamp, truncate,
  createDefaultSprite, ImageLoader, PetPetAnimation, GifRenderer,
} from './engine.js';

const INITIAL_FPS = Math.round(1000 / DEFAULTS.delay);

export default function App() {
  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('petpet-theme') ||
    (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('petpet-theme', theme);
  }, [theme]);

  // ── View (CSS display 토글 — canvas를 항상 DOM에 유지) ──────────────────────
  const [view, setView] = useState('empty');

  // ── Display state ──────────────────────────────────────────────────────────
  const [scaleVal, setScaleVal]     = useState(~~(DEFAULTS.scale * 100));
  const [squishVal, setSquishVal]   = useState(~~(DEFAULTS.squish * 100));
  const [spriteX, setSpriteX]       = useState(DEFAULTS.spriteX);
  const [spriteY, setSpriteY]       = useState(DEFAULTS.spriteY);
  const [fps, setFps]               = useState(INITIAL_FPS);
  const [flip, setFlip]             = useState(DEFAULTS.flip);
  const [adjustMode, setAdjustMode] = useState(false);
  const [playing, setPlaying]       = useState(false);
  const [fileName, setFileName]     = useState('이미지 변경');

  // ── Upload error ───────────────────────────────────────────────────────────
  const [uploadError, setUploadError] = useState('');

  // ── GIF export ─────────────────────────────────────────────────────────────
  const [exportLabel, setExportLabel] = useState('GIF 생성');
  const exporting = exportLabel !== 'GIF 생성';
  const [exportInfo, setExportInfo]   = useState('');
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [gifUrl, setGifUrl]           = useState('');
  const [gifMeta, setGifMeta]         = useState('');

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const canvasRef      = useRef(null);
  const previewRef     = useRef(null);
  const fileInputRef   = useRef(null);
  const urlInputRef    = useRef(null);
  const dropAreaRef    = useRef(null);
  const editorDropRef  = useRef(null);

  // ── Engine refs ────────────────────────────────────────────────────────────
  const animationRef = useRef(null);
  const loaderRef    = useRef(null);
  const rendererRef  = useRef(null);

  // ── Engine init ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas  = canvasRef.current;
    const preview = previewRef.current;
    if (!canvas || !preview) return;

    let cancelled = false; // StrictMode double-mount guard
    let gifStart = 0;

    const hand = new Image();
    hand.crossOrigin = 'Anonymous';

    const animation = PetPetAnimation(canvas, hand, preview, {
      onSpriteMove: (x, y) => {
        setSpriteX(Math.round(x));
        setSpriteY(Math.round(y));
      },
    });
    animationRef.current = animation;

    const workerScript = `${import.meta.env.BASE_URL}gif.worker.js`;
    rendererRef.current = GifRenderer(
      animation,
      workerScript,
      (t) => {
        gifStart = t;
        setExportLabel('생성 중…');
      },
      (p) => {
        const pct = `${Math.round(p * 100)}%`;
        setExportLabel(pct);
        setExportInfo(pct);
      },
      (blob, t) => {
        const sec   = ((t - gifStart) / 1000).toFixed(2);
        const size  = (blob.size / 1000).toFixed(1);
        const label = `${sec}초 · ${size}KB`;
        setExportInfo(label);
        setExportLabel('GIF 생성');
        setGifUrl((prev) => { URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        setGifMeta(label);
        setOverlayOpen(true);
      }
    );

    loaderRef.current = ImageLoader(
      (data) => {
        if (cancelled) return;
        setView('editor');
        setUploadError('');
        preview.src = data;
        animation.play();
        setPlaying(true);
      },
      () => {
        if (cancelled) return;
        setUploadError('이미지를 불러올 수 없습니다.');
      }
    );

    hand.src = `${import.meta.env.BASE_URL}img/sprite.png`;
    loaderRef.current.loadImage(createDefaultSprite());

    return () => { cancelled = true; animation.destroy(); };
  }, []);

  // ── Drop zone wiring ───────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    setUploadError('');
    setFileName(truncate(file.name, 26));
    loaderRef.current?.loadImage(URL.createObjectURL(file));
  }, []);

  useEffect(() => {
    const wire = (el) => {
      if (!el) return () => {};
      const prevent  = (e) => { e.preventDefault(); e.stopPropagation(); };
      const addHl    = () => el.classList.add('highlight');
      const rmHl     = () => el.classList.remove('highlight');
      const onDrop   = (e) => { rmHl(); handleFile(e.dataTransfer.files[0]); };
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, prevent));
      ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, addHl));
      ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, rmHl));
      el.addEventListener('drop', onDrop);
      return () => {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => el.removeEventListener(ev, prevent));
        ['dragenter', 'dragover'].forEach((ev) => el.removeEventListener(ev, addHl));
        ['dragleave', 'drop'].forEach((ev) => el.removeEventListener(ev, rmHl));
        el.removeEventListener('drop', onDrop);
      };
    };
    const c1 = wire(dropAreaRef.current);
    const c2 = wire(editorDropRef.current);
    return () => { c1(); c2(); };
  }, [handleFile]);

  // ── File input ─────────────────────────────────────────────────────────────
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const loadFromUrl = useCallback(() => {
    const url = urlInputRef.current?.value.trim();
    if (!url) return;
    setUploadError('');
    loaderRef.current?.loadImage(url);
  }, []);

  // ── Playback ───────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const anim = animationRef.current;
    if (!anim) return;
    if (playing) { anim.stop(); setPlaying(false); }
    else         { anim.play(); setPlaying(true); }
  }, [playing]);

  const seek = useCallback((delta) => {
    animationRef.current?.seek(delta);
    setPlaying(false);
  }, []);

  // ── Slider controls ────────────────────────────────────────────────────────
  const handleSlider = useCallback((gKey, setter, rawVal, { divisor = 1, min, max } = {}) => {
    const raw = parseInt(rawVal);
    const v = min !== undefined ? clamp(raw, min, max) : raw;
    g[gKey] = divisor !== 1 ? v / divisor : v;
    setter(v);
    animationRef.current?.tick();
  }, []);

  const handleFlip = useCallback(() => {
    const next = !flip;
    g.flip = next;
    setFlip(next);
    animationRef.current?.tick();
  }, [flip]);

  const handleAdjust = useCallback(() => {
    const next = !adjustMode;
    setAdjustMode(next);
    if (next) { animationRef.current?.stop(); setPlaying(false); }
    animationRef.current?.toggleAdjust(next);
  }, [adjustMode]);

  const handleFpsChange = useCallback((rawVal) => {
    const clamped = clamp(parseInt(rawVal) || INITIAL_FPS, 2, 60);
    setFps(clamped);
    const newDelay = ~~(1000 / clamped);
    if (newDelay !== g.delay) {
      g.delay = newDelay;
      animationRef.current?.restartIfPlaying();
    }
  }, []);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    Object.assign(g, DEFAULTS);
    animationRef.current?.refreshSprite();
    animationRef.current?.restartIfPlaying();
    if (!animationRef.current?.isPlaying()) animationRef.current?.tick();

    setScaleVal(~~(DEFAULTS.scale * 100));
    setSquishVal(~~(DEFAULTS.squish * 100));
    setSpriteX(DEFAULTS.spriteX);
    setSpriteY(DEFAULTS.spriteY);
    setFps(INITIAL_FPS);
    setFlip(DEFAULTS.flip);
    setAdjustMode(false);
  }, []);

  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <header>
        <div className="header-brand">
          <div className="brand-icon">✋</div>
          <h1>PetPet Generator</h1>
        </div>
        <button
          className="theme-toggle"
          title="테마 전환"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {/* preview img: 항상 DOM에 존재 (engine sprite 참조) */}
      <img ref={previewRef} style={{ display: 'none' }} alt="" />

      {/* 공유 파일 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={() => handleFile(fileInputRef.current?.files[0])}
      />

      {/* ── 빈 상태 ── */}
      <div className="empty-state" style={{ display: view === 'empty' ? 'flex' : 'none' }}>
        <p className="empty-title">PetPet GIF 만들기</p>
        <p className="empty-sub">이미지를 올리면 손이 쓰다듬는 GIF를 만들어드립니다</p>

        <div className="big-drop" ref={dropAreaRef} role="button" tabIndex={0} onClick={openFilePicker}>
          <span className="drop-icon">🖼</span>
          <span className="drop-text">클릭하거나 이미지를 드래그하세요</span>
          <span className="drop-hint">PNG · JPG · GIF · WebP</span>
        </div>

        <div className="or-row">또는</div>

        <div className="url-row">
          <input
            ref={urlInputRef}
            className="url-input"
            type="text"
            placeholder="이미지 URL 붙여넣기"
            onKeyDown={(e) => e.key === 'Enter' && loadFromUrl()}
          />
          <button className="btn btn-ghost" onClick={loadFromUrl}>불러오기</button>
        </div>
        {uploadError && <p className="upload-error">{uploadError}</p>}
      </div>

      {/* ── 에디터 (canvas를 항상 DOM에 유지하기 위해 display 토글) ── */}
      <div className="editor" style={{ display: view === 'editor' ? 'grid' : 'none' }}>

        {/* 캔버스 컬럼 */}
        <div className="canvas-col">
          <div className="canvas-card">
            <div className="canvas-frame">
              {/* canvasRef 단일 canvas: 항상 DOM에 존재 */}
              <canvas
                ref={canvasRef}
                width="112"
                height="112"
                className={`main-canvas${adjustMode ? ' adjust-mode' : ''}`}
              />
            </div>
            <div className="playback">
              <button className="play-btn" title="이전 프레임" onClick={() => seek(-1)}>⏮</button>
              <button
                className="play-btn play-btn-main"
                title="재생/정지"
                onClick={togglePlay}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <button className="play-btn" title="다음 프레임" onClick={() => seek(1)}>⏭</button>
            </div>
          </div>
        </div>

        {/* 컨트롤 컬럼 */}
        <div className="controls-col">

          {/* 이미지 변경 */}
          <div className="card">
            <p className="card-label">이미지</p>
            <div
              className="change-img-btn"
              ref={editorDropRef}
              role="button"
              tabIndex={0}
              onClick={openFilePicker}
            >
              <span style={{ fontSize: '15px' }}>🖼</span>
              <span className="upload-file-name">{fileName}</span>
            </div>
            {uploadError && <p className="upload-error">{uploadError}</p>}
          </div>

          {/* 조절 */}
          <div className="card">
            <p className="card-label">조절</p>

            <div className="control">
              <span className="ctrl-lbl">크기</span>
              <input type="range" min="20" max="200" value={scaleVal}
                onChange={(e) => handleSlider('scale', setScaleVal, e.target.value, { divisor: 100, min: 20, max: 200 })} />
              <span className="ctrl-val">{scaleVal}%</span>
            </div>
            <div className="control">
              <span className="ctrl-lbl">X 위치</span>
              <input type="range" min="-112" max="224" value={spriteX}
                onChange={(e) => handleSlider('spriteX', setSpriteX, e.target.value)} />
              <span className="ctrl-val">{spriteX}</span>
            </div>
            <div className="control">
              <span className="ctrl-lbl">Y 위치</span>
              <input type="range" min="-112" max="224" value={spriteY}
                onChange={(e) => handleSlider('spriteY', setSpriteY, e.target.value)} />
              <span className="ctrl-val">{spriteY}</span>
            </div>

            <div className="divider" />

            <div className="control">
              <span className="ctrl-lbl">눌림</span>
              <input type="range" min="100" max="300" value={squishVal}
                onChange={(e) => handleSlider('squish', setSquishVal, e.target.value, { divisor: 100, min: 100, max: 300 })} />
              <span className="ctrl-val">{squishVal}%</span>
            </div>

            <div className="divider" />

            <div className="toggle-row">
              <button
                className="toggle-btn"
                aria-pressed={String(flip)}
                onClick={handleFlip}
              >
                ↔ 좌우 반전
              </button>
              <button
                className="toggle-btn"
                aria-pressed={String(adjustMode)}
                onClick={handleAdjust}
              >
                ✥ 드래그 모드
              </button>
            </div>
          </div>

          {/* 재생 속도 */}
          <div className="card">
            <p className="card-label">재생 속도</p>
            <div className="control">
              <span className="ctrl-lbl">FPS</span>
              <input
                type="range"
                min="2"
                max="60"
                value={fps}
                onChange={(e) => handleFpsChange(e.target.value)}
              />
              <input
                type="number"
                className="fps-number"
                min="2"
                max="60"
                value={fps}
                onChange={(e) => handleFpsChange(e.target.value)}
              />
            </div>
          </div>

          {/* 내보내기 */}
          <div className="card">
            <p className="card-label">내보내기</p>
            <div className="export-row">
              <button className="btn btn-ghost" onClick={handleReset}>↩ 초기화</button>
              <button className="btn btn-accent" disabled={exporting} onClick={() => rendererRef.current?.render()}>
                {exportLabel}
              </button>
            </div>
            {exportInfo && <p className="export-info">{exportInfo}</p>}
          </div>

        </div>
      </div>

      {/* ── GIF 결과 오버레이 ── */}
      <div
        className={`overlay${overlayOpen ? ' open' : ''}`}
        onClick={(e) => e.target === e.currentTarget && closeOverlay()}
      >
        <div className="overlay-card">
          <div className="overlay-header">
            <span className="overlay-label">생성 완료</span>
            <span className="overlay-meta">{gifMeta}</span>
          </div>
          {gifUrl && <img className="result-img" src={gifUrl} alt="생성된 GIF" />}
          <div className="overlay-actions">
            <button className="btn btn-ghost" onClick={closeOverlay}>닫기</button>
            <a className="download-link" href={gifUrl} download="petpet.gif">⬇ 다운로드</a>
          </div>
        </div>
      </div>
    </>
  );
}
