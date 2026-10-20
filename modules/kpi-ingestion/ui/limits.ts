// Limits the page shares with the server (each one is checked against the server's own constant in `ui.test.ts`, so they cannot drift).

/** How many services the picker's read lists at most (`PICKER_LIMIT`). */
export const PICKER_PAGE_SIZE = 50;
