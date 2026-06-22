import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetDB,
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

beforeEach(async () => {
  await _resetDB();
});

// ── createProject ───────────────────────────────────────────────
describe('createProject', () => {
  it('이름으로 프로젝트를 생성하고 id를 반환한다', async () => {
    const id = await createProject('cat.png');
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('createdAt과 updatedAt이 동일한 Date 객체로 설정된다', async () => {
    await createProject('cat.png');
    const [project] = await listProjects();
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toBeInstanceOf(Date);
    expect(project.createdAt.getTime()).toBe(project.updatedAt.getTime());
  });

  it('여러 프로젝트를 독립적으로 생성한다', async () => {
    const id1 = await createProject('a.png');
    const id2 = await createProject('b.png');
    expect(id1).not.toBe(id2);
    const projects = await listProjects();
    expect(projects).toHaveLength(2);
  });
});

// ── renameProject ───────────────────────────────────────────────
describe('renameProject', () => {
  it('프로젝트 이름을 변경한다', async () => {
    const id = await createProject('old.png');
    await renameProject(id, '새 이름');
    const [project] = await listProjects();
    expect(project.name).toBe('새 이름');
  });

  it('이름 변경 시 updatedAt이 갱신된다', async () => {
    const id = await createProject('old.png');
    const [before] = await listProjects();
    await new Promise((r) => setTimeout(r, 5));
    await renameProject(id, '새 이름');
    const [after] = await listProjects();
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('이름 변경 후 createdAt은 변하지 않는다', async () => {
    const id = await createProject('old.png');
    const [before] = await listProjects();
    await new Promise((r) => setTimeout(r, 5));
    await renameProject(id, '새 이름');
    const [after] = await listProjects();
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
  });

  it('없는 id는 오류 없이 무시된다', async () => {
    await expect(renameProject(9999, '없는 프로젝트')).resolves.toBeUndefined();
  });

  it('이름 변경 후 listProjects 순서가 바뀌지 않는다', async () => {
    const id1 = await createProject('first.png');
    const id2 = await createProject('second.png');
    await renameProject(id1, '변경된 이름');
    const projects = await listProjects();
    expect(projects[0].id).toBe(id2);
    expect(projects[1].id).toBe(id1);
    expect(projects[1].name).toBe('변경된 이름');
  });
});

// ── addGifToProject ─────────────────────────────────────────────
describe('addGifToProject', () => {
  it('GIF를 추가하고 새 gifId를 반환한다', async () => {
    const pid = await createProject('cat.png');
    const blob = new Blob(['gif'], { type: 'image/gif' });
    const gifId = await addGifToProject(pid, blob, { size: '12KB', duration: '2초' });
    expect(typeof gifId).toBe('number');
    expect(gifId).toBeGreaterThan(0);
  });

  it('GIF 추가 후 프로젝트 updatedAt이 갱신된다', async () => {
    const pid = await createProject('cat.png');
    const [before] = await listProjects();
    await new Promise((r) => setTimeout(r, 5));
    await addGifToProject(pid, new Blob(['gif']), { size: '12KB', duration: '2초' });
    const [after] = await listProjects();
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('GIF에 createdAt이 기록된다', async () => {
    const pid = await createProject('cat.png');
    await addGifToProject(pid, new Blob(['gif']), { size: '12KB', duration: '2초' });
    const gifs = await getProjectGifs(pid);
    expect(gifs[0].createdAt).toBeInstanceOf(Date);
  });

  it('Blob 원본을 손상 없이 저장한다', async () => {
    const pid = await createProject('cat.png');
    const original = new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: 'image/gif' });
    const gifId = await addGifToProject(pid, original, {});
    const gifs = await getProjectGifs(pid);
    const stored = gifs.find((g) => g.id === gifId);
    const buf = await stored.blob.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([0x47, 0x49, 0x46]));
  });

  it(`MAX_GIFS_PER_PROJECT(${MAX_GIFS_PER_PROJECT}) 정확히 채웠을 때 삭제 안 됨`, async () => {
    const pid = await createProject('cat.png');
    for (let i = 0; i < MAX_GIFS_PER_PROJECT; i++) {
      await addGifToProject(pid, new Blob([String(i)]), {});
    }
    const gifs = await getProjectGifs(pid);
    expect(gifs).toHaveLength(MAX_GIFS_PER_PROJECT);
  });

  it(`MAX_GIFS_PER_PROJECT 초과 시 가장 오래된 GIF가 삭제된다`, async () => {
    const pid = await createProject('cat.png');
    for (let i = 0; i <= MAX_GIFS_PER_PROJECT; i++) {
      await addGifToProject(pid, new Blob([String(i)]), { size: `${i}KB` });
    }
    const gifs = await getProjectGifs(pid);
    expect(gifs).toHaveLength(MAX_GIFS_PER_PROJECT);
    // 가장 최신 항목이 맨 앞
    expect(gifs[0].size).toBe(`${MAX_GIFS_PER_PROJECT}KB`);
  });

  it('MAX+3 추가해도 개수는 MAX를 유지하고 최신 순 정렬된다', async () => {
    const pid = await createProject('cat.png');
    const TOTAL = MAX_GIFS_PER_PROJECT + 3;
    for (let i = 0; i < TOTAL; i++) {
      await addGifToProject(pid, new Blob([String(i)]), { size: `${i}KB` });
    }
    const gifs = await getProjectGifs(pid);
    expect(gifs).toHaveLength(MAX_GIFS_PER_PROJECT);
    // 가장 최신 3개(TOTAL-1, TOTAL-2, TOTAL-3)가 앞에 있어야 함
    expect(gifs[0].size).toBe(`${TOTAL - 1}KB`);
    expect(gifs[1].size).toBe(`${TOTAL - 2}KB`);
    expect(gifs[2].size).toBe(`${TOTAL - 3}KB`);
  });

  it('eviction은 해당 프로젝트 내에서만 발생한다', async () => {
    const pid1 = await createProject('a.png');
    const pid2 = await createProject('b.png');
    for (let i = 0; i <= MAX_GIFS_PER_PROJECT; i++) {
      await addGifToProject(pid1, new Blob([String(i)]), {});
    }
    await addGifToProject(pid2, new Blob(['x']), {});
    const gifs2 = await getProjectGifs(pid2);
    expect(gifs2).toHaveLength(1);
  });
});

// ── listProjects ────────────────────────────────────────────────
describe('listProjects', () => {
  it('DB가 비어 있으면 빈 배열을 반환한다', async () => {
    expect(await listProjects()).toEqual([]);
  });

  it('최신 생성 순으로 정렬된다', async () => {
    await createProject('first.png');
    await createProject('second.png');
    const projects = await listProjects();
    expect(projects[0].name).toBe('second.png');
    expect(projects[1].name).toBe('first.png');
  });

  it('id, name, createdAt, updatedAt 필드를 포함한다', async () => {
    await createProject('check.png');
    const [p] = await listProjects();
    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('name');
    expect(p).toHaveProperty('createdAt');
    expect(p).toHaveProperty('updatedAt');
  });
});

// ── getProjectGifs ──────────────────────────────────────────────
describe('getProjectGifs', () => {
  it('없는 프로젝트는 빈 배열을 반환한다', async () => {
    expect(await getProjectGifs(9999)).toEqual([]);
  });

  it('GIF 없는 프로젝트는 빈 배열을 반환한다', async () => {
    const pid = await createProject('empty.png');
    expect(await getProjectGifs(pid)).toEqual([]);
  });

  it('최신 생성 순으로 정렬된다', async () => {
    const pid = await createProject('cat.png');
    await addGifToProject(pid, new Blob(['a']), { size: '1KB' });
    await addGifToProject(pid, new Blob(['b']), { size: '2KB' });
    const gifs = await getProjectGifs(pid);
    expect(gifs[0].size).toBe('2KB');
    expect(gifs[1].size).toBe('1KB');
  });

  it('다른 프로젝트의 GIF는 포함되지 않는다', async () => {
    const pid1 = await createProject('a.png');
    const pid2 = await createProject('b.png');
    await addGifToProject(pid1, new Blob(['a']), { size: '1KB' });
    await addGifToProject(pid2, new Blob(['b']), { size: '2KB' });
    const gifs1 = await getProjectGifs(pid1);
    expect(gifs1).toHaveLength(1);
    expect(gifs1[0].size).toBe('1KB');
  });
});

// ── removeProject ───────────────────────────────────────────────
describe('removeProject', () => {
  it('프로젝트와 하위 GIF를 모두 삭제한다', async () => {
    const pid = await createProject('cat.png');
    await addGifToProject(pid, new Blob(['g']), {});
    await removeProject(pid);
    expect(await listProjects()).toHaveLength(0);
    expect(await getProjectGifs(pid)).toHaveLength(0);
  });

  it('다른 프로젝트와 그 GIF는 영향 받지 않는다', async () => {
    const pid1 = await createProject('a.png');
    const pid2 = await createProject('b.png');
    await addGifToProject(pid1, new Blob(['a']), {});
    await addGifToProject(pid2, new Blob(['b']), {});
    await removeProject(pid1);
    const remaining = await listProjects();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(pid2);
    expect(await getProjectGifs(pid2)).toHaveLength(1);
  });

  it('GIF가 여러 개인 프로젝트 삭제 시 모든 GIF가 삭제된다', async () => {
    const pid = await createProject('cat.png');
    for (let i = 0; i < 3; i++) {
      await addGifToProject(pid, new Blob([String(i)]), {});
    }
    await removeProject(pid);
    expect(await getProjectGifs(pid)).toHaveLength(0);
  });

  it('GIF 없는 프로젝트 삭제도 오류 없이 완료된다', async () => {
    const pid = await createProject('empty.png');
    await removeProject(pid);
    expect(await listProjects()).toHaveLength(0);
  });

  it('없는 id는 오류 없이 무시된다', async () => {
    await expect(removeProject(9999)).resolves.toBeUndefined();
  });
});

// ── removeGif ───────────────────────────────────────────────────
describe('removeGif', () => {
  it('GIF만 삭제하고 프로젝트는 유지된다', async () => {
    const pid = await createProject('cat.png');
    const gifId = await addGifToProject(pid, new Blob(['g']), {});
    await removeGif(gifId);
    expect(await listProjects()).toHaveLength(1);
    expect(await getProjectGifs(pid)).toHaveLength(0);
  });

  it('다른 GIF는 영향 받지 않는다', async () => {
    const pid = await createProject('cat.png');
    const gid1 = await addGifToProject(pid, new Blob(['a']), { size: '1KB' });
    await addGifToProject(pid, new Blob(['b']), { size: '2KB' });
    await removeGif(gid1);
    const gifs = await getProjectGifs(pid);
    expect(gifs).toHaveLength(1);
    expect(gifs[0].size).toBe('2KB');
  });

  it('없는 id는 오류 없이 무시된다', async () => {
    await expect(removeGif(9999)).resolves.toBeUndefined();
  });
});

// ── clearAllProjects ────────────────────────────────────────────
describe('clearAllProjects', () => {
  it('프로젝트와 GIF를 모두 삭제한다', async () => {
    const pid1 = await createProject('a.png');
    const pid2 = await createProject('b.png');
    await addGifToProject(pid1, new Blob(['a']), {});
    await addGifToProject(pid2, new Blob(['b']), {});
    await clearAllProjects();
    expect(await listProjects()).toHaveLength(0);
    expect(await getProjectGifs(pid1)).toHaveLength(0);
    expect(await getProjectGifs(pid2)).toHaveLength(0);
  });

  it('빈 DB에서 호출해도 오류 없음', async () => {
    await expect(clearAllProjects()).resolves.toBeUndefined();
  });

  it('clear 후 새 프로젝트 추가 가능', async () => {
    await createProject('before.png');
    await clearAllProjects();
    const id = await createProject('after.png');
    expect(typeof id).toBe('number');
    expect(await listProjects()).toHaveLength(1);
  });
});
