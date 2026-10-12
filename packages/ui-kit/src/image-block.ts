// The texts an `ImageBlock` shows, all given by the module that owns the image (it translates them), so the
// block holds no word of its own and no name of a record.
export interface ImageBlockTexts {
  title: string;
  /** The `alt` text of the image. */
  alt: string;
  /** Said when the record has no image. */
  none: string;
  /** The label of the file input. */
  choose: string;
  /** The line under the input: formats and size. */
  hint: string;
  remove: string;
  saved: string;
  removed: string;
  /** 413 and a file over the limit. */
  tooBig: string;
  /** 422. */
  invalid: string;
  /** 403. */
  forbidden: string;
}
