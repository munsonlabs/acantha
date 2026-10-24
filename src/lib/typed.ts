/**
 * What decides how much the editor does for a file, here on their own so checking them doesn't load the editor's code:
 * whether TypeScript understands it, and whether it's too big for the extras.
 */

/** Files TypeScript understands. */
export const TYPED = /\.(m?[jt]sx?|c[jt]s)$/

/**
 * Past this size (in characters, near enough bytes) a file is edited plainly: no completing from words, import paths or
 * TypeScript, and no change markers. A generated bundle or minified file needs none of it, and all of it costs.
 */
export const BIG_FILE = 500 * 1024
