import { describe, it, expect } from 'vitest';
import {
  clamp,
  truncate,
  getSpriteFrame,
  calcHandY,
  fixTransparency,
  DEFAULTS,
  FRAME_OFFSETS,
} from './engine.js';

describe('clamp', () => {
  it('returns value within range unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps to lo when below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it('clamps to hi when above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('handles boundary values', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('truncate', () => {
  it('returns short string unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('truncates long string with mid ellipsis', () => {
    const result = truncate('abcdefghij', 6);
    expect(result).toContain('⋯');
    expect(result.length).toBeLessThan('abcdefghij'.length);
  });
  it('truncates when length equals len (strict less-than boundary)', () => {
    // str.length < len is false when equal, so it truncates
    expect(truncate('abc', 3)).toContain('⋯');
    // but len=4 passes through
    expect(truncate('abc', 4)).toBe('abc');
  });
});

describe('getSpriteFrame', () => {
  const state = { ...DEFAULTS };

  it('frame 0: base position with no offset', () => {
    const f = getSpriteFrame(0, state);
    expect(f.dx).toBe(state.spriteX);
    expect(f.dy).toBe(state.spriteY);
  });

  it('frame 2: squish offsets applied correctly', () => {
    const f0 = getSpriteFrame(0, state);
    const f2 = getSpriteFrame(2, state);
    // frame 2 has y offset +18 * squish * 0.9 → dy is larger (pressed down)
    expect(f2.dy).toBeGreaterThan(f0.dy);
    // frame 2 w offset is +12 (positive) → sprite gets wider when pressed
    expect(f2.dw).toBeGreaterThan(f0.dw);
    // frame 2 h offset is -18 (negative) → sprite gets shorter when pressed
    expect(f2.dh).toBeLessThan(f0.dh);
  });

  it('matches characterization values for default state', () => {
    // Frame 0: no offsets
    const f0 = getSpriteFrame(0, state);
    expect(f0.dx).toBe(14);  // DEFAULTS.spriteX
    expect(f0.dy).toBe(20);  // DEFAULTS.spriteY
    expect(f0.dw).toBe(~~(112 * 0.875));  // ~~(spriteWidth * scale) = 98
    expect(f0.dh).toBe(~~(112 * 0.875));  // 98 (square sprite initially)
  });

  it('all 5 frames return valid numeric values', () => {
    for (let i = 0; i <= 4; i++) {
      const f = getSpriteFrame(i, state);
      expect(typeof f.dx).toBe('number');
      expect(typeof f.dy).toBe('number');
      expect(typeof f.dw).toBe('number');
      expect(typeof f.dh).toBe('number');
    }
  });
});

describe('calcHandY', () => {
  it('returns 0 when result would be negative', () => {
    expect(calcHandY(0, 0)).toBe(0);
  });

  it('characterization: dy=20, spriteY=20', () => {
    // handY = max(0, ~~(20 * 0.75 - max(0, 20) - 0.5))
    //       = max(0, ~~(15 - 20 - 0.5))
    //       = max(0, ~~(-5.5))
    //       = max(0, -5)
    //       = 0
    expect(calcHandY(20, 20)).toBe(0);
  });

  it('characterization: dy=80, spriteY=0', () => {
    // handY = max(0, ~~(80 * 0.75 - max(0, 0) - 0.5))
    //       = max(0, ~~(60 - 0 - 0.5))
    //       = max(0, ~~(59.5))
    //       = max(0, 59)
    //       = 59
    expect(calcHandY(80, 0)).toBe(59);
  });
});

describe('fixTransparency', () => {
  it('makes transparent pixels (alpha < 120) into chromakey green', () => {
    const data = new Uint8Array([100, 50, 200, 100]);
    fixTransparency(data);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(255);
  });

  it('clamps green channel > 250 to 250', () => {
    const data = new Uint8Array([0, 255, 0, 255]);
    fixTransparency(data);
    expect(data[1]).toBe(250);
  });

  it('forces all alpha values to 255', () => {
    const data = new Uint8Array([200, 100, 50, 180]);
    fixTransparency(data);
    expect(data[3]).toBe(255);
  });

  it('opaque non-green pixel is preserved (only alpha forced to 255)', () => {
    const data = new Uint8Array([255, 0, 0, 200]);
    fixTransparency(data);
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(255);
  });
});

describe('DEFAULTS', () => {
  it('contains expected keys and reasonable values', () => {
    expect(DEFAULTS.squish).toBeCloseTo(1.25);
    expect(DEFAULTS.scale).toBeCloseTo(0.875);
    expect(DEFAULTS.flip).toBe(false);
    expect(DEFAULTS.currentFrame).toBe(0);
  });
});

describe('FRAME_OFFSETS', () => {
  it('has 5 entries (frames 0-4)', () => {
    expect(FRAME_OFFSETS).toHaveLength(5);
  });

  it('frame 0 has zero offsets', () => {
    expect(FRAME_OFFSETS[0]).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
