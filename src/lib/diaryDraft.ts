import { stripHtml } from '../components/quillConfig';

export const DRAFT_KEY_PREFIX = 'diary-draft-';

/** Flattens entity spans and normalizes whitespace for draft comparisons. */
export function normalizeDraftHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const span of Array.from(doc.querySelectorAll('span.ql-entity'))) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
  const textNodes: CharacterData[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as CharacterData);
  }
  for (const node of textNodes) {
    node.data = node.data.replace(/[\p{Zs}]/gu, ' ');
  }
  return doc.body.innerHTML.trim();
}

export function isEmptyHtml(html: string): boolean {
  return !stripHtml(html).trim();
}
