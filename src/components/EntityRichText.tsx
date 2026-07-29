import React, { useMemo } from 'react';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { typeLabels } from '../lib/entityLabels';
import { Tooltip } from './Tooltip';
import type { EntityType, EntityMapping } from '../../shared/types';
import { buildTriggers, findMatches, type Match, type Trigger } from '../lib/entityMatching';

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'entity'; text: string; type: EntityType; canonical: string; miniSummary: string | null };

const entityTextStyles: Record<EntityType, string> = {
  persons: 'text-[var(--accent)]',
  organizations: 'text-blue-400',
  locations: 'text-amber-400',
};

function segmentText(input: string, matches: Match[]): Segment[] {
  const segments: Segment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) {
      segments.push({ kind: 'text', text: input.slice(pos, m.start) });
    }
    segments.push({ kind: 'entity', text: input.slice(m.start, m.end), type: m.type, canonical: m.canonical, miniSummary: m.miniSummary });
    pos = m.end;
  }
  if (pos < input.length) {
    segments.push({ kind: 'text', text: input.slice(pos) });
  }
  return segments;
}

interface EntityBadgeProps {
  text: string;
  type: EntityType;
  canonical: string;
  miniSummary: string | null;
}

function EntityBadge({ text, type, canonical, miniSummary }: EntityBadgeProps) {
  const { openEntity } = useEntityDialog();
  const tooltipContent = (
    <div className="space-y-1">
      {miniSummary && <p className="text-[var(--text-h)] leading-snug">{miniSummary}</p>}
      <p className={`text-xs font-medium ${entityTextStyles[type]}`}>{typeLabels[type]} öffnen</p>
    </div>
  );
  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        onClick={() => openEntity(canonical, type)}
        className={`hover:underline transition bg-transparent border-0 p-0 m-0 text-left ${entityTextStyles[type]}`}
        style={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}
      >
        {text}
      </button>
    </Tooltip>
  );
}

function renderSegments(segments: Segment[], baseKey: string): React.ReactNode[] {
  return segments.map((seg, i) => {
    const key = `${baseKey}-${i}`;
    if (seg.kind === 'text') return <React.Fragment key={key}>{seg.text}</React.Fragment>;
    return <EntityBadge key={key} text={seg.text} type={seg.type} canonical={seg.canonical} miniSummary={seg.miniSummary} />;
  });
}

function parseStyle(styleAttr: string): React.CSSProperties {
  const style: React.CSSProperties = {};
  for (const declaration of styleAttr.split(';')) {
    const [prop, value] = declaration.split(':', 2);
    if (!prop || value === undefined) continue;
    const camelProp = prop.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    (style as Record<string, unknown>)[camelProp] = value.trim();
  }
  return style;
}

function attributesToProps(el: HTMLElement, key: string): Record<string, unknown> {
  const props: Record<string, unknown> = { key };
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const name = attr.name;
    const value = attr.value;
    if (name === 'class') {
      props.className = value;
    } else if (name === 'style') {
      props.style = parseStyle(value);
    } else if (name === 'for') {
      props.htmlFor = value;
    } else if (name.startsWith('data-') || name.startsWith('aria-')) {
      props[name] = value;
    } else if (
      ['href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align', 'valign'].includes(
        name,
      )
    ) {
      props[name] = value;
    }
  }
  return props;
}

function elementToReact(el: HTMLElement, triggers: Trigger[], key: string): React.ReactNode {
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return null;

  const children: React.ReactNode[] = [];
  el.childNodes.forEach((child, idx) => {
    const childResult = nodeToReact(child, triggers, `${key}-${idx}`);
    if (childResult !== null && childResult !== undefined) {
      children.push(childResult);
    }
  });

  if (tag === 'br') {
    return React.createElement('br', { key });
  }

  const props = attributesToProps(el, key);

  if (tag === 'img') {
    return React.createElement('img', props);
  }

  if (children.length === 1) {
    return React.createElement(tag, props, children[0]);
  }

  return React.createElement(tag, props, children);
}

function nodeToReact(node: Node, triggers: Trigger[], key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const matches = findMatches(text, triggers);
    const segments = segmentText(text, matches);
    return renderSegments(segments, key);
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return elementToReact(node as HTMLElement, triggers, key);
  }

  return null;
}

function parseHtmlToReact(html: string, triggers: Trigger[]): React.ReactNode[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const result: React.ReactNode[] = [];
  doc.body.childNodes.forEach((child, idx) => {
    const processed = nodeToReact(child, triggers, `root-${idx}`);
    if (processed !== null && processed !== undefined) {
      result.push(processed);
    }
  });
  return result;
}

interface EntityRichTextProps {
  content: string;
  mappings: EntityMapping[];
  isHtml?: boolean;
  className?: string;
}

export function EntityRichText({ content, mappings, isHtml = true, className }: EntityRichTextProps) {
  const triggers = useMemo(() => buildTriggers(mappings), [mappings]);

  const nodes = useMemo(() => {
    if (isHtml) {
      return parseHtmlToReact(content, triggers);
    }
    const matches = findMatches(content, triggers);
    const segments = segmentText(content, matches);
    return renderSegments(segments, 'plain');
  }, [content, triggers, isHtml]);

  if (isHtml) {
    return <div className={className}>{nodes}</div>;
  }
  return <span className={className}>{nodes}</span>;
}
