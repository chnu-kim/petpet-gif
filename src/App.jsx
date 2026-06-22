import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Hand, Sun, Moon, Image as ImageIcon, SkipBack, Play, Pause, SkipForward,
  FlipHorizontal2, Move, RotateCcw, Download, Trash2, Pencil, Check, X as XIcon,
  ChevronRight, PanelLeftClose, PanelLeftOpen, Plus,
} from 'lucide-react';
import {
  g, DEFAULTS, clamp, truncate,
  createDefaultSprite, ImageLoader, PetPetAnimation, GifRenderer,
} from './engine.js';
import {
  createProject,
  renameProject,
  updateProjectSnapshot,
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

async function blobFromSource(src) {
  try {
    const res = await fetch(src);
    return await res.blob();
  } catch {
    return null;
  }
}

function captureSettings() {
  return {
    scale:   g.scale,
    squish:  g.squish,
    spriteX: g.spriteX,
    spriteY: g.spriteY,
    delay:   g.delay,
    flip:    g.flip,
  };
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

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    localStorage.getItem('petpet-sidebar') !== 'closed'
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      const next = !v;
      localStorage.setItem('petpet-sidebar', next ? 'open' : 'closed');
      return next;
    });
  }, []);

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

  // ── Confirm modal ──────────────────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState(null);

  const askConfirm = useCallback((message, onConfirm) => {
    setConfirmModal({ message, onConfirm });
  }, []);

  const closeConfirm = useCallback(() => setConfirmModal(null), []);

  const handleConfirm = useCallback(() => {
    const fn = confirmModal?.onConfirm;
    closeConfirm();
    fn?.();
  }, [confirmModal, closeConfirm]);

  // ── History (Project-based) ────────────────────────────────────────────────
  const [projects, setProjects]               = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [expandedId, setExpandedId]           = useState(null);
  const [projectGifsMap, setProjectGifsMap]   = useState({});
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingName, setEditingName]         = useState('');

  const currentProjectIdRef = useRef(null);
  const currentImageBlobRef = useRef(null);
  const gifUrlsRef          = useRef(new Map());

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
        return { id: gif.id, url: gifUrlsRef.current.get(gif.id), size: gif.size, duration: gif.duration, createdAt: gif.createdAt };
      });
      setProjectGifsMap((prev) => ({ ...prev, [pid]: withUrls }));
    }
  }, [expandedId, projectGifsMap]);

  const handleRemoveProject = useCallback((e, pid) => {
    e.stopPropagation();
    askConfirm('이 프로젝트를 삭제하시겠습니까?\n포함된 GIF도 모두 삭제됩니다.', async () => {
      (projectGifsMap[pid] || []).forEach((gif) => {
        URL.revokeObjectURL(gifUrlsRef.current.get(gif.id));
        gifUrlsRef.current.delete(gif.id);
      });
      await removeProject(pid);
      setProjects((prev) => prev.filter((p) => p.id !== pid));
      setProjectGifsMap((prev) => { const next = { ...prev }; delete next[pid]; return next; });
      if (expandedId === pid) setExpandedId(null);
      if (currentProjectIdRef.current === pid) {
        currentProjectIdRef.current = null;
        currentImageBlobRef.current = null;
        setActiveProjectId(null);
      }
    });
  }, [expandedId, projectGifsMap, askConfirm]);

  const handleRemoveGif = useCallback((e, gifId, pid) => {
    e.stopPropagation();
    askConfirm('이 GIF를 삭제하시겠습니까?', async () => {
      URL.revokeObjectURL(gifUrlsRef.current.get(gifId));
      gifUrlsRef.current.delete(gifId);
      await removeGif(gifId);
      setProjectGifsMap((prev) => ({
        ...prev,
        [pid]: (prev[pid] || []).filter((gif) => gif.id !== gifId),
      }));
    });
  }, [askConfirm]);

  const handleClearAll = useCallback(() => {
    askConfirm('모든 프로젝트와 GIF를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.', async () => {
      gifUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      gifUrlsRef.current.clear();
      await clearAllProjects();
      setProjects([]);
      setProjectGifsMap({});
      setExpandedId(null);
      currentProjectIdRef.current = null;
      currentImageBlobRef.current = null;
      setActiveProjectId(null);
    });
  }, [askConfirm]);

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
  const canvasRef     = useRef(null);
  const previewRef    = useRef(null);
  const fileInputRef  = useRef(null);
  const urlInputRef   = useRef(null);
  const dropAreaRef   = useRef(null);
  const editorDropRef = useRef(null);

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

        updateProjectSnapshot(pid, currentImageBlobRef.current, captureSettings());

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

  // ── Settings ───────────────────────────────────────────────────────────────
  const applySettings = useCallback((settings) => {
    if (!settings) return;
    Object.assign(g, settings);
    animationRef.current?.refreshSprite();
    setScaleVal(~~(settings.scale * 100));
    setSquishVal(~~(settings.squish * 100));
    setSpriteX(settings.spriteX);
    setSpriteY(settings.spriteY);
    setFps(Math.round(1000 / settings.delay));
    setFlip(settings.flip);
    animationRef.current?.restartIfPlaying?.();
    if (!animationRef.current?.isPlaying?.()) animationRef.current?.tick?.();
  }, []);

  // ── 이미지를 현재 프로젝트에 설정 (없으면 새 프로젝트 생성) ──────────────────
  const loadImageIntoProject = useCallback(async (name, imageSource) => {
    setUploadError('');
    setFileName(truncate(name, 26));

    const imageBlob = await blobFromSource(imageSource);
    currentImageBlobRef.current = imageBlob;

    const pid = currentProjectIdRef.current;
    if (pid !== null) {
      await updateProjectSnapshot(pid, imageBlob, captureSettings());
      setProjects((prev) => prev.map((p) =>
        p.id === pid ? { ...p, imageBlob, updatedAt: new Date() } : p,
      ));
    } else {
      const id = await createProject(name, imageBlob, captureSettings());
      currentProjectIdRef.current = id;
      setActiveProjectId(id);
      const now = new Date();
      setProjects((prev) => [{ id, name, imageBlob, settings: captureSettings(), createdAt: now, updatedAt: now }, ...prev]);
    }

    loaderRef.current?.loadImage(imageSource);
  }, []);

  // ── 새 프로젝트 생성 (이미지 없이) ────────────────────────────────────────
  const handleNewProject = useCallback(async () => {
    const prevPid = currentProjectIdRef.current;
    if (prevPid !== null) {
      await updateProjectSnapshot(prevPid, currentImageBlobRef.current, captureSettings());
    }

    Object.assign(g, DEFAULTS);
    setScaleVal(~~(DEFAULTS.scale * 100));
    setSquishVal(~~(DEFAULTS.squish * 100));
    setSpriteX(DEFAULTS.spriteX);
    setSpriteY(DEFAULTS.spriteY);
    setFps(INITIAL_FPS);
    setFlip(DEFAULTS.flip);
    setAdjustMode(false);

    const name = '새 프로젝트';
    const settings = captureSettings();
    const id = await createProject(name, null, settings);
    currentProjectIdRef.current = id;
    currentImageBlobRef.current = null;
    setActiveProjectId(id);
    setFileName('이미지 없음');

    const now = new Date();
    setProjects((prev) => [{ id, name, imageBlob: null, settings, createdAt: now, updatedAt: now }, ...prev]);

    loaderRef.current?.loadImage(createDefaultSprite());
  }, []);

  // ── 프로젝트 전환 (이미지 + 설정 복원) ─────────────────────────────────────
  const handleSwitchProject = useCallback(async (project) => {
    if (project.id === currentProjectIdRef.current) return;

    const prevPid = currentProjectIdRef.current;
    if (prevPid !== null) {
      await updateProjectSnapshot(prevPid, currentImageBlobRef.current, captureSettings());
      setProjects((prev) => prev.map((p) =>
        p.id === prevPid ? { ...p, settings: captureSettings(), updatedAt: new Date() } : p,
      ));
    }

    currentProjectIdRef.current = project.id;
    setActiveProjectId(project.id);
    setFileName(project.imageBlob ? truncate(project.name, 26) : '이미지 없음');

    if (project.settings) applySettings(project.settings);
    else Object.assign(g, DEFAULTS);

    if (project.imageBlob) {
      const url = URL.createObjectURL(project.imageBlob);
      currentImageBlobRef.current = project.imageBlob;
      loaderRef.current?.loadImage(url);
    } else {
      currentImageBlobRef.current = null;
      loaderRef.current?.loadImage(createDefaultSprite());
    }
  }, [applySettings]);

  // ── Drop zone wiring ───────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    loadImageIntoProject(file.name || '이름 없는 이미지', URL.createObjectURL(file));
  }, [loadImageIntoProject]);

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
    if (item) loadImageIntoProject('붙여넣은 이미지', URL.createObjectURL(item.getAsFile()));
  }, [loadImageIntoProject]);

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
    loadImageIntoProject(name, url);
  }, [loadImageIntoProject]);

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
        <div className="header-left">
          <button className="sidebar-toggle" title={sidebarOpen ? '사이드바 닫기' : '사이드바 열기'} onClick={toggleSidebar}>
            {sidebarOpen ? <PanelLeftClose size={ICON_MD} /> : <PanelLeftOpen size={ICON_MD} />}
          </button>
          <div className="header-brand">
            <div className="brand-icon"><Hand size={ICON_MD} /></div>
            <h1>PetPet Generator</h1>
          </div>
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

      <div className="app-body">
        {/* ── 사이드바 ── */}
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-header">
            <span className="sidebar-title">프로젝트</span>
            <div className="sidebar-header-actions">
              <button className="sidebar-new-btn" title="새 프로젝트" onClick={handleNewProject}>
                <Plus size={13} />
              </button>
              {projects.length > 0 && (
                <button className="btn-xs" onClick={handleClearAll}>전체 삭제</button>
              )}
            </div>
          </div>
          <div className="sidebar-list">
            {projects.length === 0 ? (
              <p className="sidebar-empty">저장된 프로젝트가 없습니다</p>
            ) : (
              projects.map((project) => {
                const isActive   = activeProjectId === project.id;
                const isExpanded = expandedId === project.id;
                const isEditing  = editingProjectId === project.id;
                const gifs       = projectGifsMap[project.id];

                return (
                  <div key={project.id} className={`sidebar-project${isActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}`}>
                    <div
                      className="sidebar-project-header"
                      onClick={() => {
                        if (isEditing) return;
                        handleSwitchProject(project);
                        handleExpandProject(project.id);
                      }}
                    >
                      <ChevronRight size={11} className="sidebar-chevron" />

                      <div className="sidebar-name-wrap">
                        {isEditing ? (
                          <>
                            <input
                              className="sidebar-name-input"
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
                              className="sidebar-rename-btn confirm"
                              title="확인"
                              onClick={(e) => { e.stopPropagation(); handleFinishRename(project.id); }}
                            >
                              <Check size={10} />
                            </button>
                            <button
                              className="sidebar-rename-btn cancel"
                              title="취소"
                              onClick={(e) => { e.stopPropagation(); handleCancelRename(); }}
                            >
                              <XIcon size={10} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="sidebar-name" title={project.name}>{project.name}</span>
                            <button
                              className="sidebar-pencil-btn"
                              title="이름 수정"
                              onClick={(e) => handleStartRename(e, project)}
                            >
                              <Pencil size={10} />
                            </button>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <button
                          className="sidebar-del-btn"
                          title="삭제"
                          onClick={(e) => handleRemoveProject(e, project.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>

                    <div className="sidebar-dates">
                      <span>생성 {fmtDate(project.createdAt)}</span>
                      <span>수정 {fmtDate(project.updatedAt)}</span>
                    </div>

                    {isExpanded && (
                      <div className="sidebar-gifs">
                        {!gifs ? (
                          <p className="sidebar-empty-sm">불러오는 중…</p>
                        ) : gifs.length === 0 ? (
                          <p className="sidebar-empty-sm">GIF가 없습니다</p>
                        ) : (
                          <div className="sidebar-gif-grid">
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
              })
            )}
          </div>
        </aside>

        {/* ── 메인 콘텐츠 ── */}
        <main className="main-content">
          {/* 빈 상태 */}
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

          {/* 에디터 */}
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

            </div>
          </div>
        </main>
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

      {/* ── 삭제 확인 모달 ── */}
      {confirmModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && closeConfirm()}>
          <div className="overlay-card confirm-card">
            <p className="confirm-message">{confirmModal.message}</p>
            <div className="overlay-actions">
              <button className="btn btn-ghost" onClick={closeConfirm}>취소</button>
              <button className="btn btn-danger" onClick={handleConfirm}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
