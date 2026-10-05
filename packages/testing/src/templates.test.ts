import { describe, expect, it } from 'vitest';
import { templateProblems, type TemplateLike } from './templates.ts';

/** A template whose render does exactly what `behaviour` says, to see that the checker notices. */
function fake(
  behaviour: (text: string) => { subject: string; text: string; html: string },
  catalogue: TemplateLike['catalogue'] = { en: { a: 'x' }, de: { a: 'y' } },
): TemplateLike {
  return {
    key: 'fix.fake',
    catalogue,
    render: (data) => behaviour((data as { text: string }).text),
  };
}
const make = (text: string) => ({ text });

describe('templateProblems', () => {
  it('finds nothing wrong with a template that escapes and keeps one line', () => {
    // eslint-disable-next-line no-control-regex -- the fake escapes control characters
    const controls = /[\u0000-\u001F\u2028\u2029\u202E\u2066]/g;
    const good = fake((text) => ({
      subject: text.replace(controls, ' '),
      text: text.replace(/[\u202E\u2066]/g, ''),
      html: text.replace(/[<>"]/g, '_').replace(/[\u202E\u2066]/g, ''),
    }));
    expect(templateProblems(good, make, {})).toEqual([]);
  });

  it('notices a subject with a line break, raw markup, a bidi mark and an injected attribute', () => {
    const bad = fake((text) => ({ subject: text, text, html: `<p ${text}>${text}</p>` }));
    const problems = templateProblems(bad, make, {}).join('\n');
    expect(problems).toContain('the subject has a line break');
    expect(problems).toContain('the subject has a bidirectional mark');
    expect(problems).toContain('the text has a bidirectional mark');
    expect(problems).toContain('raw markup');
  });

  it('notices a message that only one language has', () => {
    const lopsided = fake((t) => ({ subject: 's', text: t.slice(0, 0), html: '' }), {
      en: { a: 'x', b: 'z' },
      de: { a: 'y' },
    });
    expect(templateProblems(lopsided, make, {})).toContain('fix.fake: "b" is missing in de');
  });

  it('notices a fall back to English', () => {
    const falling: TemplateLike = {
      key: 'fix.falling',
      catalogue: { en: { a: 'x' }, de: { a: 'y' } },
      render: (_data, locale, _branding, options) => {
        if (locale === 'de') options?.onFallback?.('a');
        return { subject: 's', text: 't', html: 'h' };
      },
    };
    expect(templateProblems(falling, make, {})).toContain(
      'fix.falling/de: fell back to English for a',
    );
  });
});
