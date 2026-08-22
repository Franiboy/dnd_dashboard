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

export const quillModules = {
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
      table: function (this: {
        quill: {
          getSelection: () => { index: number } | null;
          clipboard: { dangerouslyPasteHTML: (index: number, html: string) => void };
        };
      }) {
        const rowsInput = prompt('Anzahl Zeilen:', '2');
        const colsInput = prompt('Anzahl Spalten:', '2');
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
