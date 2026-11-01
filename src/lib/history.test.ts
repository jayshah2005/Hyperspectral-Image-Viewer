import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('walks back and forward', () => {
    const h = new History<string>();
    h.push('a');
    h.push('b');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeNull();
  });

  it('a new edit clears redo', () => {
    const h = new History<string>();
    h.push('a');
    h.undo('b');
    expect(h.canRedo).toBe(true);
    h.push('a');
    expect(h.canRedo).toBe(false);
  });

  it('keeps only the most recent states', () => {
    const h = new History<number>(2);
    [1, 2, 3].forEach((n) => h.push(n));
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeNull();
  });
});
