import { describe, it, expect } from 'vitest';
import { formatTime, clamp } from '../../src/utils/helpers';

describe('Helpers', () => {
  describe('formatTime', () => {
    it('should format seconds correctly', () => {
      expect(formatTime(0)).toBe('00:00');
      expect(formatTime(61)).toBe('01:01');
      expect(formatTime(3600)).toBe('01:00:00');
    });

    it('should handle invalid inputs', () => {
      expect(formatTime(-1)).toBe('00:00');
      expect(formatTime(NaN)).toBe('00:00');
    });
  });

  describe('clamp', () => {
    it('should clamp values within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });
});
