import type { SafeUser } from '../../shared/types.js';

export interface SpeakerAnnotation {
  discordName: string;
  label: string;
  isAuthor: boolean;
  isDm: boolean;
  activePerson: string | null;
}

export interface SpeakerAnnotationResult {
  transcript: string;
  speakers: SpeakerAnnotation[];
  mappingLines: string[];
}

const MIN_NAME_LENGTH = 4;

const LINE_PREFIX_RE = /^\[(\d{1,3}:\d{2}(?::\d{2})?)\] ([^\n:]+):/gm;

// Whisper transcripts contain misattribution artifacts inside the text, e.g.
// "Cloudsen:"..., "franiboy:"..." or "Cloudsen& Nils & ...". These are not real
// dialogue, so they are replaced together with the line-level speaker labels.
const IN_TEXT_NAME_RE = /([A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9 .,'|/-]*?)(?=:\s*"|=\s*"|\s*&\s*)/g;
const IN_TEXT_AFTER_AMP_RE = /&\s*([A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9 .,'|/-]*?)\b/g;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

interface Candidate {
  user: SafeUser;
  score: 0 | 1 | 2;
}

/**
 * Resolves a transcript speaker label (Discord name, possibly fuzzy) to a user.
 * Priority: exact displayName/username match, then normalized containment,
 * then edit distance <= 1. Longer matches win ties.
 */
export function resolveTranscriptSpeaker(
  transcriptName: string,
  users: SafeUser[]
): SafeUser | null {
  const norm = normalizeName(transcriptName);
  if (norm.length < MIN_NAME_LENGTH) return null;

  let best: Candidate | null = null;
  for (const user of users) {
    let score: 0 | 1 | 2 | null = null;
    for (const candidate of [user.displayName, user.username]) {
      const normalized = normalizeName(candidate);
      if (!normalized) continue;
      if (normalized === norm) {
        score = 0;
        break;
      }
      if (
        normalized.length >= MIN_NAME_LENGTH &&
        (normalized.includes(norm) || norm.includes(normalized))
      ) {
        if (score === null || score > 1) score = 1;
      } else if (normalized.length >= MIN_NAME_LENGTH && editDistance(normalized, norm) <= 1) {
        if (score === null || score > 2) score = 2;
      }
    }
    if (score === null) continue;
    if (
      !best ||
      score < best.score ||
      (score === best.score &&
        normalizeName(user.displayName).length > normalizeName(best.user.displayName).length)
    ) {
      best = { user, score };
    }
  }
  return best?.user ?? null;
}

function collectNames(transcript: string): {
  lineNames: Map<string, string>;
  inTextNames: Map<string, string>;
} {
  const lineNames = new Map<string, string>();
  const inTextNames = new Map<string, string>();

  const add = (target: Map<string, string>, raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const key = normalizeName(name);
    if (!key || target.has(key)) return;
    target.set(key, name);
  };

  for (const match of transcript.matchAll(LINE_PREFIX_RE)) {
    add(lineNames, match[2]);
  }
  for (const match of transcript.matchAll(IN_TEXT_NAME_RE)) {
    add(inTextNames, match[1]);
  }
  for (const match of transcript.matchAll(IN_TEXT_AFTER_AMP_RE)) {
    add(inTextNames, match[1]);
  }
  return { lineNames, inTextNames };
}

function buildLabel(user: SafeUser, transcriptName: string, isAuthor: boolean): string {
  if (user.role === 'dungeon_master') {
    return `Spielleiter (${transcriptName})`;
  }
  if (!user.activePerson) {
    return transcriptName;
  }
  const suffix = isAuthor ? ' (du)' : '';
  return `${user.activePerson} (${transcriptName})${suffix}`;
}

// In-text artifacts often lose the canonical capitalization ("franiboy" instead
// of "Franiboy"). Prefer the user's display name for exact matches.
function canonicalInTextName(user: SafeUser, inTextName: string): string {
  for (const candidate of [user.displayName, user.username]) {
    if (normalizeName(candidate) === normalizeName(inTextName)) return candidate;
  }
  return inTextName;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces Discord speaker labels in a transcript with character labels
 * (e.g. "Cloudsen" -> "Vimak (Cloudsen)", DM -> "Spielleiter (Nils)", the
 * author additionally marked with "(du)"). Also cleans Whisper attribution
 * artifacts like `cloudsen:"..."` inside the text. Unresolved speakers stay
 * unchanged.
 */
export function annotateTranscriptSpeakers(
  transcript: string,
  users: SafeUser[],
  authorUserId?: string
): SpeakerAnnotationResult {
  const { lineNames, inTextNames } = collectNames(transcript);
  const allKeys = new Set([...lineNames.keys(), ...inTextNames.keys()]);

  const speakers: SpeakerAnnotation[] = [];
  let result = transcript;

  for (const key of allKeys) {
    const lineName = lineNames.get(key);
    const inTextName = inTextNames.get(key);
    const user = resolveTranscriptSpeaker(lineName ?? inTextName!, users);
    if (!user) continue;

    const isAuthor = user.id === authorUserId;
    const transcriptName = lineName ?? canonicalInTextName(user, inTextName!);
    const label = buildLabel(user, transcriptName, isAuthor);

    result = result.replace(
      new RegExp(
        `^(\\[\\d{1,3}:\\d{2}(?::\\d{2})?\\] )${escapeRegExp(lineName ?? inTextName!)}(?=:)`,
        'gm'
      ),
      (_match, prefix: string) => `${prefix}${label}`
    );
    // before-colon / before-& artifacts (e.g. `Cloudsen:"..."`, `Nils &`)
    result = result.replace(
      new RegExp(`${escapeRegExp(lineName ?? inTextName!)}(?=:\\s*"|=\\s*"|\\s*&\\s*)`, 'gi'),
      () => label
    );
    // after-& artifacts (e.g. `Nils & Cloudsen`, trailing `& Cloudsen` without following `:`/`&`)
    result = result.replace(
      new RegExp(`(?<=&\\s*)${escapeRegExp(lineName ?? inTextName!)}\\b`, 'gi'),
      () => label
    );
    // fallback without lookbehind for runtimes without variable-length lookbehind support
    result = result.replace(
      new RegExp(`(&\\s*)${escapeRegExp(lineName ?? inTextName!)}\\b`, 'gi'),
      (_m, prefix: string) => `${prefix}${label}`
    );

    if (lineNames.has(key)) {
      speakers.push({
        discordName: transcriptName,
        label,
        isAuthor,
        isDm: user.role === 'dungeon_master',
        activePerson: user.activePerson,
      });
    }
  }

  const mappingLines = speakers.map((speaker) => {
    if (speaker.isDm) {
      return `- ${speaker.discordName} → Spielleiter (DM, kein Charakter)`;
    }
    if (speaker.isAuthor) {
      return speaker.activePerson
        ? `- ${speaker.discordName} → ${speaker.activePerson} (dein Charakter)`
        : `- ${speaker.discordName} → du (kein Charakter ausgewählt)`;
    }
    return speaker.activePerson
      ? `- ${speaker.discordName} → ${speaker.activePerson}`
      : `- ${speaker.discordName} → keinem Charakter zugeordnet`;
  });

  return { transcript: result, speakers, mappingLines };
}
