import { describe, expect, it } from 'vitest';
import { BRANDING } from '../../test/template-fixtures.ts';
import { renderLayout, type Content } from './layout.ts';

const content: Content = {
  subject: 'Hello',
  heading: 'A heading',
  blocks: [
    { kind: 'text', text: 'First\n\nSecond line\nthird' },
    { kind: 'list', items: ['one', 'two'] },
    { kind: 'action', label: 'Open it', url: 'https://example.org/go#token=abc' },
    { kind: 'note', text: 'Small print' },
  ],
};

describe('renderLayout', () => {
  it('builds the plain text and the HTML from the same blocks, with the branding around them', () => {
    const { subject, text, html } = renderLayout(content, BRANDING, 'en');
    expect(subject).toBe('Hello');
    expect(text).toContain('A heading');
    expect(text).toContain('First\n\nSecond line\nthird');
    expect(text).toContain('- one\n- two');
    expect(text).toContain('Open it:\nhttps://example.org/go#token=abc');
    expect(text).toContain('This message was sent by Test Instance.');
    expect(text).toContain('Questions? Write to help@example.org.');
    expect(text).toContain('Imprint: https://example.org/imprint');
    expect(html).toContain('<h1');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('href="https://example.org/go#token=abc"');
    expect(html).toContain('src="https://example.org/api/internal/files/abc"');
    expect(html).toContain('<html lang="en">');
  });

  it('prints the footer in German', () => {
    const { text, html } = renderLayout(content, BRANDING, 'de');
    expect(text).toContain('Diese Nachricht wurde von Test Instance gesendet.');
    expect(text).toContain('Impressum: https://example.org/imprint');
    expect(html).toContain('<html lang="de">');
  });

  it('leaves out the logo, the contact line and the imprint when the branding has none', () => {
    const bare = { ...BRANDING, logoUrl: null, contactEmail: null, imprintUrl: null };
    const { text, html } = renderLayout(content, bare, 'en');
    expect(text).not.toContain('Questions?');
    expect(text).not.toContain('Imprint');
    expect(html).not.toContain('<img');
    expect(html).toContain('Test Instance');
  });

  it('shows no link for an address that is not http, https or mailto', () => {
    const { text, html } = renderLayout(
      { subject: 's', blocks: [{ kind: 'action', label: 'Go', url: 'javascript:alert(1)' }] },
      { ...BRANDING, imprintUrl: 'javascript:alert(2)', logoUrl: 'data:image/png;base64,AAAA' },
      'en',
    );
    expect(html).not.toMatch(/javascript:|data:image/);
    expect(text).not.toMatch(/javascript:|data:image/);
    expect(html).not.toContain('<img');
  });

  it('cleans a hostile instance name and subject: one line, no bidi mark, no markup', () => {
    const hostile = '<script>x</script>\r\nBcc: a@example.org\u202E';
    const { subject, text, html } = renderLayout(
      { subject: hostile, blocks: [{ kind: 'text', text: 'hi' }] },
      { ...BRANDING, instanceName: hostile, logoUrl: null },
      'en',
    );
    expect(subject).not.toMatch(/[\r\n\u202E]/);
    expect(text).not.toContain('\u202E');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to the instance name for an empty subject', () => {
    expect(renderLayout({ subject: '\r\n', blocks: [] }, BRANDING, 'en').subject).toBe(
      'Test Instance',
    );
  });
});
