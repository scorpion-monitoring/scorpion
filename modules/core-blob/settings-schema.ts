// The settings of core.blob: what an upload may be. An administrator changes them in the settings
// UI like those of any module; a change reaches every process within the settings cache time.
import { z } from '@scorpion/contracts';

/**
 * The hard ceiling for an upload, and the body limit of the upload routes. A setting can lower the
 * accepted size, never raise it above this: the request body is cut off here before it is read.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const DEFAULT_BLOB_SETTINGS = {
  maxBytes: 2 * 1024 * 1024,
  maxDimension: 2048,
  maxPixels: 40_000_000,
  unreferencedGraceHours: 24,
} as const;

export const settingsSchema = z.strictObject({
  /** The largest file accepted, before and after processing. */
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(MAX_UPLOAD_BYTES)
    .default(DEFAULT_BLOB_SETTINGS.maxBytes),
  /** A raster larger than this in either direction is scaled down to fit (never up). */
  maxDimension: z.number().int().min(16).max(8192).default(DEFAULT_BLOB_SETTINGS.maxDimension),
  /**
   * The most pixels a raster may declare. The file is small and the image is not when someone builds
   * a decompression bomb, so the header is checked before anything is decoded.
   */
  maxPixels: z.number().int().min(1_000).max(100_000_000).default(DEFAULT_BLOB_SETTINGS.maxPixels),
  /** How long a file nothing refers to is kept before the cleanup job removes it. */
  unreferencedGraceHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(DEFAULT_BLOB_SETTINGS.unreferencedGraceHours),
});

export type BlobSettings = z.output<typeof settingsSchema>;
