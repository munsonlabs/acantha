/** Words worth suggesting: identifiers and plain words of three letters or more, not bare numbers. */
const WORD = /[\p{L}_$][\p{L}\p{N}_$]{2,59}/gu

/** The distinct words in a text, for completing words found in other files. */
export function wordsIn(text: string): Set<string> {
  return new Set(text.match(WORD) ?? [])
}
