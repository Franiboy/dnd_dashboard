import Quill from 'quill';
import Inline from 'quill/blots/inline';
import type { EntityMapping, EntityType } from '../../shared/types';
import { buildTriggers, findMatches } from '../lib/entityMatching';
import { entityTypeLabelKeys, typeLabels } from '../lib/entityLabels';
import { translate } from '../i18n';

interface EntityValue {
  type: EntityType;
  canonical: string;
  qualifier?: string;
  /** Set when several homonyms share this mention; the UI must ask. */
  ambiguous?: boolean;
  miniSummary?: string | null;
  /** Resolved in the active UI language for the editor tooltip. */
  typeLabel?: string;
}

function currentLanguage(): 'de' | 'en' {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.lang.toLowerCase().startsWith('en')
  ) {
    return 'en';
  }
  return 'de';
}

function fallbackTypeLabel(type: EntityType): string {
  return translate(currentLanguage(), entityTypeLabelKeys[type]);
}

class EntityBlot extends Inline {
  static blotName = 'entity';
  static className = 'ql-entity';
  static tagName = 'SPAN';

  static create(value: EntityValue) {
    const node = super.create(value) as HTMLElement;
    node.setAttribute('data-type', value.type);
    node.setAttribute('data-canonical', value.canonical);
    if (value.qualifier) {
      node.setAttribute('data-qualifier', value.qualifier);
    }
    if (value.ambiguous) {
      node.setAttribute('data-ambiguous', '1');
    }
    if (value.miniSummary) {
      node.setAttribute('data-mini-summary', value.miniSummary);
    }
    node.classList.add('ql-entity', `ql-entity-${value.type}`);
    node.setAttribute('contenteditable', 'false');
    node.style.cursor = 'pointer';
    const label = `${value.typeLabel ?? fallbackTypeLabel(value.type)}: ${value.qualifier ? `${value.canonical} (${value.qualifier})` : value.canonical}`;
    node.setAttribute('aria-label', label);
    node.setAttribute('title', value.miniSummary ? `${label} — ${value.miniSummary}` : label);
    return node;
  }

  static formats(domNode: HTMLElement): EntityValue | undefined {
    if (!domNode.classList.contains('ql-entity')) return undefined;
    const type = domNode.getAttribute('data-type') as EntityType | null;
    const canonical = domNode.getAttribute('data-canonical');
    const qualifier = domNode.getAttribute('data-qualifier');
    const ambiguous = domNode.getAttribute('data-ambiguous');
    const miniSummary = domNode.getAttribute('data-mini-summary');
    if (!type || !canonical) return undefined;
    return {
      type,
      canonical,
      qualifier: qualifier ?? undefined,
      ambiguous: ambiguous ? true : undefined,
      miniSummary,
    };
  }

  static value(domNode: HTMLElement): EntityValue | undefined {
    return EntityBlot.formats(domNode);
  }

  format(name: string, value: unknown) {
    if (name === 'entity') {
      if (value) {
        super.format(name, value);
      } else {
        super.format(name, false);
      }
    } else {
      super.format(name, value);
    }
  }
}

Quill.register(EntityBlot);

export function applyEntityHighlights(
  quill: Quill,
  mappings: EntityMapping[],
  typeLabel: (type: EntityType) => string = (entityType) =>
    typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en')
      ? translate('en', entityTypeLabelKeys[entityType])
      : typeLabels[entityType]
) {
  const triggers = buildTriggers(mappings);
  const text = quill.getText();
  const matches = findMatches(text, triggers);

  quill.formatText(0, quill.getLength(), 'entity', false, 'silent');

  for (const match of matches) {
    const length = match.end - match.start;
    if (length <= 0) continue;
    const first = match.candidates[0];
    quill.formatText(
      match.start,
      length,
      'entity',
      {
        type: first.type,
        canonical: first.canonical,
        qualifier: first.qualifier || undefined,
        ambiguous: match.candidates.length > 1 ? true : undefined,
        miniSummary: first.miniSummary,
        typeLabel: typeLabel(first.type),
      },
      'silent'
    );
  }
}

export function stripEntityBadges(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const spans = doc.querySelectorAll('span.ql-entity');
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  }
  return doc.body.innerHTML;
}
