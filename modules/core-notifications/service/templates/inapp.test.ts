// The inbox form of a template's content: the same blocks as the mail, as plain text, cleaned and capped.
import { describe, expect, it } from 'vitest';
import { inAppFromContent, INAPP_TEXT_MAX, INAPP_TITLE_MAX } from './layout.ts';

describe('inAppFromContent', () => {
  it('takes the heading as title, text and list blocks as text, and the first link', () => {
    expect(
      inAppFromContent({
        subject: 'Subject',
        heading: 'Heading',
        blocks: [
          { kind: 'text', text: 'First' },
          { kind: 'list', items: ['a', 'b'] },
          { kind: 'note', text: 'small print' },
          { kind: 'action', label: 'Open', url: 'https://example.org/one' },
          { kind: 'action', label: 'Other', url: 'https://example.org/two' },
        ],
      }),
    ).toEqual({
      title: 'Heading',
      text: 'First\n\n- a\n- b',
      link: 'https://example.org/one',
    });
  });

  it('falls back to the subject when there is no heading, and to a word when both are empty', () => {
    expect(inAppFromContent({ subject: 'Only subject', blocks: [] }).title).toBe('Only subject');
    expect(inAppFromContent({ subject: ' ', blocks: [] }).title).toBe('Notification');
  });

  it('cleans hostile text: no line break in the title, no bidi mark, no control character', () => {
    const item = inAppFromContent({
      subject: 's',
      heading: 'Evil\r\nTitle‮gnp.exe\u0000',
      blocks: [{ kind: 'text', text: 'ab‮cd\u0007ef\nline two' }],
    });
    expect(item.title).toBe('Evil Titlegnp.exe');
    expect(item.text).toBe('abcdef\nline two');
  });

  it('does not turn markup into anything: it stays as text for a UI to escape', () => {
    const item = inAppFromContent({
      subject: 's',
      heading: '<script>alert(1)</script>',
      blocks: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }],
    });
    expect(item.title).toBe('<script>alert(1)</script>');
    expect(item.text).toBe('<img src=x onerror=alert(1)>');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/x', 'not a url', ''])(
    'drops the link %j',
    (url) => {
      expect(
        inAppFromContent({ subject: 's', blocks: [{ kind: 'action', label: 'Go', url }] }).link,
      ).toBeNull();
    },
  );

  it('caps the title and the text', () => {
    const item = inAppFromContent({
      subject: 's',
      heading: 'h'.repeat(INAPP_TITLE_MAX + 50),
      blocks: [{ kind: 'text', text: 'x'.repeat(INAPP_TEXT_MAX + 500) }],
    });
    expect(item.title).toHaveLength(INAPP_TITLE_MAX);
    expect(item.text.length).toBeLessThanOrEqual(INAPP_TEXT_MAX);
  });
});
