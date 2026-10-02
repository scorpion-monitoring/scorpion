// One DOMPurify instance over a jsdom window, created on first use (jsdom is slow to load, and a
// process that never sanitises should not pay for it).
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

type Purifier = ReturnType<typeof createDOMPurify>;

/** A fresh instance. Hooks are per instance, so each kind of sanitising gets its own. */
export function createPurifier(): Purifier {
  return createDOMPurify(new JSDOM('').window);
}
