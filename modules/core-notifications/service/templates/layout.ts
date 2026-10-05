// The shared layout of every mail (M4 decision 3: typed functions, no template engine). A template
// returns content blocks; this file turns the same blocks into the plain-text part and the HTML
// part, so the two cannot drift apart and no template escapes anything itself. Instance name, logo,
// contact address and imprint link come from the branding settings, never from here (rule 9).
import { createTranslator, type Catalogues, type Translate } from './i18n.ts';
import type { Locale } from './locale.ts';
import { escapeHtml, multiLine, oneLine, safeUrl } from './text.ts';

/** What the layout needs of the branding settings, ready to print. */
export interface TemplateBranding {
  productName: string;
  instanceName: string;
  contactEmail: string | null;
  imprintUrl: string | null;
  /** Absolute URL of the light logo, or `null` when none is uploaded. */
  logoUrl: string | null;
  /** `<ORIGIN><BASE_PATH>`: where the instance is reached, for a template that builds a link. */
  baseUrl: string;
}

export type Block =
  /** A paragraph. Line breaks inside it are kept. */
  | { kind: 'text'; text: string }
  /** The thing the mail is for: a button in HTML, `label: url` in plain text. */
  | { kind: 'action'; label: string; url: string }
  | { kind: 'list'; items: string[] }
  /** Small print. */
  | { kind: 'note'; text: string };

export interface Content {
  /** One line; line breaks and bidirectional marks are removed whatever the template put in. */
  subject: string;
  heading?: string;
  blocks: Block[];
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const LAYOUT: Catalogues = {
  en: {
    'footer.sentBy': 'This message was sent by {instance}.',
    'footer.contact': 'Questions? Write to {email}.',
    'footer.imprint': 'Imprint',
    'action.copy': 'If the button does not work, copy this link into your browser:',
  },
  de: {
    'footer.sentBy': 'Diese Nachricht wurde von {instance} gesendet.',
    'footer.contact': 'Fragen? Schreiben Sie an {email}.',
    'footer.imprint': 'Impressum',
    'action.copy':
      'Wenn die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
};

/** The footer lines of the layout in one language. */
export function layoutTranslator(locale: Locale, onFallback?: (key: string) => void): Translate {
  return createTranslator(LAYOUT, locale, { onFallback });
}

const STYLE = {
  body: 'margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2933;',
  card: 'max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;',
  heading: 'margin:0 0 16px;font-size:20px;line-height:1.3;',
  paragraph: 'margin:0 0 16px;font-size:16px;line-height:1.5;',
  note: 'margin:0 0 16px;font-size:13px;line-height:1.5;color:#52606d;',
  button:
    'display:inline-block;padding:12px 20px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;',
  footer: 'margin:24px 0 0;font-size:12px;line-height:1.5;color:#7b8794;',
};

const paragraphs = (text: string) =>
  escapeHtml(text)
    .replace(/\n{2,}/g, '</p><p style="' + STYLE.paragraph + '">')
    .replace(/\n/g, '<br>');

function htmlBlock(block: Block, copyHint: string): string {
  switch (block.kind) {
    case 'text':
      return `<p style="${STYLE.paragraph}">${paragraphs(multiLine(block.text))}</p>`;
    case 'note':
      return `<p style="${STYLE.note}">${paragraphs(multiLine(block.text))}</p>`;
    case 'list':
      return `<ul style="${STYLE.paragraph}">${block.items
        .map((item) => `<li>${escapeHtml(oneLine(item, 500))}</li>`)
        .join('')}</ul>`;
    case 'action': {
      const href = safeUrl(block.url);
      const label = escapeHtml(oneLine(block.label, 100));
      // The URL is shown as text under the button too, for clients that block buttons.
      return href
        ? `<p style="${STYLE.paragraph}"><a href="${escapeHtml(href)}" style="${STYLE.button}">${label}</a></p>` +
            `<p style="${STYLE.note}">${escapeHtml(copyHint)}<br><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>`
        : `<p style="${STYLE.paragraph}">${label}</p>`;
    }
  }
}

function textBlock(block: Block, copyHint: string): string {
  switch (block.kind) {
    case 'text':
    case 'note':
      return multiLine(block.text);
    case 'list':
      return block.items.map((item) => `- ${oneLine(item, 500)}`).join('\n');
    case 'action': {
      const href = safeUrl(block.url);
      return href ? `${oneLine(block.label, 100)}:\n${href}` : oneLine(block.label, 100);
    }
  }
  void copyHint;
}

/** Turns content into the three parts of a mail, with the branding around it. */
export function renderLayout(
  content: Content,
  branding: TemplateBranding,
  locale: Locale,
  onFallback?: (key: string) => void,
): RenderedMail {
  const t = layoutTranslator(locale, onFallback);
  const instance = oneLine(branding.instanceName, 100);
  const subject = oneLine(content.subject, 300) || instance;
  const sentBy = t('footer.sentBy', { instance });
  const contact = branding.contactEmail
    ? t('footer.contact', { email: branding.contactEmail })
    : undefined;
  const imprint = branding.imprintUrl ? safeUrl(branding.imprintUrl) : undefined;
  const imprintLabel = t('footer.imprint');
  const copyHint = t('action.copy');
  const heading = content.heading ? oneLine(content.heading, 200) : undefined;

  const text = [
    ...(heading ? [heading, ''] : []),
    content.blocks.map((block) => textBlock(block, copyHint)).join('\n\n'),
    '',
    '--',
    sentBy,
    ...(contact ? [contact] : []),
    ...(imprint ? [`${imprintLabel}: ${imprint}`] : []),
    '',
  ].join('\n');

  const logo = branding.logoUrl ? safeUrl(branding.logoUrl) : undefined;
  const html = [
    '<!doctype html>',
    `<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(subject)}</title></head>`,
    `<body style="${STYLE.body}"><div style="${STYLE.card}">`,
    logo
      ? `<p style="margin:0 0 24px;"><img src="${escapeHtml(logo)}" alt="${escapeHtml(instance)}" style="max-height:48px;max-width:240px;"></p>`
      : `<p style="margin:0 0 24px;font-size:18px;font-weight:700;">${escapeHtml(instance)}</p>`,
    ...(heading ? [`<h1 style="${STYLE.heading}">${escapeHtml(heading)}</h1>`] : []),
    ...content.blocks.map((block) => htmlBlock(block, copyHint)),
    `<p style="${STYLE.footer}">${escapeHtml(sentBy)}`,
    ...(contact ? [`<br>${escapeHtml(contact)}`] : []),
    ...(imprint ? [`<br><a href="${escapeHtml(imprint)}">${escapeHtml(imprintLabel)}</a>`] : []),
    '</p></div></body></html>',
  ].join('');

  return { subject, text, html };
}
