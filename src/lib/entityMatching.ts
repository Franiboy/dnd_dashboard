import type { EntityType, EntityMapping } from '../../shared/types';

export interface Trigger {
  type: EntityType;
  canonical: string;
  text: string;
  miniSummary: string | null;
}

export interface Match {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  canonical: string;
  miniSummary: string | null;
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
      text: mapping.canonical,
      miniSummary: mapping.miniSummary,
    });
    for (const alias of mapping.aliases) {
      triggers.push({
        type: mapping.type,
        canonical: mapping.canonical,
        text: alias,
        miniSummary: mapping.miniSummary,
      });
    }
  }
  return triggers.sort((a, b) => b.text.length - a.text.length);
}

export function findMatches(input: string, triggers: Trigger[]): Match[] {
  const matches: Match[] = [];
  for (const trigger of triggers) {
    const escaped = escapeRegex(trigger.text);
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
    let match;
    while ((match = regex.exec(input)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: trigger.type,
        canonical: trigger.canonical,
        miniSummary: trigger.miniSummary,
      });
      if (match[0].length === 0) break;
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: Match[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      nonOverlapping.push(m);
      lastEnd = m.end;
    }
  }
  return nonOverlapping;
}
