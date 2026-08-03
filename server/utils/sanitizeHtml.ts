import { type Config, sanitize } from 'isomorphic-dompurify';

const HTML_PURIFY_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['style'],
};

export function sanitizeHtml(html: string): string {
  return sanitize(html, HTML_PURIFY_CONFIG) as unknown as string;
}

export function sanitizePlainText(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}
