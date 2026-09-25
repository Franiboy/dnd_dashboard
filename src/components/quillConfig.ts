import Quill from 'quill';
import type { Language } from '../../shared/types';
import { createTranslator, type TFunction } from '../i18n';

export function stripHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

export function isHtml(text: string): boolean {
  return /<[^>]+>/.test(text.trim());
}

export function ensureHtml(text: string): string {
  if (isHtml(text)) return text;
  return text
    .trim()
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function isEmptyHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if ((doc.body.textContent || '').trim()) return false;
  return !doc.querySelector('img, iframe, video, audio, hr');
}

export function createTableHtml(rows: number, cols: number): string {
  let html = '<table><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += '<td><p><br></p></td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

interface TableToolbarContext {
  quill: {
    getSelection: () => { index: number } | null;
    clipboard: { dangerouslyPasteHTML: (index: number, html: string) => void };
  };
}

interface KeyboardContext {
  format: Record<string, unknown>;
  event: KeyboardEvent;
  collapsed: boolean;
  offset: number;
}

function currentLanguage(): Language {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.lang.toLowerCase().startsWith('en')
  ) {
    return 'en';
  }
  return 'de';
}

function defaultTranslator(): TFunction {
  return createTranslator(currentLanguage());
}

export function createQuillModules(t: TFunction = defaultTranslator()) {
  return {
    keyboard: {
      bindings: {
        // Quill's default Tab binding inserts a literal tab character into
        // plain paragraphs, which looks different from the toolbar's indent
        // buttons (they set the block-level indent format). Replace it so Tab
        // always applies the same indent format as the buttons. Tables keep
        // their cell navigation and code blocks keep literal tabs.
        tab: {
          key: 'Tab',
          handler: function (
            this: { quill: Quill },
            range: { index: number; length: number },
            context: KeyboardContext
          ) {
            if (
              context.event.shiftKey ||
              (context.collapsed &&
                context.offset !== 0 &&
                (context.format.list || context.format.indent || context.format.blockquote))
            ) {
              const Delta = Quill.import('delta');
              const delta = new Delta().retain(range.index).delete(range.length).insert('\t');
              this.quill.history.cutoff();
              this.quill.updateContents(delta, 'user');
              this.quill.history.cutoff();
              this.quill.setSelection(range.index + 1, 'silent');
              return false;
            }
            this.quill.format('indent', '+1', 'user');
            return false;
          },
        },
      },
    },
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ align: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ indent: '-1' }, { indent: '+1' }],
        ['blockquote', 'code-block'],
        ['link'],
        ['table'],
        ['clean'],
      ],
      handlers: {
        table: function (this: TableToolbarContext) {
          const rowsInput = prompt(t('diary.editor.tableRowsPrompt'), '2');
          const colsInput = prompt(t('diary.editor.tableColumnsPrompt'), '2');
          const rows = parseInt(rowsInput || '0', 10);
          const cols = parseInt(colsInput || '0', 10);
          if (rows > 0 && cols > 0) {
            const range = this.quill.getSelection();
            const index = range ? range.index : 0;
            this.quill.clipboard.dangerouslyPasteHTML(index, createTableHtml(rows, cols));
          }
        },
      },
    },
  };
}

/** Backwards-compatible default configuration for non-Diary editors. */
export const quillModules = createQuillModules();

function getToolbarContainer(quill: Quill): HTMLElement | null {
  const toolbar = quill.getModule('toolbar') as { container?: HTMLElement } | undefined;
  return toolbar?.container instanceof HTMLElement ? toolbar.container : null;
}

function setLabel(element: Element, label: string): void {
  element.setAttribute('aria-label', label);
  element.setAttribute('title', label);
}

const localeStyleId = 'dnd-quill-locale-styles';

function ensureQuillLocaleStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(localeStyleId)) return;
  const style = document.createElement('style');
  style.id = localeStyleId;
  style.textContent = `
    [data-quill-locale] .ql-snow .ql-tooltip::before { content: var(--quill-visit-url); }
    [data-quill-locale] .ql-snow .ql-tooltip[data-mode="link"]::before { content: var(--quill-enter-link); }
    [data-quill-locale] .ql-snow .ql-tooltip a.ql-action::after { content: var(--quill-link-edit); }
    [data-quill-locale] .ql-snow .ql-tooltip a.ql-remove::before { content: var(--quill-link-remove); }
    [data-quill-locale] .ql-snow .ql-tooltip.ql-editing a.ql-action::after { content: var(--quill-link-save); }
  `;
  document.head.appendChild(style);
}

/** Apply translated labels to Quill's generated toolbar and link tooltip. */
export function applyQuillLocalization(
  quill: Quill,
  t: TFunction,
  language: Language,
  editorLabel?: string
): void {
  if (editorLabel) quill.root.setAttribute('aria-label', editorLabel);
  const toolbar = getToolbarContainer(quill);
  if (!toolbar) return;

  ensureQuillLocaleStyles();
  const host = quill.container;
  host.dataset.quillLocale = language;
  host.style.setProperty('--quill-visit-url', JSON.stringify(t('diary.editor.link.visit')));
  host.style.setProperty('--quill-enter-link', JSON.stringify(t('diary.editor.link.enter')));
  host.style.setProperty('--quill-link-edit', JSON.stringify(t('diary.editor.link.edit')));
  host.style.setProperty('--quill-link-remove', JSON.stringify(t('diary.editor.link.remove')));
  host.style.setProperty('--quill-link-save', JSON.stringify(t('diary.editor.link.save')));

  toolbar
    .querySelectorAll<HTMLElement>('button.ql-bold')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.bold')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-italic')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.italic')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-underline')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.underline')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-strike')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.strike')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-blockquote')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.blockquote')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-code-block')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.codeBlock')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-link')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.link')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-table')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.table')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-clean')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.clean')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-list[value="ordered"]')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.orderedList')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-list[value="bullet"]')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.bulletList')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-indent[value="-1"]')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.decreaseIndent')));
  toolbar
    .querySelectorAll<HTMLElement>('button.ql-indent[value="+1"]')
    .forEach((element) => setLabel(element, t('diary.editor.toolbar.increaseIndent')));

  const header = toolbar.querySelector<HTMLSelectElement>('select.ql-header');
  if (header) {
    setLabel(header, t('diary.editor.toolbar.header'));
    header.querySelectorAll('option').forEach((option) => {
      const value = option.value;
      const label = value
        ? t('diary.editor.toolbar.heading', { number: value })
        : t('diary.editor.toolbar.normal');
      option.textContent = label;
      option.setAttribute('data-label', label);
      option.setAttribute('aria-label', label);
    });
  }

  const align = toolbar.querySelector<HTMLSelectElement>('select.ql-align');
  if (align) {
    setLabel(align, t('diary.editor.toolbar.align'));
    const labels = [
      t('diary.editor.toolbar.alignLeft'),
      t('diary.editor.toolbar.alignCenter'),
      t('diary.editor.toolbar.alignRight'),
      t('diary.editor.toolbar.alignJustify'),
    ];
    align.querySelectorAll('option').forEach((option, index) => {
      const label = labels[index] ?? t('diary.editor.toolbar.align');
      option.textContent = label;
      option.setAttribute('data-label', label);
      option.setAttribute('aria-label', label);
    });
  }

  const color = toolbar.querySelector<HTMLSelectElement>('select.ql-color');
  if (color) setLabel(color, t('diary.editor.toolbar.textColor'));
  const background = toolbar.querySelector<HTMLSelectElement>('select.ql-background');
  if (background) setLabel(background, t('diary.editor.toolbar.highlight'));
}

export const quillFormats = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'align',
  'list',
  'bullet',
  'indent',
  'blockquote',
  'code-block',
  'link',
  'table',
  'entity',
];
