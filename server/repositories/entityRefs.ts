/**
 * Entity identity helpers shared across repositories, AI flows and tools.
 *
 * An entity is identified by its raw name plus an optional qualifier that
 * disambiguates homonyms ("Kerigan" the gnome vs "Kerigan" the paladin).
 * Labels render as "Name (Qualifier)"; parsing back is tolerant and callers
 * should always try the untouched string as a plain name first.
 */

export interface EntityRef {
  name: string;
  /** Disambiguator; empty string for the plain, unqualified name. */
  qualifier: string;
}

export function entityLabel(ref: EntityRef): string {
  return ref.qualifier ? `${ref.name} (${ref.qualifier})` : ref.name;
}

export function splitEntityLabel(label: string): EntityRef {
  const trimmed = label.trim();
  const match = /^(.*)\s\(([^()]+)\)$/.exec(trimmed);
  if (match && match[1].trim()) {
    return { name: match[1].trim(), qualifier: match[2].trim() };
  }
  return { name: trimmed, qualifier: '' };
}
