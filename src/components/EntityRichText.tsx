import React, { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { typeLabels } from '../lib/entityLabels';
import { Tooltip } from './Tooltip';
import { EntityChooserModal, type EntityCandidate } from './EntityChooserModal';
import type { EntityType, EntityMapping } from '../../shared/types';
import { buildTriggers, findMatches, type Match, type Trigger } from '../lib/entityMatching';

type Segment =
  | { kind: 'text'; text: string }
  | {
      kind: 'entity';
      text: string;
      candidates: Trigger[];
    };

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
    segments.push({
      kind: 'entity',
      text: input.slice(m.start, m.end),
      candidates: m.candidates,
    });
    pos = m.end;
  }
  if (pos < input.length) {
    segments.push({ kind: 'text', text: input.slice(pos) });
  }
  return segments;
}

interface EntityBadgeProps {
  text: string;
  candidates: Trigger[];
  onOpen: (candidate: EntityCandidate) => void;
  onNeedChoice: (candidates: EntityCandidate[]) => void;
}

function toCandidate(trigger: Trigger): EntityCandidate {
  return {
    type: trigger.type,
    name: trigger.canonical,
    qualifier: trigger.qualifier,
    miniSummary: trigger.miniSummary,
  };
}

function EntityBadge({ text, candidates, onOpen, onNeedChoice }: EntityBadgeProps) {
  const first = candidates[0];
  const tooltipContent = (
    <div className="space-y-1">
      {first.miniSummary && (
        <p className="text-[var(--text-h)] leading-snug">{first.miniSummary}</p>
      )}
      <p className={`text-xs font-medium ${entityTextStyles[first.type]}`}>
        {candidates.length > 1
          ? `${typeLabels[first.type]} auswählen`
          : `${typeLabels[first.type]} öffnen`}
      </p>
    </div>
  );
  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        onClick={() => {
          if (candidates.length === 1) {
            onOpen(toCandidate(first));
          } else {
            onNeedChoice(candidates.map(toCandidate));
          }
        }}
        className={`hover:underline transition bg-transparent border-0 p-0 m-0 text-left ${entityTextStyles[first.type]}`}
        style={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}
      >
        {text}
      </button>
    </Tooltip>
  );
}

function renderSegments(
  segments: Segment[],
  baseKey: string,
  onOpen: (candidate: EntityCandidate) => void,
  onNeedChoice: (candidates: EntityCandidate[]) => void
): React.ReactNode[] {
  return segments.map((seg, i) => {
    const key = `${baseKey}-${i}`;
    if (seg.kind === 'text') return <React.Fragment key={key}>{seg.text}</React.Fragment>;
    return (
      <EntityBadge
        key={key}
        text={seg.text}
        candidates={seg.candidates}
        onOpen={onOpen}
        onNeedChoice={onNeedChoice}
      />
    );
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
      [
        'href',
        'target',
        'rel',
        'src',
        'alt',
        'title',
        'width',
        'height',
        'colspan',
        'rowspan',
        'align',
        'valign',
      ].includes(name)
    ) {
      props[name] = value;
    }
  }
  return props;
}

function elementToReact(
  el: HTMLElement,
  triggers: Trigger[],
  key: string,
  onOpen: (candidate: EntityCandidate) => void,
  onNeedChoice: (candidates: EntityCandidate[]) => void
): React.ReactNode {
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return null;

  const children: React.ReactNode[] = [];
  el.childNodes.forEach((child, idx) => {
    const childResult = nodeToReact(child, triggers, `${key}-${idx}`, onOpen, onNeedChoice);
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

function nodeToReact(
  node: Node,
  triggers: Trigger[],
  key: string,
  onOpen: (candidate: EntityCandidate) => void,
  onNeedChoice: (candidates: EntityCandidate[]) => void
): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const matches = findMatches(text, triggers);
    const segments = segmentText(text, matches);
    return renderSegments(segments, key, onOpen, onNeedChoice);
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return elementToReact(node as HTMLElement, triggers, key, onOpen, onNeedChoice);
  }

  return null;
}

function parseHtmlToReact(
  html: string,
  triggers: Trigger[],
  onOpen: (candidate: EntityCandidate) => void,
  onNeedChoice: (candidates: EntityCandidate[]) => void
): React.ReactNode[] {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['style'],
  });
  const doc = new DOMParser().parseFromString(sanitized, 'text/html');
  const result: React.ReactNode[] = [];
  doc.body.childNodes.forEach((child, idx) => {
    const processed = nodeToReact(child, triggers, `root-${idx}`, onOpen, onNeedChoice);
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

export function EntityRichText({
  content,
  mappings,
  isHtml = true,
  className,
}: EntityRichTextProps) {
  const { openEntity } = useEntityDialog();
  const [choiceCandidates, setChoiceCandidates] = useState<EntityCandidate[] | null>(null);
  const triggers = useMemo(() => buildTriggers(mappings), [mappings]);

  const handleOpen = (candidate: EntityCandidate) =>
    openEntity(candidate.name, candidate.type, undefined, candidate.qualifier);

  const nodes = useMemo(() => {
    if (isHtml) {
      return parseHtmlToReact(content, triggers, handleOpen, setChoiceCandidates);
    }
    const matches = findMatches(content, triggers);
    const segments = segmentText(content, matches);
    return renderSegments(segments, 'plain', handleOpen, setChoiceCandidates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, triggers, isHtml, openEntity]);

  return (
    <>
      {isHtml ? (
        <div className={className}>{nodes}</div>
      ) : (
        <span className={className}>{nodes}</span>
      )}
      {choiceCandidates && (
        <EntityChooserModal
          candidates={choiceCandidates}
          onClose={() => setChoiceCandidates(null)}
          onPick={(candidate) => {
            setChoiceCandidates(null);
            handleOpen(candidate);
          }}
        />
      )}
    </>
  );
}
