/** The largest icon the page lets a person pick, 8 MiB. The server's ceiling decides (413); this saves a long upload. */
export const MAX_ICON_BYTES = 8 * 1024 * 1024;
export const MAX_ICON_MIB = MAX_ICON_BYTES / (1024 * 1024);
