// The anchors GitHub gives to the headings of a Markdown file, for links such as `plan.md#4-sprint-1-sessions`.

/** GitHub's slug: lower case, punctuation removed, spaces to hyphens (`4. Sprint 1: `ui-kit`` is `4-sprint-1-ui-kit`). */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The anchors of every heading outside a code fence; a repeated heading gets `-1`, `-2` like on GitHub. */
export function headingAnchors(markdown: string): string[] {
  const seen = new Map<string, number>();
  const anchors: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced ? /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (!heading) continue;
    const base = slug(heading[1]!);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.push(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}
