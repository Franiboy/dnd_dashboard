import type { EntityType, EntityMapping } from '../../shared/types';

export interface Trigger {
  type: EntityType;
  canonical: string;
  qualifier: string;
  text: string;
  miniSummary: string | null;
}

/**
 * One highlighted occurrence. When several entities share the same trigger
 * text (homonyms like two "Halvard"), every one of them is listed in
 * `candidates` so the UI can ask which entity was meant.
 */
export interface Match {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  candidates: Trigger[];
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTriggers(mappings: EntityMapping[]): Trigger[] {
  const triggers: Trigger[] = [];
  for (const mapping of mappings) {
    triggers.push({
      type: mapping.type,
      canonical: mapping.canonical,
      qualifier: mapping.qualifier ?? '',
      text: mapping.canonical,
      miniSummary: mapping.miniSummary,
    });
    for (const alias of mapping.aliases) {
      triggers.push({
        type: mapping.type,
        canonical: mapping.canonical,
        qualifier: mapping.qualifier ?? '',
        text: alias,
        miniSummary: mapping.miniSummary,
      });
    }
  }
  return triggers.sort((a, b) => b.text.length - a.text.length);
}

interface RawMatch {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  trigger: Trigger;
}

export function findMatches(input: string, triggers: Trigger[]): Match[] {
  const raw: RawMatch[] = [];
  for (const trigger of triggers) {
    const escaped = escapeRegex(trigger.text);
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
    let match;
    while ((match = regex.exec(input)) !== null) {
      raw.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: trigger.type,
        trigger,
      });
      if (match[0].length === 0) break;
    }
  }

  // Longest match wins per position; identical spans collect homonym
  // candidates so the caller can disambiguate between them.
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const matches: Match[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    const last = matches[matches.length - 1];
    if (last && last.start === m.start && last.end === m.end && last.type === m.type) {
      if (
        !last.candidates.some(
          (c) =>
            c.canonical === m.trigger.canonical &&
            c.qualifier === m.trigger.qualifier &&
            c.type === m.trigger.type
        )
      ) {
        last.candidates.push(m.trigger);
      }
      continue;
    }
    if (m.start >= lastEnd) {
      matches.push({
        start: m.start,
        end: m.end,
        text: m.text,
        type: m.type,
        candidates: [m.trigger],
      });
      lastEnd = m.end;
    }
  }
  return matches;
}
