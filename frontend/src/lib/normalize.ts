/**
 * Search normalisation for the accent-insensitive autocomplete (REQ-014).
 *
 * `norm` maps both the query and the item names (FR and EN) to a comparable
 * form: lower case, no diacritics, no apostrophes, trimmed, internal
 * whitespace collapsed. Hyphens and every other character are kept.
 *
 * Diacritics are removed by NFD decomposition followed by stripping the
 * combining marks (U+0300–U+036F). The ligatures `œ`/`æ` have no canonical
 * decomposition, so they are expanded explicitly (`Œil` → `oeil`) to let a
 * plain-keyboard query match French item names such as « Œil d'un autre monde ».
 */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/['’‘]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
