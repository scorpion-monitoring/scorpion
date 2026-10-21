// Whether a tile's body draws anything. A widget that has nothing to say (a card with no requests to decide)
// renders no element at all; the old dashboard hid its slot with a CSS `:has` rule, and a tile must not be left
// as a hole. The signal needs nothing from the widget: the tile watches its own body.
import type { Attachment } from 'svelte/attachments';

/** True when `node` has no element child (comments and white space are not drawing). */
export const isEmpty = (node: Element): boolean => node.childElementCount === 0;

/** An attachment that calls `report` with the body's emptiness now and after every change of its children. */
export function observeEmpty(report: (empty: boolean) => void): Attachment<HTMLElement> {
  return (node) => {
    const check = () => report(isEmpty(node));
    check();
    const observer = new MutationObserver(check);
    observer.observe(node, { childList: true });
    return () => observer.disconnect();
  };
}
