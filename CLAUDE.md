# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개발 서버

```bash
python3 -m http.server 8765
# → http://localhost:8765
```

빌드 스텝 없음. 파일 수정 후 브라우저 새로고침으로 즉시 확인.

## 워크플로우

부모 디렉토리의 `../CLAUDE.md` 워크플로우를 따른다:

- `git checkout -b <branch>` → `git worktree add <path> <branch>` → 작업 → PR
- `gh auth switch --user chnu-kim` 후 `gh pr create`
- **절대 main에서 직접 작업하지 않는다**

## 코드 구조

파일 구성:
- `index.html` — 전체 UI + 인라인 CSS (테마 변수, sticky 레이아웃, 체커보드 배경)
- `main.js` — 애니메이션 로직 전체 (단일 IIFE)
- `gif.js` / `gif.worker.js` — GIF 인코더 (benisland에서 가져온 외부 라이브러리, 수정 금지)
- `requestInterval.js` — RAF 기반 `setInterval` 폴리필 (외부 라이브러리, 수정 금지)
- `img/sprite.png` — 손 스프라이트 시트 560×112 (5프레임 × 112px)
- `img/sample.png` — 기본 샘플 이미지

### main.js 구조

```
[모듈 상수] MAX_FRAME=4, OUT_SIZE=112, DEFAULTS, GIF_RENDERER_OPTIONS
[전역 상태] g = { ...DEFAULTS }  ← 모든 애니메이션 파라미터 공유 객체
IIFE {
  ImageLoader(onLoad, onError)   ← 이미지 로드·캐싱 팩토리
  PetPetAnimation(canvas, hand, sprite, callbacks)  ← 렌더/재생/드래그 팩토리
  GifRenderer(animation, onStart, onProgress, onFinish)  ← GIF 인코딩 팩토리
  DOMContentLoaded {
    슬라이더·드롭존·버튼 이벤트 연결
  }
}
```

### 핵심 렌더링 흐름

`frameOffsets[5]` → `getSpriteFrame(frame)` → `renderFrame(frame, ctx, showAdjust)`

- 피사체 이미지: `translate(dx, dy)` + `drawImage(sprite, 0, 0, dw, dh)` (flip 시 `scale(-1,1)`)
- 손 스프라이트: `drawImage(hand, frame*112, 0, 112, 112, 0, handY, 112, 112)`
  - `handY = Math.max(0, ~~(cf.dy * 0.75 - Math.max(0, g.spriteY) - 0.5))`

### GIF 투명도 처리

`gif.js`는 그린 크로마키를 투명으로 처리한다 (`transparent: 0x00ff00`).  
`fixTransparency(data)`: alpha < 120 픽셀 → `rgb(0,255,0)`, 순수 녹색(g > 250) 클램프, 전체 alpha → 255.

### CSS 레이아웃

- 두 컬럼 그리드: 캔버스 360px(sticky) + 컨트롤 1fr(자연 스크롤)
- `.canvas-section`: `position: sticky; top: calc(52px + 16px); align-self: start`
- 다크/라이트 테마: `[data-theme]` 속성 + CSS 변수, `localStorage("petpet-theme")` 저장
- `#result`(생성된 GIF): 224×224px, 빨간 3px 테두리, 체커보드 배경(투명 영역 시각화)
