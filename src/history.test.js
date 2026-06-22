import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  addToHistory,
  getHistory,
  removeFromHistory,
  clearHistory,
  MAX_HISTORY,
  _resetDB,
} from './history.js';

beforeEach(async () => {
  await _resetDB();
});

const makeBlob = (content = 'x') =>
  new Blob([content], { type: 'image/gif' });

// ── addToHistory ────────────────────────────────────────────────────────────

describe('addToHistory', () => {
  it('항목이 저장되고 getHistory에서 반환된다', async () => {
    await addToHistory(makeBlob(), { size: '1.0KB', duration: '0.50초' });
    const list = await getHistory();
    expect(list).toHaveLength(1);
    expect(list[0].size).toBe('1.0KB');
    expect(list[0].duration).toBe('0.50초');
  });

  it('createdAt이 Date 인스턴스로 저장된다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    const [item] = await getHistory();
    expect(item.createdAt).toBeInstanceOf(Date);
  });

  it('최신 항목이 목록 맨 앞에 위치한다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    await addToHistory(makeBlob(), { size: '2KB', duration: '0.2초' });
    const list = await getHistory();
    expect(list[0].size).toBe('2KB');
    expect(list[1].size).toBe('1KB');
  });

  it('Blob 내용이 손상 없이 저장·복원된다', async () => {
    const original = makeBlob('GIF89a-test-content');
    await addToHistory(original, { size: '0.1KB', duration: '0.01초' });
    const [item] = await getHistory();
    const text = await item.blob.text();
    expect(text).toBe('GIF89a-test-content');
  });

  it(`정확히 MAX_HISTORY(${MAX_HISTORY})개일 때는 eviction 없다`, async () => {
    for (let i = 1; i <= MAX_HISTORY; i++) {
      await addToHistory(makeBlob(), { size: `${i}KB`, duration: '0.1초' });
    }
    const list = await getHistory();
    expect(list).toHaveLength(MAX_HISTORY);
  });

  it(`MAX_HISTORY+1번째 추가 시 가장 오래된 항목 하나만 제거된다`, async () => {
    for (let i = 1; i <= MAX_HISTORY + 1; i++) {
      await addToHistory(makeBlob(), { size: `${i}KB`, duration: '0.1초' });
    }
    const list = await getHistory();
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].size).toBe(`${MAX_HISTORY + 1}KB`); // 최신
    expect(list[MAX_HISTORY - 1].size).toBe('2KB');     // 2번째가 가장 오래된 것
  });

  it(`MAX_HISTORY+2개 추가 시 처음 2개가 제거된다`, async () => {
    for (let i = 1; i <= MAX_HISTORY + 2; i++) {
      await addToHistory(makeBlob(), { size: `${i}KB`, duration: '0.1초' });
    }
    const list = await getHistory();
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].size).toBe(`${MAX_HISTORY + 2}KB`);
    expect(list[MAX_HISTORY - 1].size).toBe('3KB');
  });

  it('동시에 여러 개 추가해도 MAX_HISTORY를 초과하지 않는다', async () => {
    // 20개를 먼저 채운 뒤 5개를 동시에 추가
    for (let i = 1; i <= MAX_HISTORY; i++) {
      await addToHistory(makeBlob(), { size: `${i}KB`, duration: '0.1초' });
    }
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        addToHistory(makeBlob(), { size: `extra-${i}KB`, duration: '0.1초' })
      )
    );
    const list = await getHistory();
    expect(list.length).toBeLessThanOrEqual(MAX_HISTORY);
  });
});

// ── getHistory ──────────────────────────────────────────────────────────────

describe('getHistory', () => {
  it('비어있는 DB에서 빈 배열을 반환한다', async () => {
    const list = await getHistory();
    expect(list).toEqual([]);
  });

  it('각 항목에 id 필드가 존재한다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    const [item] = await getHistory();
    expect(item.id).toBeDefined();
  });
});

// ── removeFromHistory ───────────────────────────────────────────────────────

describe('removeFromHistory', () => {
  it('id로 특정 항목을 삭제한다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    await addToHistory(makeBlob(), { size: '2KB', duration: '0.2초' });
    const before = await getHistory();
    await removeFromHistory(before[1].id); // 오래된 것(1KB) 삭제
    const after = await getHistory();
    expect(after).toHaveLength(1);
    expect(after[0].size).toBe('2KB');
  });

  it('존재하지 않는 id로 호출해도 에러가 발생하지 않는다', async () => {
    await expect(removeFromHistory(99999)).resolves.not.toThrow();
  });

  it('삭제 후 나머지 항목 순서가 유지된다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    await addToHistory(makeBlob(), { size: '2KB', duration: '0.2초' });
    await addToHistory(makeBlob(), { size: '3KB', duration: '0.3초' });
    const before = await getHistory(); // [3KB, 2KB, 1KB]
    await removeFromHistory(before[1].id); // 2KB 삭제
    const after = await getHistory();
    expect(after).toHaveLength(2);
    expect(after[0].size).toBe('3KB');
    expect(after[1].size).toBe('1KB');
  });
});

// ── clearHistory ────────────────────────────────────────────────────────────

describe('clearHistory', () => {
  it('모든 항목을 삭제한다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    await addToHistory(makeBlob(), { size: '2KB', duration: '0.2초' });
    await clearHistory();
    expect(await getHistory()).toHaveLength(0);
  });

  it('이미 비어있는 DB에서 호출해도 에러가 발생하지 않는다', async () => {
    await expect(clearHistory()).resolves.not.toThrow();
  });

  it('clearHistory 후 새 항목을 정상적으로 추가할 수 있다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    await clearHistory();
    await addToHistory(makeBlob(), { size: '2KB', duration: '0.2초' });
    const list = await getHistory();
    expect(list).toHaveLength(1);
    expect(list[0].size).toBe('2KB');
  });
});
