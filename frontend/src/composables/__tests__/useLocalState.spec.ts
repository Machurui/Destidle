import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import GuessBoard from '@/components/GuessBoard.vue'
import LosePanel from '@/components/LosePanel.vue'
import WinPanel from '@/components/WinPanel.vue'
import en from '@/i18n/en.json'
import fr from '@/i18n/fr.json'
import type { Category, Feedback, GuessResult, ItemDisplay, MatchKind } from '@/lib/api'
import type { StoredBoard } from '../useLocalState'
import {
  STORAGE_KEY,
  boardKey,
  clearDailyBoards,
  getStreak,
  loadBoard,
  recordDailyWin,
  saveBoard,
} from '../useLocalState'

const display = (id: number): ItemDisplay => ({
  id,
  nameEn: `Item ${id}`,
  nameFr: `Objet ${id}`,
  game: 'D2',
  rarityEn: 'Exotic',
  rarityFr: 'Exotique',
  seasonEn: 'Season 1',
  seasonFr: 'Saison 1',
  slotEn: 'Kinetic',
  slotFr: 'Cinétique',
  typeEn: 'Hand Cannon',
  typeFr: 'Revolver',
  element: 'Solar',
  elementEn: 'Solar',
  elementFr: 'Solaire',
  classEn: null,
  classFr: null,
  lightGgUrl: null,
})

const guess = (id: number, correct = false): GuessResult => ({
  correct,
  guess: display(id),
  feedback: {
    rarity: 'hit',
    season: { kind: 'miss', dir: 1 },
    slot: 'miss',
    type: 'near',
    element: 'hit',
    class: null,
    game: 'hit',
  },
})

const armorDisplay = (id: number): ItemDisplay => ({
  ...display(id),
  slotEn: null,
  slotFr: null,
  typeEn: 'Helmet',
  typeFr: 'Casque',
  element: null,
  elementEn: null,
  elementFr: null,
  classEn: 'Titan',
  classFr: 'Titan',
})

const armorFeedback = (kind: MatchKind, dir: -1 | 0 | 1): Feedback => ({
  rarity: kind,
  season: { kind, dir },
  slot: kind,
  type: null,
  element: null,
  class: kind,
  game: kind,
})

const board = (overrides: Partial<StoredBoard> = {}): StoredBoard => ({
  token: 'tok',
  guesses: [],
  status: 'playing',
  ...overrides,
})

function rawStore(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('STORAGE_KEY', () => {
  it('is destidle.v1', () => {
    expect(STORAGE_KEY).toBe('destidle.v1')
  })
})

describe('boardKey', () => {
  it('builds daily keys with the date', () => {
    expect(boardKey('daily', 'weapon', '2026-07-16')).toBe('daily|weapon|2026-07-16')
    expect(boardKey('daily', 'armor', '2026-07-16')).toBe('daily|armor|2026-07-16')
  })

  it('builds free keys without date', () => {
    expect(boardKey('free', 'armor')).toBe('free|armor')
    expect(boardKey('free', 'weapon')).toBe('free|weapon')
    expect(boardKey('free', 'weapon', '2026-07-16')).toBe('free|weapon')
  })
})

describe('saveBoard / loadBoard', () => {
  it('returns null when nothing is stored', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(loadBoard(boardKey('free', 'weapon'))).toBeNull()
  })

  it('round-trips a board with guesses and a revealed item', () => {
    const key = boardKey('daily', 'weapon', '2026-07-16')
    const b = board({
      token: 'daily-token',
      date: '2026-07-16',
      number: 42,
      guesses: [guess(1), guess(2, true)],
      status: 'won',
      revealed: display(2),
    })
    saveBoard(key, b)
    expect(loadBoard(key)).toEqual(b)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('returns null for an unknown key', () => {
    saveBoard(boardKey('free', 'weapon'), board())
    expect(loadBoard(boardKey('free', 'armor'))).toBeNull()
    expect(loadBoard('daily|weapon|2026-07-16')).toBeNull()
    expect(loadBoard('')).toBeNull()
  })

  it('overwrites an existing board with the same key', () => {
    const key = boardKey('free', 'weapon')
    saveBoard(key, board({ token: 'a' }))
    saveBoard(key, board({ token: 'b', guesses: [guess(1)] }))
    expect(loadBoard(key)).toEqual(board({ token: 'b', guesses: [guess(1)] }))
  })

  it('keeps the four mode × category combinations independent', () => {
    const keys = {
      dailyWeapon: boardKey('daily', 'weapon', '2026-07-16'),
      dailyArmor: boardKey('daily', 'armor', '2026-07-16'),
      freeWeapon: boardKey('free', 'weapon'),
      freeArmor: boardKey('free', 'armor'),
    }
    saveBoard(keys.dailyWeapon, board({ token: 'dw', date: '2026-07-16', number: 1 }))
    saveBoard(keys.dailyArmor, board({ token: 'da', date: '2026-07-16', number: 1 }))
    saveBoard(keys.freeWeapon, board({ token: 'fw', guesses: [guess(1)] }))
    saveBoard(keys.freeArmor, board({ token: 'fa', status: 'lost', revealed: display(9) }))

    expect(loadBoard(keys.dailyWeapon)?.token).toBe('dw')
    expect(loadBoard(keys.dailyArmor)?.token).toBe('da')
    expect(loadBoard(keys.freeWeapon)?.token).toBe('fw')
    expect(loadBoard(keys.freeArmor)?.token).toBe('fa')
    expect(loadBoard(keys.freeWeapon)?.guesses).toHaveLength(1)
    expect(loadBoard(keys.freeArmor)?.status).toBe('lost')

    const store = rawStore() as { boards: Record<string, unknown> }
    expect(Object.keys(store.boards).sort()).toEqual(Object.values(keys).sort())
  })

  it('keeps daily boards of different dates apart', () => {
    saveBoard(boardKey('daily', 'weapon', '2026-07-16'), board({ token: 'd16' }))
    saveBoard(boardKey('daily', 'weapon', '2026-07-17'), board({ token: 'd17' }))
    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-16'))?.token).toBe('d16')
    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-17'))?.token).toBe('d17')
  })
})

describe('clearDailyBoards', () => {
  it('removes the other daily boards of the category and keeps everything else', () => {
    saveBoard(boardKey('daily', 'weapon', '2026-07-16'), board({ token: 'old' }))
    saveBoard(boardKey('daily', 'weapon', '2026-07-17'), board({ token: 'keep' }))
    saveBoard(boardKey('daily', 'armor', '2026-07-16'), board({ token: 'armor' }))
    saveBoard(boardKey('free', 'weapon'), board({ token: 'free' }))

    clearDailyBoards('weapon', '2026-07-17')

    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-16'))).toBeNull()
    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-17'))?.token).toBe('keep')
    expect(loadBoard(boardKey('daily', 'armor', '2026-07-16'))?.token).toBe('armor')
    expect(loadBoard(boardKey('free', 'weapon'))?.token).toBe('free')
  })

  it('removes several stale daily boards at once', () => {
    saveBoard(boardKey('daily', 'armor', '2026-07-14'), board({ token: 'a' }))
    saveBoard(boardKey('daily', 'armor', '2026-07-15'), board({ token: 'b' }))
    saveBoard(boardKey('daily', 'armor', '2026-07-16'), board({ token: 'c' }))
    clearDailyBoards('armor', '2026-07-16')
    const store = rawStore() as { boards: Record<string, unknown> }
    expect(Object.keys(store.boards)).toEqual(['daily|armor|2026-07-16'])
  })

  it('is a no-op when there is nothing to remove', () => {
    saveBoard(boardKey('daily', 'weapon', '2026-07-17'), board({ token: 'keep' }))
    const before = localStorage.getItem(STORAGE_KEY)
    expect(() => clearDailyBoards('weapon', '2026-07-17')).not.toThrow()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(() => clearDailyBoards('armor', '2026-07-17')).not.toThrow()
  })

  it('does not throw on empty storage', () => {
    expect(() => clearDailyBoards('weapon', '2026-07-17')).not.toThrow()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('does not keep a stale board when keepDate differs from the stored date', () => {
    saveBoard(boardKey('daily', 'weapon', '2026-07-16'), board({ token: 'old', date: '2026-07-16' }))
    clearDailyBoards('weapon', '2026-07-17')
    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-16'))).toBeNull()
    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-17'))).toBeNull()
  })
})

describe('corrupted storage (REQ-015: silent reset)', () => {
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  function expectSilent() {
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  }

  it.each([
    ['{not json', 'not JSON'],
    ['', 'empty string'],
    ['null', 'JSON null'],
    ['42', 'JSON number'],
    ['"str"', 'JSON string'],
    ['[]', 'JSON array'],
    ['{"boards":"x","streaks":5}', 'wrong member types'],
    ['{"boards":[],"streaks":[]}', 'arrays instead of records'],
    ['{"boards":null,"streaks":null}', 'null members'],
  ])('resets silently on %j (%s)', (raw) => {
    localStorage.setItem(STORAGE_KEY, raw)
    const key = boardKey('free', 'weapon')

    expect(() => loadBoard(key)).not.toThrow()
    expect(loadBoard(key)).toBeNull()
    expect(() => getStreak('weapon')).not.toThrow()
    expect(getStreak('weapon')).toBe(0)
    expect(() => clearDailyBoards('weapon', '2026-07-16')).not.toThrow()

    // storage keeps working afterwards
    const b = board({ token: 'after', guesses: [guess(1)] })
    expect(() => saveBoard(key, b)).not.toThrow()
    expect(loadBoard(key)).toEqual(b)
    expect(rawStore()).toEqual({ boards: { [key]: b }, streaks: {} })
    expectSilent()
  })

  it('ignores boards with an invalid shape and keeps the valid neighbours', () => {
    const valid = board({ token: 'ok', guesses: [guess(1)], status: 'playing' })
    const validDaily = board({ token: 'ok-daily', date: '2026-07-16', number: 3, status: 'won' })
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'free|weapon': valid,
          'daily|weapon|2026-07-16': validDaily,
          'free|armor': { guesses: [], status: 'playing' }, // token missing
          'daily|armor|2026-07-16': { token: 't', guesses: [], status: 'nope' }, // bad status
          'daily|armor|2026-07-15': { token: 't', guesses: 'x', status: 'playing' }, // bad guesses
          'daily|armor|2026-07-14': { token: 7, guesses: [], status: 'playing' }, // bad token type
          'daily|armor|2026-07-13': { token: 't', guesses: [], status: 'playing', date: 5 }, // bad date
          'daily|armor|2026-07-12': { token: 't', guesses: [], status: 'playing', number: 'n' }, // bad number
          'daily|armor|2026-07-11': { token: 't', guesses: [], status: 'playing', revealed: 'x' }, // bad revealed
          'daily|armor|2026-07-10': null,
          'daily|armor|2026-07-09': 'string',
          'daily|armor|2026-07-08': [],
        },
        streaks: {},
      }),
    )

    expect(loadBoard('free|weapon')).toEqual(valid)
    expect(loadBoard('daily|weapon|2026-07-16')).toEqual(validDaily)
    for (const key of [
      'free|armor',
      'daily|armor|2026-07-16',
      'daily|armor|2026-07-15',
      'daily|armor|2026-07-14',
      'daily|armor|2026-07-13',
      'daily|armor|2026-07-12',
      'daily|armor|2026-07-11',
      'daily|armor|2026-07-10',
      'daily|armor|2026-07-09',
      'daily|armor|2026-07-08',
    ]) {
      expect(loadBoard(key), key).toBeNull()
    }
    expectSilent()
  })

  /** A feedback valid under CT-04, so that each case below carries one defect only. */
  const okFeedback = (): Feedback => guess(1).feedback

  // SEC-F7 / reviewer C2: a corrupted element inside `guesses[]` used to be
  // accepted and made `usedIds` throw instead of the silent reset.
  const invalidGuesses: ReadonlyArray<[string, unknown]> = [
    ['null', null],
    ['a string', 'x'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
    ['correct not a boolean', { correct: 'yes', guess: display(1), feedback: okFeedback() }],
    ['guess missing', { correct: true, feedback: okFeedback() }],
    ['guess null', { correct: true, guess: null, feedback: okFeedback() }],
    ['guess an array', { correct: true, guess: [1], feedback: okFeedback() }],
    ['guess.id not a number', { correct: true, guess: { ...display(1), id: '1' }, feedback: okFeedback() }],
    ['guess.id missing', { correct: true, guess: { nameEn: 'x' }, feedback: okFeedback() }],
    ['feedback missing', { correct: true, guess: display(1) }],
    ['feedback not an object', { correct: true, guess: display(1), feedback: 'hit' }],
    ['feedback an empty object', { correct: true, guess: display(1), feedback: {} }],
  ]

  it.each(invalidGuesses)('drops a board whose guesses contain %s and keeps the valid neighbour', (_label, bad) => {
    const valid = board({ token: 'ok', guesses: [guess(1), guess(2, true)], status: 'won' })
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'free|weapon': valid,
          'free|armor': { token: 'bad', guesses: [guess(1), bad], status: 'playing' },
          'daily|armor|2026-07-16': { token: 'bad', date: '2026-07-16', number: 1, guesses: [bad], status: 'playing' },
        },
        streaks: {},
      }),
    )

    expect(() => loadBoard('free|armor')).not.toThrow()
    expect(loadBoard('free|armor')).toBeNull()
    expect(loadBoard('daily|armor|2026-07-16')).toBeNull()
    expect(loadBoard('free|weapon')).toEqual(valid)
    // the dropped boards disappear from storage on the next save
    saveBoard('free|armor', board({ token: 'fresh' }))
    const store = rawStore() as { boards: Record<string, unknown> }
    expect(Object.keys(store.boards).sort()).toEqual(['free|armor', 'free|weapon'])
    expect(loadBoard('free|armor')).toEqual(board({ token: 'fresh' }))
    expectSilent()
  })

  it('does not require the display strings of a guess (an absent string renders empty)', () => {
    const minimal = { correct: false, guess: { id: 3 }, feedback: okFeedback() }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ boards: { 'free|weapon': { token: 't', guesses: [minimal], status: 'playing' } }, streaks: {} }),
    )
    expect(loadBoard('free|weapon')?.guesses).toEqual([minimal])
    expectSilent()
  })

  // SEC-F12 / C87: `GuessRow` dereferences `feedback.season` (`kind`, `dir`)
  // and turns the other kinds into class tokens, so the whole CT-04 shape of
  // `feedback` is checked when a board is restored.
  const feedbackWithout = (field: keyof Feedback): Record<string, unknown> => {
    const f: Record<string, unknown> = { ...okFeedback() }
    delete f[field]
    return f
  }
  const invalidFeedbacks: ReadonlyArray<[string, unknown]> = [
    ['season missing', feedbackWithout('season')],
    ['season null', { ...okFeedback(), season: null }],
    ['season a string', { ...okFeedback(), season: 'hit' }],
    ['season an array', { ...okFeedback(), season: ['miss', 1] }],
    ['season.kind unknown', { ...okFeedback(), season: { kind: 'exact', dir: 1 } }],
    ['season.kind missing', { ...okFeedback(), season: { dir: 1 } }],
    ['season.kind null', { ...okFeedback(), season: { kind: null, dir: 0 } }],
    ['season.dir 2', { ...okFeedback(), season: { kind: 'miss', dir: 2 } }],
    ['season.dir -2', { ...okFeedback(), season: { kind: 'miss', dir: -2 } }],
    ['season.dir 0.5', { ...okFeedback(), season: { kind: 'near', dir: 0.5 } }],
    ['season.dir a string', { ...okFeedback(), season: { kind: 'miss', dir: '1' } }],
    ['season.dir null', { ...okFeedback(), season: { kind: 'hit', dir: null } }],
    ['season.dir missing', { ...okFeedback(), season: { kind: 'hit' } }],
    ['rarity unknown', { ...okFeedback(), rarity: 'exact' }],
    ['rarity upper case', { ...okFeedback(), rarity: 'HIT' }],
    ['rarity an inherited key', { ...okFeedback(), rarity: 'constructor' }],
    ['rarity an object', { ...okFeedback(), rarity: { hit: true } }],
    ['rarity null', { ...okFeedback(), rarity: null }],
    ['rarity missing', feedbackWithout('rarity')],
    ['slot null', { ...okFeedback(), slot: null }],
    ['slot missing', feedbackWithout('slot')],
    ['game unknown', { ...okFeedback(), game: 'D2' }],
    ['game missing', feedbackWithout('game')],
    ['type unknown', { ...okFeedback(), type: 'yes' }],
    ['type absent', feedbackWithout('type')],
    ['element unknown', { ...okFeedback(), element: 'Solar' }],
    ['element absent', feedbackWithout('element')],
    ['class unknown', { ...okFeedback(), class: 'Titan' }],
    ['class: undefined (absent once serialized)', { ...okFeedback(), class: undefined }],
    ['class absent', feedbackWithout('class')],
  ]

  it.each(invalidFeedbacks)('drops a board whose feedback has %s and keeps the valid neighbour', (_label, bad) => {
    const valid = board({ token: 'ok', guesses: [guess(1), guess(2, true)], status: 'won' })
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'free|weapon': valid,
          'free|armor': { token: 'bad', guesses: [guess(1), { correct: false, guess: display(2), feedback: bad }], status: 'playing' },
        },
        streaks: {},
      }),
    )

    expect(() => loadBoard('free|armor')).not.toThrow()
    expect(loadBoard('free|armor')).toBeNull()
    expect(loadBoard('free|weapon')).toEqual(valid)
    expectSilent()
  })

  // `ElementBadge` uses `element` as a lookup key: an object whose `toString`
  // is not callable throws while being converted to a property key.
  const invalidElements: ReadonlyArray<[string, unknown]> = [
    ['an object with a non-callable toString', { toString: 'x' }],
    ['an array holding such an object', [{ toString: 'x' }]],
    ['an empty object', {}],
    ['an array', ['Solar']],
    ['a number', 7],
    ['a boolean', true],
  ]

  it.each(invalidElements)('drops a board whose guess.element is %s', (_label, element) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'free|weapon': board({ token: 'ok', guesses: [guess(1)] }),
          'free|armor': { token: 'bad', guesses: [{ ...guess(2), guess: { ...display(2), element } }], status: 'playing' },
        },
        streaks: {},
      }),
    )
    expect(() => loadBoard('free|armor')).not.toThrow()
    expect(loadBoard('free|armor')).toBeNull()
    expect(loadBoard('free|weapon')?.token).toBe('ok')
    expectSilent()
  })

  it.each(invalidElements)('drops a board whose revealed.element is %s', (_label, element) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'free|weapon': board({ token: 'ok', status: 'lost', revealed: display(1) }),
          'free|armor': { token: 'bad', guesses: [guess(2)], status: 'lost', revealed: { ...display(9), element } },
        },
        streaks: {},
      }),
    )
    expect(() => loadBoard('free|armor')).not.toThrow()
    expect(loadBoard('free|armor')).toBeNull()
    expect(loadBoard('free|weapon')?.revealed).toEqual(display(1))
    expectSilent()
  })

  it('keeps complete weapon and armor boards restored from storage (every kind, dir and null)', () => {
    const weapon = board({
      token: 'w',
      guesses: [
        { ...guess(1), feedback: { rarity: 'miss', season: { kind: 'miss', dir: -1 }, slot: 'near', type: 'miss', element: 'near', class: null, game: 'miss' } },
        { ...guess(2), feedback: { rarity: 'near', season: { kind: 'near', dir: 1 }, slot: 'miss', type: 'near', element: 'miss', class: null, game: 'near' } },
        { ...guess(3), feedback: { rarity: 'hit', season: { kind: 'near', dir: -1 }, slot: 'hit', type: 'hit', element: 'hit', class: null, game: 'hit' } },
        { ...guess(4, true), feedback: { rarity: 'hit', season: { kind: 'hit', dir: 0 }, slot: 'hit', type: 'hit', element: 'hit', class: null, game: 'hit' } },
      ],
      status: 'won',
    })
    const armor = board({
      token: 'a',
      date: '2026-07-16',
      number: 4,
      guesses: [
        { correct: false, guess: armorDisplay(5), feedback: armorFeedback('miss', 1) },
        { correct: false, guess: armorDisplay(6), feedback: armorFeedback('near', -1) },
        { correct: false, guess: armorDisplay(7), feedback: armorFeedback('hit', 0) },
      ],
      status: 'lost',
      revealed: armorDisplay(8),
    })
    const elements = board({
      token: 'n',
      guesses: [{ correct: false, guess: { ...display(9), element: 'Strand' }, feedback: okFeedback() }],
      revealed: { ...display(10), element: null },
    })
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: { 'free|weapon': weapon, 'daily|armor|2026-07-16': armor, 'free|armor': elements },
        streaks: {},
      }),
    )

    expect(loadBoard('free|weapon')).toEqual(weapon)
    expect(loadBoard('daily|armor|2026-07-16')).toEqual(armor)
    expect(loadBoard('free|armor')).toEqual(elements)
    expectSilent()
  })

  // SEC-F12 / R-03: every display text of `guess` and `revealed` is
  // interpolated (`{{ }}` stringifies an object or an array with
  // `JSON.stringify`, which overflows the stack on a deeply nested value), used
  // as a lookup key (`element`) or as a link (`lightGgUrl`): only a string,
  // `null` or nothing is kept. Listed here independently of the implementation.
  const DISPLAY_TEXT_KEYS: ReadonlyArray<Exclude<keyof ItemDisplay, 'id'>> = [
    'nameEn',
    'nameFr',
    'game',
    'rarityEn',
    'rarityFr',
    'seasonEn',
    'seasonFr',
    'slotEn',
    'slotFr',
    'typeEn',
    'typeFr',
    'element',
    'elementEn',
    'elementFr',
    'classEn',
    'classFr',
    'lightGgUrl',
  ]

  /** Item display whose every text field is `null` (only `id` is set). */
  const nullTexts = (id: number): Record<string, unknown> => {
    const d: Record<string, unknown> = { id }
    for (const k of DISPLAY_TEXT_KEYS) d[k] = null
    return d
  }

  /**
   * Raw JSON values that are neither a string nor `null`. The nested ones are
   * 10 000 levels deep (the reviewer's reproduction overflowed from ~3 000);
   * they are spliced in as raw text since `JSON.stringify` overflows on them.
   */
  const DEPTH = 10_000
  const DEEP_ARRAY = '['.repeat(DEPTH) + ']'.repeat(DEPTH)
  const NOT_TEXT: ReadonlyArray<[string, string]> = [
    ['an array', '["Solar"]'],
    ['an object', '{"en":"Solar"}'],
    ['a number', '7'],
    ['a boolean', 'false'],
    ['a deeply nested array', DEEP_ARRAY],
    ['a deeply nested object', '{"a":'.repeat(DEPTH) + '{}' + '}'.repeat(DEPTH)],
  ]

  /** Placeholder replaced by a raw JSON value in `rawStoreWith`. */
  const SLOT = '__not_text__'
  const rawStoreWith = (boards: Record<string, unknown>, rawValue: string): string =>
    JSON.stringify({ boards, streaks: {} }).replace(`"${SLOT}"`, () => rawValue)

  it('lists every text field of ItemDisplay', () => {
    const fixtureKeys = Object.keys(display(1)).filter((k) => k !== 'id')
    expect([...DISPLAY_TEXT_KEYS].sort()).toEqual(fixtureKeys.sort())
  })

  it.each(DISPLAY_TEXT_KEYS)('drops a board whose guess.%s is neither a string nor null', (key) => {
    const valid = board({ token: 'ok', guesses: [guess(1), guess(2, true)], status: 'won' })
    for (const [label, raw] of NOT_TEXT) {
      localStorage.setItem(
        STORAGE_KEY,
        rawStoreWith(
          {
            'free|weapon': valid,
            'free|armor': {
              token: 'bad',
              guesses: [guess(1), { ...guess(2), guess: { ...display(2), [key]: SLOT } }],
              status: 'playing',
            },
          },
          raw,
        ),
      )
      expect(() => loadBoard('free|armor'), label).not.toThrow()
      expect(loadBoard('free|armor'), label).toBeNull()
      expect(loadBoard('free|weapon'), label).toEqual(valid)
    }
    expectSilent()
  })

  it.each(DISPLAY_TEXT_KEYS)('drops a board whose revealed.%s is neither a string nor null', (key) => {
    const valid = board({ token: 'ok', guesses: [guess(1)], status: 'lost', revealed: display(9) })
    for (const [label, raw] of NOT_TEXT) {
      localStorage.setItem(
        STORAGE_KEY,
        rawStoreWith(
          {
            'free|weapon': valid,
            'free|armor': { token: 'bad', guesses: [guess(1)], status: 'lost', revealed: { ...display(8), [key]: SLOT } },
          },
          raw,
        ),
      )
      expect(() => loadBoard('free|armor'), label).not.toThrow()
      expect(loadBoard('free|armor'), label).toBeNull()
      expect(loadBoard('free|weapon'), label).toEqual(valid)
    }
    expectSilent()
  })

  it('keeps display texts that are null or absent, on guess and on revealed', () => {
    const boards: Record<string, unknown> = {
      'free|weapon': {
        token: 'w',
        guesses: [
          { correct: false, guess: nullTexts(1), feedback: okFeedback() },
          { correct: true, guess: { id: 2 }, feedback: okFeedback() },
        ],
        status: 'won',
      },
      'free|armor': {
        token: 'a',
        guesses: [{ correct: false, guess: { id: 3 }, feedback: armorFeedback('miss', 1) }],
        status: 'lost',
        revealed: nullTexts(4),
      },
      'daily|armor|2026-07-16': {
        token: 'd',
        date: '2026-07-16',
        number: 1,
        guesses: [{ correct: false, guess: nullTexts(5), feedback: armorFeedback('near', -1) }],
        status: 'lost',
        revealed: {},
      },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards, streaks: {} }))
    for (const [key, b] of Object.entries(boards)) expect(loadBoard(key), key).toEqual(b)
    expectSilent()
  })

  // R-03 reproduction, end to end: storage → `loadBoard` → what `App.vue`
  // renders for the restored board (grid, then the win panel on the last guess
  // or the lose panel on `revealed`), in a plain Vue app as in production.
  describe('rendering of a restored board (SEC-F12)', () => {
    /**
     * Mounts what `App.vue` shows for `loadBoard(key)` and collects the render
     * errors and Vue warnings instead of letting Vue log them.
     */
    async function renderRestored(key: string, category: Category, locale: 'fr' | 'en') {
      const restored = loadBoard(key)
      const errors: string[] = []
      const warnings: string[] = []
      const el = document.createElement('div')
      document.body.appendChild(el)
      const app = createApp({
        render: () => {
          if (!restored) return null
          const last = restored.guesses[restored.guesses.length - 1]
          return [
            restored.guesses.length > 0
              ? h(GuessBoard, { category, guesses: restored.guesses, done: restored.status !== 'playing' })
              : null,
            restored.status === 'won' && last
              ? h(WinPanel, { target: last.guess, guessCount: restored.guesses.length, mode: 'free', category })
              : null,
            restored.status === 'lost' && restored.revealed
              ? h(LosePanel, { target: restored.revealed, mode: 'free' })
              : null,
          ]
        },
      })
      app.use(createI18n({ legacy: false, locale, fallbackLocale: 'fr', messages: { fr, en } }))
      app.config.errorHandler = (e) => {
        errors.push(String(e))
      }
      app.config.warnHandler = (msg) => {
        warnings.push(msg)
      }
      app.mount(el)
      await nextTick()
      const rows = el.querySelectorAll('.guess-row:not(.header-row)').length
      const panels = el.querySelectorAll('.win-panel').length
      app.unmount()
      el.remove()
      return { restored, errors, warnings, rows, panels }
    }

    it.each([
      ['guess', 'nameEn', 'en'],
      ['guess', 'game', 'fr'],
      ['revealed', 'nameFr', 'fr'],
      ['revealed', 'game', 'en'],
    ] as const)('a deeply nested %s.%s never reaches the rendering (%s)', async (side, key, locale) => {
      const okWeapon = board({ token: 'ok', guesses: [guess(1), guess(2, true)], status: 'won' })
      const bad =
        side === 'guess'
          ? { token: 'bad', guesses: [guess(1), { ...guess(2, true), guess: { ...display(2), [key]: SLOT } }], status: 'won' }
          : {
              token: 'bad',
              guesses: [{ correct: false, guess: armorDisplay(5), feedback: armorFeedback('miss', 1) }],
              status: 'lost',
              revealed: { ...armorDisplay(8), [key]: SLOT },
            }
      const category: Category = side === 'guess' ? 'weapon' : 'armor'
      localStorage.setItem(
        STORAGE_KEY,
        rawStoreWith({ 'daily|weapon|2026-07-16': okWeapon, [`free|${category}`]: bad }, DEEP_ARRAY),
      )

      const dropped = await renderRestored(`free|${category}`, category, locale)
      expect(dropped.errors).toEqual([])
      expect(dropped.warnings).toEqual([])
      expect(dropped.restored).toBeNull()

      const kept = await renderRestored('daily|weapon|2026-07-16', 'weapon', locale)
      expect(kept.errors).toEqual([])
      expect(kept.warnings).toEqual([])
      expect(kept.rows).toBe(2)
      expect(kept.panels).toBe(1)
      expectSilent()
    })

    it.each(['fr', 'en'] as const)('renders every accepted restored board without error or warning (%s)', async (locale) => {
      const boards: Record<string, [Category, StoredBoard, number]> = {
        'free|weapon': [
          'weapon',
          board({ token: 'w', guesses: [guess(1), { ...guess(2, true), guess: { ...display(2), element: 'Strand' } }], status: 'won' }),
          2,
        ],
        'free|armor': [
          'armor',
          board({
            token: 'a',
            guesses: [{ correct: false, guess: armorDisplay(5), feedback: armorFeedback('near', -1) }],
            status: 'lost',
            revealed: armorDisplay(8),
          }),
          1,
        ],
        'daily|weapon|2026-07-16': [
          'weapon',
          {
            token: 'n',
            date: '2026-07-16',
            number: 1,
            guesses: [
              { correct: false, guess: nullTexts(1), feedback: okFeedback() },
              { correct: true, guess: { id: 2 }, feedback: okFeedback() },
            ],
            status: 'won',
          } as unknown as StoredBoard,
          2,
        ],
        'daily|armor|2026-07-16': [
          'armor',
          {
            token: 'm',
            date: '2026-07-16',
            number: 1,
            guesses: [
              { correct: false, guess: nullTexts(3), feedback: armorFeedback('miss', 1) },
              { correct: false, guess: { id: 4 }, feedback: armorFeedback('hit', 0) },
            ],
            status: 'lost',
            revealed: {},
          } as unknown as StoredBoard,
          2,
        ],
      }
      const stored: Record<string, StoredBoard> = {}
      for (const [key, [, b]] of Object.entries(boards)) stored[key] = b
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards: stored, streaks: {} }))

      for (const [key, [category, b, rows]] of Object.entries(boards)) {
        const r = await renderRestored(key, category, locale)
        expect(r.restored, key).toEqual(b)
        expect(r.errors, key).toEqual([])
        expect(r.warnings, key).toEqual([])
        expect(r.rows, key).toBe(rows)
        expect(r.panels, key).toBe(1)
      }
      expectSilent()
    })
  })

  it.each([
    ['16/07/2026', 'dd/MM/yyyy'],
    ['2026-7-16', 'unpadded month'],
    ['2026-07-16T00:00:00Z', 'ISO date-time'],
    ['20260716', 'no dashes'],
    ['', 'empty string'],
    ['bad-date', 'garbage'],
    [' 2026-07-16', 'leading space'],
  ])('drops a board whose date is %j (%s) and keeps the valid neighbour', (date) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'daily|weapon|2026-07-16': { token: 't', date, number: 1, guesses: [], status: 'playing' },
          'daily|armor|2026-07-16': { token: 'ok', date: '2026-07-16', number: 1, guesses: [], status: 'playing' },
        },
        streaks: {},
      }),
    )
    expect(() => loadBoard('daily|weapon|2026-07-16')).not.toThrow()
    expect(loadBoard('daily|weapon|2026-07-16')).toBeNull()
    expect(loadBoard('daily|armor|2026-07-16')?.date).toBe('2026-07-16')
    expectSilent()
  })

  it('drops the invalid boards from storage on the next save', () => {
    const valid = board({ token: 'ok' })
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: { 'free|weapon': valid, 'free|armor': { status: 'playing' } },
        streaks: {},
      }),
    )
    saveBoard('daily|weapon|2026-07-16', board({ token: 'new' }))
    const store = rawStore() as { boards: Record<string, unknown> }
    expect(Object.keys(store.boards).sort()).toEqual(['daily|weapon|2026-07-16', 'free|weapon'])
    expectSilent()
  })

  it('ignores invalid streaks and keeps the valid ones', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {},
        streaks: {
          weapon: { count: 'x', lastWinDate: '2026-07-16' },
          armor: { count: 3, lastWinDate: '2026-07-16' },
        },
      }),
    )
    expect(getStreak('weapon')).toBe(0)
    expect(getStreak('armor')).toBe(3)
    expectSilent()
  })

  const invalidStreaks: ReadonlyArray<[unknown, string]> = [
    [5, 'a number'],
    ['x', 'a string'],
    [null, 'null'],
    [[], 'an array'],
    [{ count: 2 }, 'lastWinDate missing'],
    [{ lastWinDate: '2026-07-16' }, 'count missing'],
    [{ count: 2, lastWinDate: 20260716 }, 'lastWinDate not a string'],
    [{ count: 2, lastWinDate: 'yesterday' }, 'lastWinDate not yyyy-MM-dd'],
    [{ count: 2, lastWinDate: '2026-7-16' }, 'lastWinDate unpadded'],
    [{ count: 2, lastWinDate: '2026-07-16T00:00:00Z' }, 'lastWinDate with a time part'],
    [{ count: 2, lastWinDate: '' }, 'lastWinDate empty'],
  ]

  it.each(invalidStreaks)('ignores a streak that is %j (%s)', (streak) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards: {}, streaks: { weapon: streak } }))
    expect(getStreak('weapon')).toBe(0)
    expect(getStreak('weapon', '2026-07-16')).toBe(0)
    // a new win starts a fresh streak
    expect(recordDailyWin('weapon', '2026-07-16')).toBe(1)
    expect(getStreak('weapon')).toBe(1)
    expectSilent()
  })

  it('ignores unknown streak categories without touching the known ones', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {},
        streaks: { ghost: { count: 9, lastWinDate: '2026-07-16' }, weapon: { count: 2, lastWinDate: '2026-07-16' } },
      }),
    )
    expect(getStreak('weapon')).toBe(2)
    saveBoard('free|weapon', board())
    const store = rawStore() as { streaks: Record<string, unknown> }
    expect(Object.keys(store.streaks)).toEqual(['weapon'])
    expectSilent()
  })

  it('never throws on a date that matches the format but is not a calendar day', () => {
    // `2026-99-99` passes the `yyyy-MM-dd` shape check (it can only come from a
    // tampered board date) but is an invalid Date: the streak arithmetic must
    // treat it as a broken streak, not raise a RangeError.
    recordDailyWin('weapon', '2026-07-16')
    expect(() => getStreak('weapon', '2026-99-99')).not.toThrow()
    expect(getStreak('weapon', '2026-99-99')).toBe(0)
    expect(() => recordDailyWin('weapon', '2026-99-99')).not.toThrow()
    expect(recordDailyWin('weapon', '2026-99-99')).toBe(1)
    expect(() => recordDailyWin('weapon', '2026-13-01')).not.toThrow()
    expect(getStreak('weapon')).toBe(1)
    expectSilent()
  })

  it('does not throw when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(() => loadBoard('free|weapon')).not.toThrow()
    expect(loadBoard('free|weapon')).toBeNull()
    expect(getStreak('weapon')).toBe(0)
    expectSilent()
  })

  it('does not propagate a localStorage.setItem failure (quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveBoard('free|weapon', board())).not.toThrow()
    expect(() => recordDailyWin('weapon', '2026-07-16')).not.toThrow()
    expect(recordDailyWin('weapon', '2026-07-16')).toBe(1)
    expect(() => clearDailyBoards('weapon', '2026-07-16')).not.toThrow()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expectSilent()
  })
})

describe('streak', () => {
  it('starts at 0', () => {
    expect(getStreak('weapon')).toBe(0)
    expect(getStreak('armor')).toBe(0)
    expect(getStreak('weapon', '2026-07-16')).toBe(0)
  })

  it('counts consecutive daily wins, is idempotent on the same day and restarts after a gap', () => {
    expect(recordDailyWin('weapon', '2026-07-16')).toBe(1)
    expect(getStreak('weapon')).toBe(1)

    expect(recordDailyWin('weapon', '2026-07-17')).toBe(2)
    expect(getStreak('weapon')).toBe(2)

    expect(recordDailyWin('weapon', '2026-07-17')).toBe(2)
    expect(getStreak('weapon')).toBe(2)

    expect(recordDailyWin('weapon', '2026-07-20')).toBe(1)
    expect(getStreak('weapon')).toBe(1)
  })

  it('keeps categories independent', () => {
    recordDailyWin('weapon', '2026-07-16')
    recordDailyWin('weapon', '2026-07-17')
    expect(getStreak('weapon')).toBe(2)
    expect(getStreak('armor')).toBe(0)

    expect(recordDailyWin('armor', '2026-07-17')).toBe(1)
    expect(getStreak('armor')).toBe(1)
    expect(getStreak('weapon')).toBe(2)

    // an armor gap does not reset the weapon streak
    recordDailyWin('armor', '2026-07-25')
    expect(getStreak('armor')).toBe(1)
    expect(getStreak('weapon')).toBe(2)
  })

  it('reports the count when the last win is today or yesterday, else 0', () => {
    recordDailyWin('weapon', '2026-07-16')
    recordDailyWin('weapon', '2026-07-17')
    expect(getStreak('weapon', '2026-07-17')).toBe(2)
    expect(getStreak('weapon', '2026-07-18')).toBe(2)
    expect(getStreak('weapon', '2026-07-19')).toBe(0)
    expect(getStreak('weapon', '2026-08-17')).toBe(0)
    // without `today` the raw count is returned
    expect(getStreak('weapon')).toBe(2)
  })

  it('a broken streak reported as 0 does not erase the stored count until a new win', () => {
    recordDailyWin('weapon', '2026-07-16')
    recordDailyWin('weapon', '2026-07-17')
    expect(getStreak('weapon', '2026-07-19')).toBe(0)
    expect(getStreak('weapon')).toBe(2)
    expect(recordDailyWin('weapon', '2026-07-19')).toBe(1)
    expect(getStreak('weapon', '2026-07-19')).toBe(1)
  })

  it('treats month and year boundaries as consecutive days', () => {
    expect(recordDailyWin('weapon', '2026-07-31')).toBe(1)
    expect(recordDailyWin('weapon', '2026-08-01')).toBe(2)
    expect(getStreak('weapon', '2026-08-01')).toBe(2)
    expect(getStreak('weapon', '2026-08-02')).toBe(2)

    expect(recordDailyWin('armor', '2026-12-31')).toBe(1)
    expect(recordDailyWin('armor', '2027-01-01')).toBe(2)
    expect(getStreak('armor', '2027-01-01')).toBe(2)
    expect(getStreak('armor', '2027-01-02')).toBe(2)
    expect(getStreak('armor', '2027-01-03')).toBe(0)
  })

  it('handles leap days as consecutive', () => {
    expect(recordDailyWin('weapon', '2028-02-28')).toBe(1)
    expect(recordDailyWin('weapon', '2028-02-29')).toBe(2)
    expect(recordDailyWin('weapon', '2028-03-01')).toBe(3)
    // 2026 is not a leap year: Feb 28 → Mar 1 is consecutive
    expect(recordDailyWin('armor', '2026-02-28')).toBe(1)
    expect(recordDailyWin('armor', '2026-03-01')).toBe(2)
  })

  it('persists the streak next to the boards without clobbering them', () => {
    saveBoard(boardKey('daily', 'weapon', '2026-07-16'), board({ token: 'dw' }))
    recordDailyWin('weapon', '2026-07-16')
    expect(loadBoard(boardKey('daily', 'weapon', '2026-07-16'))?.token).toBe('dw')
    expect(rawStore()).toEqual({
      boards: { 'daily|weapon|2026-07-16': board({ token: 'dw' }) },
      streaks: { weapon: { count: 1, lastWinDate: '2026-07-16' } },
    })
  })
})
