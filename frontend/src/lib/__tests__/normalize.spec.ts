import { describe, expect, it } from 'vitest'
import { norm } from '../normalize'

describe('norm', () => {
  // Cases from the implementation plan (Task 14), kept verbatim.
  it('enlève accents, apostrophes et casse', () => {
    expect(norm("Épée d'Aujourd'hui")).toBe('epee daujourdhui')
    expect(norm('Tête-de-faucon')).toBe('tete-de-faucon')
    expect(norm('  MIDA  ')).toBe('mida')
  })

  it('removes typographic apostrophes (’ and ‘) like straight ones', () => {
    expect(norm('D’Aujourd’hui')).toBe('daujourdhui')
    expect(norm('D‘Aujourd‘hui')).toBe('daujourdhui')
    expect(norm("Cœur d'Aujourd’hui")).toBe('coeur daujourdhui')
  })

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(norm('')).toBe('')
    expect(norm('   ')).toBe('')
    expect(norm('\t\n')).toBe('')
  })

  it('collapses internal whitespace runs into a single space', () => {
    expect(norm('Ace  of   Spades')).toBe('ace of spades')
    expect(norm('Ace\tof\n Spades')).toBe('ace of spades')
    expect(norm('  Ace   of  Spades  ')).toBe('ace of spades')
  })

  it('keeps hyphens', () => {
    expect(norm('Tête-de-faucon')).toContain('-')
    expect(norm('Mida-Multi-Tool')).toBe('mida-multi-tool')
  })

  it('strips cedilla and other combining marks', () => {
    expect(norm('Ça')).toBe('ca')
    expect(norm('Ünder Ñoño')).toBe('under nono')
    expect(norm('Crème brûlée à l’Élan')).toBe('creme brulee a lelan')
  })

  it('strips the whole U+0300–U+036F combining block and nothing beyond it', () => {
    // Code points are built explicitly so the boundaries stay visible in the source.
    const cp = (n: number): string => String.fromCodePoint(n)
    expect(norm(`a${cp(0x0300)}`)).toBe('a') // first combining mark (grave)
    expect(norm(`e${cp(0x0301)}`)).toBe('e') // combining acute, i.e. NFD of é
    expect(norm(`a${cp(0x0327)}`)).toBe('a') // combining cedilla
    expect(norm(`a${cp(0x036f)}`)).toBe('a') // last combining mark
    expect(norm(`a${cp(0x02ff)}`)).toBe(`a${cp(0x02ff)}`) // just before the block: kept
    expect(norm(`a${cp(0x0371)}`)).toBe(`a${cp(0x0371)}`) // just after the block (Greek heta): kept
  })

  it('expands the œ/æ ligatures so a plain-keyboard query matches French names', () => {
    expect(norm('ŒIL')).toBe('oeil')
    expect(norm('Æther')).toBe('aether')
    expect(norm("Œil d'un autre monde")).toBe(norm("oeil d'un autre monde"))
    expect(norm("Œil d'un autre monde")).toBe('oeil dun autre monde')
  })

  it('keeps non-Latin characters', () => {
    expect(norm('Привет')).toBe('привет')
    expect(norm('日本語')).toBe('日本語')
    expect(norm('Ελλάδα')).toBe('ελλαδα')
  })

  it('keeps digits and punctuation other than apostrophes', () => {
    expect(norm('Le Monarque (2.0)')).toBe('le monarque (2.0)')
    expect(norm('Vex Mythoclast!')).toBe('vex mythoclast!')
  })

  it('is idempotent', () => {
    for (const s of ["Épée d'Aujourd'hui", '  MIDA  ', 'Tête-de-faucon', 'ŒIL', '']) {
      expect(norm(norm(s))).toBe(norm(s))
    }
  })

  it('makes accented and unaccented spellings match (accent-insensitive search)', () => {
    expect(norm('Epee')).toBe(norm('Épée'))
    expect(norm('tete de faucon')).toBe(norm('Tête de Faucon'))
    expect(norm("l'oeil")).toBe(norm('L’oeil'))
  })
})
