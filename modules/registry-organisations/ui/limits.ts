/** The largest logo the page lets a person pick, 8 MiB. The server's ceiling decides (413); this saves a long upload. */
export const MAX_LOGO_BYTES = 8 * 1024 * 1024;
export const MAX_LOGO_MIB = MAX_LOGO_BYTES / (1024 * 1024);
