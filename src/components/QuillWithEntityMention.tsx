import { useRef, type ComponentProps, type Ref } from 'react';
import ReactQuill from 'react-quill-new';
import type { EntityMapping } from '../../shared/types';
import { useEntityMention } from '../hooks/useEntityMention';
import { EntityMentionDropdown } from './EntityMentionDropdown';

type ReactQuillProps = ComponentProps<typeof ReactQuill>;

interface QuillWithEntityMentionProps extends Omit<ReactQuillProps, 'ref'> {
  mappings: EntityMapping[];
  quillRef?: Ref<ReactQuill>;
}

/**
 * ReactQuill with "@entity" autocomplete. Typing "@" filters the known
 * entities (canonical names + aliases); accepting a suggestion replaces
 * "@query" with the canonical name so the "@" disappears. Dismissing
 * (Esc, focus loss) leaves "@" as plain typed text.
 */
export function QuillWithEntityMention({
  mappings,
  quillRef,
  readOnly,
  ...quillProps
}: QuillWithEntityMentionProps) {
  const innerRef = useRef<ReactQuill | null>(null);
  const { mention, accept, setActiveIndex } = useEntityMention({
    getQuill: () => innerRef.current?.getEditor() ?? null,
    mappings,
    enabled: !readOnly,
  });

  const setRefs = (el: ReactQuill | null) => {
    innerRef.current = el;
    if (typeof quillRef === 'function') {
      quillRef(el);
    } else if (quillRef) {
      // Standard ref-prop forwarding; the ref is owned by the caller.
      // oxlint-disable-next-line react/immutability
      (quillRef as { current: ReactQuill | null }).current = el;
    }
  };

  return (
    <>
      <ReactQuill ref={setRefs} readOnly={readOnly} {...quillProps} />
      {mention && (
        <EntityMentionDropdown
          suggestions={mention.suggestions}
          activeIndex={mention.activeIndex}
          position={mention.position}
          onPick={accept}
          onHover={setActiveIndex}
        />
      )}
    </>
  );
}
