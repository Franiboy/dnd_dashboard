import Quill from 'quill';
import Inline from 'quill/blots/inline';
import type { EntityMapping, EntityType } from '../../shared/types';
import { buildTriggers, findMatches } from '../lib/entityMatching';
import { typeLabels } from '../lib/entityLabels';

interface EntityValue {
  type: EntityType;
  canonical: string;
  miniSummary?: string | null;
}

class EntityBlot extends Inline {
  static blotName = 'entity';
  static className = 'ql-entity';
  static tagName = 'SPAN';

  static create(value: EntityValue) {
    const node = super.create(value) as HTMLElement;
    node.setAttribute('data-type', value.type);
    node.setAttribute('data-canonical', value.canonical);
    if (value.miniSummary) {
      node.setAttribute('data-mini-summary', value.miniSummary);
    }
    node.classList.add('ql-entity', `ql-entity-${value.type}`);
    node.setAttribute('contenteditable', 'false');
    node.style.cursor = 'pointer';
    const label = `${typeLabels[value.type]}: ${value.canonical}`;
    node.setAttribute('title', value.miniSummary ? `${label} — ${value.miniSummary}` : label);
    return node;
  }

  static formats(domNode: HTMLElement): EntityValue | undefined {
    if (!domNode.classList.contains('ql-entity')) return undefined;
    const type = domNode.getAttribute('data-type') as EntityType | null;
    const canonical = domNode.getAttribute('data-canonical');
    const miniSummary = domNode.getAttribute('data-mini-summary');
    if (!type || !canonical) return undefined;
    return { type, canonical, miniSummary };
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

export function applyEntityHighlights(quill: Quill, mappings: EntityMapping[]) {
  const triggers = buildTriggers(mappings);
  const text = quill.getText();
  const matches = findMatches(text, triggers);

  quill.formatText(0, quill.getLength(), 'entity', false, 'silent');

  for (const match of matches) {
    const length = match.end - match.start;
    if (length <= 0) continue;
    quill.formatText(match.start, length, 'entity', { type: match.type, canonical: match.canonical, miniSummary: match.miniSummary }, 'silent');
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
