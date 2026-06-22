import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Hand, Sun, Moon, Image as ImageIcon, SkipBack, Play, Pause, SkipForward,
  FlipHorizontal2, Move, RotateCcw, Download, Trash2, Pencil, Check, X as XIcon, ChevronRight,
} from 'lucide-react';
import {
  g, DEFAULTS, clamp, truncate,
  createDefaultSprite, ImageLoader, PetPetAnimation, GifRenderer,
} from './engine.js';
import {
  createProject,
  renameProject,
  addGifToProject,
  listProjects,
  getProjectGifs,
  removeProject,
  removeGif,
  clearAllProjects,
  MAX_GIFS_PER_PROJECT,
} from './history.js';

const INITIAL_FPS = Math.round(1000 / DEFAULTS.delay);
const ICON_SM = 14;
const ICON_MD = 16;

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

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

  // ── View ───────────────────────────────────────────────────────────────────
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

  // ── History (Project-based) ────────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [projectGifsMap, setProjectGifsMap] = useState({});
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const currentProjectIdRef = useRef(null);
  const gifUrlsRef = useRef(new Map());

  useEffect(() => {
    listProjects().then(setProjects);
    return () => { gifUrlsRef.current.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const handleExpandProject = useCallback(async (pid) => {
    if (expandedId === pid) { setExpandedId(null); return; }
    setExpandedId(pid);
    if (!projectGifsMap[pid]) {
      const gifs = await getProjectGifs(pid);
      const withUrls = gifs.map((gif) => {
        if (!gifUrlsRef.current.has(gif.id)) {
          gifUrlsRef.current.set(gif.id, URL.createObjectURL(gif.blob));
        }
        return {
          id: gif.id,
          url: gifUrlsRef.current.get(gif.id),
          size: gif.size,
          duration: gif.duration,
          createdAt: gif.createdAt,
        };
      });
      setProjectGifsMap((prev) => ({ ...prev, [pid]: withUrls }));
    }
  }, [expandedId, projectGifsMap]);

  const handleRemoveProject = useCallback(async (e, pid) => {
    e.stopPropagation();
    (projectGifsMap[pid] || []).forEach((gif) => {
      URL.revokeObjectURL(gifUrlsRef.current.get(gif.id));
      gifUrlsRef.current.delete(gif.id);
    });
    await removeProject(pid);
    setProjects((prev) => prev.filter((p) => p.id !== pid));
    setProjectGifsMap((prev) => { const next = { ...prev }; delete next[pid]; return next; });
    if (expandedId === pid) setExpandedId(null);
  }, [expandedId, projectGifsMap]);

  const handleRemoveGif = useCallback(async (e, gifId, pid) => {
    e.stopPropagation();
    URL.revokeObjectURL(gifUrlsRef.current.get(gifId));
    gifUrlsRef.current.delete(gifId);
    await removeGif(gifId);
    setProjectGifsMap((prev) => ({
      ...prev,
      [pid]: (prev[pid] || []).filter((gif) => gif.id !== gifId),
    }));
  }, []);

  const handleClearAll = useCallback(async () => {
    gifUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    gifUrlsRef.current.clear();
    await clearAllProjects();
    setProjects([]);
    setProjectGifsMap({});
    setExpandedId(null);
  }, []);

  const handleStartRename = useCallback((e, project) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditingName(project.name);
  }, []);

  const handleFinishRename = useCallback(async (id) => {
    const name = editingName.trim();
    if (name) {
      await renameProject(id, name);
      setProjects((prev) =>
        prev.map((p) => p.id === id ? { ...p, name, updatedAt: new Date() } : p),
      );
    }
    setEditingProjectId(null);
  }, [editingName]);

  const handleCancelRename = useCallback(() => setEditingProjectId(null), []);

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

    let cancelled = false;
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

        const pid = currentProjectIdRef.current;
        if (pid === null) return;

        addGifToProject(pid, blob, { size: `${size}KB`, duration: `${sec}초` }).then((gifId) => {
          const url = URL.createObjectURL(blob);
          gifUrlsRef.current.set(gifId, url);
          const now = new Date();
          setProjects((prev) =>
            prev.map((p) => p.id === pid ? { ...p, updatedAt: now } : p),
          );
          setProjectGifsMap((prev) => {
            if (prev[pid] === undefined) return prev;
            const newGif = { id: gifId, url, size: `${size}KB`, duration: `${sec}초`, createdAt: now };
            return { ...prev, [pid]: [newGif, ...prev[pid]].slice(0, MAX_GIFS_PER_PROJECT) };
          });
        });
      },
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
      },
    );

    hand.src = `${import.meta.env.BASE_URL}img/sprite.png`;
    loaderRef.current.loadImage(createDefaultSprite());

    return () => { cancelled = true; animation.destroy(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Image loading ──────────────────────────────────────────────────────────
  const startNewProject = useCallback(async (name, imageSource) => {
    setUploadError('');
    setFileName(truncate(name, 26));
    const id = await createProject(name);
    currentProjectIdRef.current = id;
    const now = new Date();
    setProjects((prev) => [{ id, name, createdAt: now, updatedAt: now }, ...prev]);
    loaderRef.current?.loadImage(imageSource);
  }, []);

  // ── Drop zone wiring ───────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    startNewProject(file.name || '이름 없는 이미지', URL.createObjectURL(file));
  }, [startNewProject]);

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

  // ── Clipboard paste ────────────────────────────────────────────────────────
  const handlePaste = useCallback((e) => {
    const item = Array.from(e.clipboardData?.items ?? [])
      .find((i) => i.type.startsWith('image/'));
    if (item) startNewProject('붙여넣은 이미지', URL.createObjectURL(item.getAsFile()));
  }, [startNewProject]);

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // ── File input ─────────────────────────────────────────────────────────────
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const loadFromUrl = useCallback(() => {
    const url = urlInputRef.current?.value.trim();
    if (!url) return;
    let name = '이름 없는 이미지';
    try {
      const pathname = new URL(url).pathname;
      const basename = pathname.split('/').pop();
      if (basename) name = decodeURIComponent(basename);
    } catch (_) {}
    startNewProject(name, url);
  }, [startNewProject]);

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
          <div className="brand-icon"><Hand size={ICON_MD} /></div>
          <h1>PetPet Generator</h1>
        </div>
        <button
          className="theme-toggle"
          title="테마 전환"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? <Sun size={ICON_MD} /> : <Moon size={ICON_MD} />}
        </button>
      </header>

      <img ref={previewRef} style={{ display: 'none' }} alt="" />
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
          <ImageIcon className="drop-icon" size={36} strokeWidth={1.25} />
          <span className="drop-text">클릭하거나 드래그 / 붙여넣기(Ctrl+V)하세요</span>
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

      {/* ── 에디터 ── */}
      <div className="editor" style={{ display: view === 'editor' ? 'grid' : 'none' }}>

        {/* 캔버스 컬럼 */}
        <div className="canvas-col">
          <div className="canvas-card">
            <div className="canvas-frame">
              <canvas
                ref={canvasRef}
                width="112"
                height="112"
                className={`main-canvas${adjustMode ? ' adjust-mode' : ''}`}
              />
            </div>
            <div className="playback">
              <button className="play-btn" title="이전 프레임" onClick={() => seek(-1)}>
                <SkipBack size={ICON_MD} />
              </button>
              <button className="play-btn play-btn-main" title="재생/정지" onClick={togglePlay}>
                {playing ? <Pause size={ICON_MD} /> : <Play size={ICON_MD} />}
              </button>
              <button className="play-btn" title="다음 프레임" onClick={() => seek(1)}>
                <SkipForward size={ICON_MD} />
              </button>
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
              <ImageIcon size={ICON_MD} />
              <span className="upload-file-name">{fileName}</span>
              <span className="drop-hint">Ctrl+V</span>
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
              <button className="toggle-btn" aria-pressed={String(flip)} onClick={handleFlip}>
                <FlipHorizontal2 size={ICON_SM} /> 좌우 반전
              </button>
              <button className="toggle-btn" aria-pressed={String(adjustMode)} onClick={handleAdjust}>
                <Move size={ICON_SM} /> 드래그 모드
              </button>
            </div>
          </div>

          {/* 재생 속도 */}
          <div className="card">
            <p className="card-label">재생 속도</p>
            <div className="control">
              <span className="ctrl-lbl">FPS</span>
              <input type="range" min="2" max="60" value={fps}
                onChange={(e) => handleFpsChange(e.target.value)} />
              <input type="number" className="fps-number" min="2" max="60" value={fps}
                onChange={(e) => handleFpsChange(e.target.value)} />
            </div>
          </div>

          {/* 내보내기 */}
          <div className="card">
            <p className="card-label">내보내기</p>
            <div className="export-row">
              <button className="btn btn-ghost" onClick={handleReset}><RotateCcw size={ICON_SM} /> 초기화</button>
              <button className="btn btn-accent" disabled={exporting} onClick={() => rendererRef.current?.render()}>
                {exportLabel}
              </button>
            </div>
            {exportInfo && <p className="export-info">{exportInfo}</p>}
          </div>

          {/* 프로젝트 히스토리 */}
          <div className="card">
            <div className="card-label-row">
              <p className="card-label">프로젝트</p>
              {projects.length > 0 && (
                <button className="btn-xs" onClick={handleClearAll}>전체 삭제</button>
              )}
            </div>
            {projects.length === 0 ? (
              <p className="history-empty">저장된 프로젝트가 없습니다</p>
            ) : (
              <div className="project-list">
                {projects.map((project) => {
                  const isExpanded = expandedId === project.id;
                  const isEditing  = editingProjectId === project.id;
                  const gifs       = projectGifsMap[project.id];

                  return (
                    <div key={project.id} className={`project-item${isExpanded ? ' expanded' : ''}`}>
                      <div
                        className="project-header"
                        onClick={() => !isEditing && handleExpandProject(project.id)}
                      >
                        <ChevronRight size={12} className="project-chevron" />

                        <div className="project-name-wrap">
                          {isEditing ? (
                            <>
                              <input
                                className="project-name-input"
                                value={editingName}
                                autoFocus
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleFinishRename(project.id);
                                  if (e.key === 'Escape') handleCancelRename();
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button
                                className="project-rename-action-btn confirm"
                                title="확인"
                                onClick={(e) => { e.stopPropagation(); handleFinishRename(project.id); }}
                              >
                                <Check size={11} />
                              </button>
                              <button
                                className="project-rename-action-btn cancel"
                                title="취소"
                                onClick={(e) => { e.stopPropagation(); handleCancelRename(); }}
                              >
                                <XIcon size={11} />
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="project-name" title={project.name}>{project.name}</span>
                              <button
                                className="project-rename-btn"
                                title="이름 수정"
                                onClick={(e) => handleStartRename(e, project)}
                              >
                                <Pencil size={10} />
                              </button>
                            </>
                          )}
                        </div>

                        <div className="project-dates">
                          <div>생성 {fmtDate(project.createdAt)}</div>
                          <div>수정 {fmtDate(project.updatedAt)}</div>
                        </div>

                        {!isEditing && (
                          <button
                            className="project-del-btn"
                            title="프로젝트 삭제"
                            onClick={(e) => handleRemoveProject(e, project.id)}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="project-gifs">
                          {!gifs ? (
                            <p className="history-empty">불러오는 중…</p>
                          ) : gifs.length === 0 ? (
                            <p className="history-empty">GIF가 없습니다</p>
                          ) : (
                            <div className="history-grid">
                              {gifs.map((gif) => (
                                <div className="history-item" key={gif.id}>
                                  <img src={gif.url} alt="gif" />
                                  <div className="history-item-overlay">
                                    <a
                                      className="history-item-btn dl"
                                      href={gif.url}
                                      download={`petpet-${gif.id}.gif`}
                                      title="다운로드"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Download size={12} />
                                    </a>
                                    <button
                                      className="history-item-btn del"
                                      title="삭제"
                                      onClick={(e) => handleRemoveGif(e, gif.id, project.id)}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                    <span className="history-meta">{gif.size}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
            <a className="download-link" href={gifUrl} download="petpet.gif">
              <Download size={ICON_SM} /> 다운로드
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
