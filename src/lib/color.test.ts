import { describe, expect, it } from 'vitest';
import {
  buildTheme,
  hexToHsl,
  hslToHex,
  isValidHexColor,
  pickAccentContrast,
  relativeLuminance,
} from './color';

describe('isValidHexColor', () => {
  it('accepts lowercase and uppercase #rrggbb', () => {
    expect(isValidHexColor('#22c55e')).toBe(true);
    expect(isValidHexColor('#22C55E')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidHexColor('22c55e')).toBe(false);
    expect(isValidHexColor('#22c55')).toBe(false);
    expect(isValidHexColor('#22c55eg')).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
    expect(isValidHexColor(undefined)).toBe(false);
  });
});

describe('hexToHsl / hslToHex', () => {
  it('roundtrips colors within rounding tolerance', () => {
    for (const hex of [
      '#22c55e',
      '#0f172a',
      '#f8fafc',
      '#ef4444',
      '#123456',
      '#000000',
      '#ffffff',
    ]) {
      const { h, s, l } = hexToHsl(hex);
      const back = hslToHex(h, s, l);
      // Compare via re-parse: single rounding steps may shift a channel by 1.
      const a = hexToHsl(back);
      expect(Math.abs(a.h - h)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.s - s)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.l - l)).toBeLessThanOrEqual(1);
    }
  });

  it('knows primary hues', () => {
    expect(hexToHsl('#ff0000').h).toBe(0);
    expect(hexToHsl('#00ff00').h).toBe(120);
    expect(hexToHsl('#0000ff').h).toBe(240);
    expect(hexToHsl('#000000').s).toBe(0);
  });
});

describe('relativeLuminance / pickAccentContrast', () => {
  it('ranges from black to white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('keeps dark text for the default green and picks light text for dark accents', () => {
    expect(pickAccentContrast('#22c55e')).toBe('#0f172a');
    expect(pickAccentContrast('#1d4ed8')).toBe('#f8fafc');
  });
});

describe('buildTheme', () => {
  it('returns no overrides without a valid primary', () => {
    expect(buildTheme(null)).toEqual({});
    expect(buildTheme(undefined)).toEqual({});
    expect(buildTheme('red')).toEqual({});
  });

  it('leaves the default green accent untouched', () => {
    const theme = buildTheme('#22c55e');
    expect(theme['--accent']).toBe('#22c55e');
  });

  it('produces valid hex tokens only', () => {
    const theme = buildTheme('#e11d48');
    for (const [name, value] of Object.entries(theme)) {
      expect(name).toMatch(/^--[a-z0-9-]+$/);
      expect(isValidHexColor(value), `${name}=${value}`).toBe(true);
    }
  });

  it('normalizes extreme lightness into the usable accent band', () => {
    const nearBlack = hexToHsl(buildTheme('#0a0a0a')['--accent']);
    expect(nearBlack.l).toBeGreaterThanOrEqual(37.5);
    expect(nearBlack.s).toBeLessThanOrEqual(1); // stays gray like the input

    const nearWhite = hexToHsl(buildTheme('#fdfdfd')['--accent']);
    expect(nearWhite.l).toBeLessThanOrEqual(64.5);
  });

  it('derives the dim variant darker than the accent', () => {
    const accent = hexToHsl(buildTheme('#ef4444')['--accent']);
    const dim = hexToHsl(buildTheme('#ef4444')['--accent-dim']);
    expect(dim.l).toBeLessThan(accent.l);
    expect(Math.abs(dim.h - accent.h)).toBeLessThanOrEqual(2);
  });

  it('picks the complementary hue for the secondary tone', () => {
    const theme = buildTheme('#22c55e');
    const accentHue = hexToHsl(theme['--accent']).h;
    const accent2Hue = hexToHsl(theme['--accent-2']).h;
    const opposite = (accentHue + 180) % 360;
    expect(Math.abs(accent2Hue - opposite)).toBeLessThanOrEqual(2);
  });

  it('tints the neutral ramp with the primary hue while keeping lightness', () => {
    const theme = buildTheme('#ef4444'); // red
    const bg = hexToHsl(theme['--bg']);
    // slate-900 lightness is ~11% — must stay near it.
    expect(bg.l).toBeLessThanOrEqual(13);
    expect(bg.l).toBeGreaterThanOrEqual(9);
    // hue follows the primary (red ~0) with wrap-around tolerance
    const wrapped = Math.min(bg.h, 360 - bg.h);
    expect(wrapped).toBeLessThanOrEqual(15);
    expect(bg.s).toBeGreaterThan(0);
    // border/text aliases map onto the tinted ramp
    expect(theme['--border']).toBe(theme['--color-slate-700']);
    expect(theme['--text']).toBe(theme['--color-slate-200']);
  });

  it('keeps a gray primary neutral instead of tinting with hue 0', () => {
    const theme = buildTheme('#808080');
    const bg = hexToHsl(theme['--bg']);
    expect(bg.s).toBeLessThanOrEqual(2);
  });

  it('scales the tint strength with the primary saturation', () => {
    const vivid = hexToHsl(buildTheme('#ff0000')['--panel']).s;
    const muted = hexToHsl(buildTheme('#a04040')['--panel']).s;
    expect(vivid).toBeGreaterThan(muted);
  });
});
