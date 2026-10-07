// The keyboard rules of `Tabs` and the shape of `Breadcrumb`, as plain functions.

/**
 * The tab a key moves to, or `undefined` for a key that is not for the tab list. The arrows wrap round, Home
 * and End go to the ends (the pattern of the ARIA authoring practices for tabs with automatic activation).
 */
export function tabTarget(key: string, current: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export interface CrumbView {
  label: string;
  /** The address of a link; the last item and an item with no address are text. */
  href: string | undefined;
  /** The page the person is on: the last item. */
  current: boolean;
}

/** What each item of a breadcrumb is: the last is the current page and never a link. */
export function crumbViews(items: readonly { label: string; href?: string }[]): CrumbView[] {
  return items.map((item, index) => {
    const last = index === items.length - 1;
    return { label: item.label, href: last ? undefined : item.href, current: last };
  });
}
