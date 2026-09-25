import { useCallback, useEffect, useRef, type ComponentProps, type Ref } from 'react';
import ReactQuill from 'react-quill-new';
import type { EntityMapping } from '../../shared/types';
import { useEntityMention } from '../hooks/useEntityMention';
import { useI18n } from '../hooks/useI18n';
import { EntityMentionDropdown } from './EntityMentionDropdown';
import { applyQuillLocalization } from './quillConfig';

type ReactQuillProps = ComponentProps<typeof ReactQuill>;

interface QuillWithEntityMentionProps extends Omit<ReactQuillProps, 'ref'> {
  mappings: EntityMapping[];
  quillRef?: Ref<ReactQuill>;
  'aria-label'?: string;
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
  'aria-label': ariaLabel,
  ...quillProps
}: QuillWithEntityMentionProps) {
  const { t, language } = useI18n();
  const editorLabel = ariaLabel ?? t('diary.editor.label');
  const innerRef = useRef<ReactQuill | null>(null);
  const { mention, accept, setActiveIndex } = useEntityMention({
    getQuill: () => innerRef.current?.getEditor() ?? null,
    mappings,
    enabled: !readOnly,
  });

  const localizeEditor = useCallback(() => {
    const instance = innerRef.current;
    if (!instance) return;
    try {
      applyQuillLocalization(instance.getEditor(), t, language, editorLabel);
    } catch {
      // ReactQuill can briefly expose its ref before the editor is ready.
    }
  }, [editorLabel, language, t]);

  const setRefs = (el: ReactQuill | null) => {
    innerRef.current = el;
    if (typeof quillRef === 'function') {
      quillRef(el);
    } else if (quillRef) {
      // Standard ref-prop forwarding; the ref is owned by the caller.
      // oxlint-disable-next-line react/immutability
      (quillRef as { current: ReactQuill | null }).current = el;
    }
    if (el) localizeEditor();
  };

  useEffect(() => {
    localizeEditor();
  }, [localizeEditor]);

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
