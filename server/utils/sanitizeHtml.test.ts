import { describe, expect, it } from 'vitest';
import { sanitizeHtml, sanitizePlainText } from './sanitizeHtml.js';

describe('sanitizeHtml', () => {
  it('keeps allowed html', () => {
    const html = '<p style="color: red">Hello <strong>world</strong></p>';
    expect(sanitizeHtml(html)).toContain('<p');
    expect(sanitizeHtml(html)).toContain('<strong>');
  });

  it('removes script tags', () => {
    const html = '<p>Hello</p><script>alert("xss")</script>';
    expect(sanitizeHtml(html)).not.toContain('<script>');
    expect(sanitizeHtml(html)).not.toContain('alert');
  });
});

describe('sanitizePlainText', () => {
  it('strips html and trims', () => {
    expect(sanitizePlainText('<p>  Hello world  </p>')).toBe('Hello world');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizePlainText('   ')).toBe('');
  });
});
