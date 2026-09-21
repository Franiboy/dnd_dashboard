// Color math for the dynamic per-user theme. Everything derives from a single
// primary color: accent tones, an auto-contrast text color, a damped
// complementary tone, and a hue-tinted neutral ramp that replaces Tailwind's
// slate scale at runtime (Tailwind v4 utilities resolve those via CSS vars).

/** Tailwind's slate scale — the neutral base ramp of the default dark theme. */
const SLATE_SCALE: Record<string, string> = {
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
  950: '#020617',
};

export interface Hsl {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function hexToHsl(hex: string): Hsl {
  const value = isValidHexColor(hex) ? hex : '#000000';
  const r = parseInt(value.slice(1, 3), 16) / 255;
  const g = parseInt(value.slice(3, 5), 16) / 255;
  const b = parseInt(value.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(Math.max(s, 0), 100) / 100;
  const light = Math.min(Math.max(l, 0), 100) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toByte = (v: number) => Math.round((v + m) * 255);
  return '#' + [r, g, b].map((v) => toByte(v).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const value = isValidHexColor(hex) ? hex : '#000000';
  const channel = (part: string) => {
    const v = parseInt(part, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(value.slice(1, 3)) +
    0.7152 * channel(value.slice(3, 5)) +
    0.0722 * channel(value.slice(5, 7))
  );
}

/**
 * Readable text color for accent surfaces. The default dark UI uses
 * near-black text on accent; for dark accents only light text has enough
 * contrast, so pick per luminance instead of hardcoding.
 */
export function pickAccentContrast(accentHex: string): string {
  return relativeLuminance(accentHex) > 0.35 ? '#0f172a' : '#f8fafc';
}

// Accent lightness band: below ~38 a dark accent becomes unreadable next to
// the dark background and forces white text everywhere; above ~64 light
// accents wash out. The default green (#22c55e, L≈45) sits inside untouched.
const ACCENT_L_MIN = 38;
const ACCENT_L_MAX = 64;

// Neutral tint strength: slate already carries notable saturation (up to ~47%
// on dark steps); swapping its hue for the user's hue at a capped rate keeps
// the tint noticeable but subtle, and it scales down for desaturated primaries.
const NEUTRAL_TINT_S_MAX = 26;

export interface ThemeTokens {
  [cssVariable: string]: string;
}

/**
 * Derive the full CSS-variable set for a primary color. Returns an empty
 * object for null/invalid input so the stylesheet defaults (green accent,
 * neutral slate) stay in charge — this is also the "reset" behavior.
 */
export function buildTheme(primary: string | null | undefined): ThemeTokens {
  if (!isValidHexColor(primary)) return {};

  const base = hexToHsl(primary);
  const accentL = Math.min(Math.max(base.l, ACCENT_L_MIN), ACCENT_L_MAX);
  const accentDimL = Math.max(accentL - 16, 12);

  const accent = hslToHex(base.h, base.s, accentL);
  const accent2Hue = (base.h + 180) % 360;
  const accent2Sat = base.s * 0.8;

  const tint = (neutralHex: string): string => {
    const neutral = hexToHsl(neutralHex);
    const s = Math.min(neutral.s, NEUTRAL_TINT_S_MAX) * (base.s / 100);
    return hslToHex(base.h, s, neutral.l);
  };

  const tokens: ThemeTokens = {
    '--accent': accent,
    '--accent-dim': hslToHex(base.h, base.s, accentDimL),
    '--accent-contrast': pickAccentContrast(accent),
    // Damped complementary tone; defaults to the accent itself in CSS so
    // gradients collapse to solid for the default theme.
    '--accent-2': hslToHex(accent2Hue, accent2Sat, accentL),
  };

  for (const [step, hex] of Object.entries(SLATE_SCALE)) {
    tokens[`--color-slate-${step}`] = tint(hex);
  }

  // Semantic aliases mirroring the default :root values in index.css.
  tokens['--bg'] = tokens['--color-slate-900'];
  tokens['--panel'] = tokens['--color-slate-800'];
  tokens['--border'] = tokens['--color-slate-700'];
  tokens['--text'] = tokens['--color-slate-200'];
  tokens['--text-h'] = tokens['--color-slate-50'];
  tokens['--inset'] = tint('#111827'); // gray-900 insets (Quill tables etc.)

  return tokens;
}
