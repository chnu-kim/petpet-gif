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

const makeBlob = (size = 100) => new Blob([new Uint8Array(size)], { type: 'image/gif' });

describe('addToHistory', () => {
  it('항목이 저장되고 getHistory에서 반환된다', async () => {
    const blob = makeBlob();
    await addToHistory(blob, { size: '1.0KB', duration: '0.50초' });
    const list = await getHistory();
    expect(list).toHaveLength(1);
    expect(list[0].size).toBe('1.0KB');
    expect(list[0].duration).toBe('0.50초');
  });

  it('createdAt이 저장된다', async () => {
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

  it(`MAX_HISTORY(${MAX_HISTORY})개 초과 시 가장 오래된 항목이 제거된다`, async () => {
    for (let i = 1; i <= MAX_HISTORY + 2; i++) {
      await addToHistory(makeBlob(), { size: `${i}KB`, duration: '0.1초' });
    }
    const list = await getHistory();
    expect(list).toHaveLength(MAX_HISTORY);
    // 가장 최신(MAX_HISTORY+2) ~ (3)번째가 남아야 함
    expect(list[0].size).toBe(`${MAX_HISTORY + 2}KB`);
    expect(list[MAX_HISTORY - 1].size).toBe('3KB');
  });
});

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
});

describe('clearHistory', () => {
  it('모든 항목을 삭제한다', async () => {
    await addToHistory(makeBlob(), { size: '1KB', duration: '0.1초' });
    await addToHistory(makeBlob(), { size: '2KB', duration: '0.2초' });
    await clearHistory();
    const list = await getHistory();
    expect(list).toHaveLength(0);
  });
});
