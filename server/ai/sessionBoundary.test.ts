import { describe, expect, it } from 'vitest';
import { parseTranscriptLines, sliceTranscriptForBoundaryDetection } from './sessionBoundary.js';

const HEADER_LINE = 'Transkript der Session';
const SHORT_TS = '[12:30] Nils: Moin, wie geht es euch?';
const HOUR_TS = '[01:05:00] Nils: Hier beginnt das Spiel.';
const END_TS = '[05:00:00] Nils: Damit endet die Session für heute.';
const GOODBYE_TS = '[05:20:00] Nils: Bis zum nächsten Mal, tschüss!';

describe('parseTranscriptLines', () => {
  it('parses MM:SS and HH:MM:SS timestamps into seconds', () => {
    const lines = parseTranscriptLines(`${HEADER_LINE}\n${SHORT_TS}\n${END_TS}`);
    expect(lines).toHaveLength(3);
    expect(lines[0].seconds).toBeNull();
    expect(lines[1].seconds).toBe(12 * 60 + 30);
    expect(lines[2].seconds).toBe(5 * 3600);
  });
});

describe('sliceTranscriptForBoundaryDetection', () => {
  it('returns the full transcript for short recordings', () => {
    const transcript = [SHORT_TS, '[00:40:00] Nils: Inhalt'].join('\n');
    const slices = sliceTranscriptForBoundaryDetection(transcript);
    expect(slices.useFull).toBe(true);
    expect(slices.head).toBeNull();
    expect(slices.tail).toBeNull();
    expect(slices.maxSeconds).toBe(40 * 60);
  });

  it('keeps only the first and last 90 minutes for long recordings', () => {
    const lines = [
      SHORT_TS,
      '[01:00:00] Nils: Vorbesprechung',
      '[01:30:00] Nils: Kurz vor Spielbeginn',
      END_TS,
      GOODBYE_TS,
      '[05:35:00] Nils: Auf Wiedersehen',
    ];
    const slices = sliceTranscriptForBoundaryDetection(lines.join('\n'));
    expect(slices.useFull).toBe(false);
    expect(slices.maxSeconds).toBe(5 * 3600 + 35 * 60);
    // Head covers up to 90 minutes, tail from end - 90 minutes.
    expect(slices.head).toContain(SHORT_TS);
    expect(slices.head).toContain('Kurz vor Spielbeginn');
    expect(slices.head).not.toContain(END_TS);
    expect(slices.tail).toContain(END_TS);
    expect(slices.tail).toContain(GOODBYE_TS);
    expect(slices.tail).toContain('Auf Wiedersehen');
    expect(slices.tail).not.toContain(SHORT_TS);
  });
});
