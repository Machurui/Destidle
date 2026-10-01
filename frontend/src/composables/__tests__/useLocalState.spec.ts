import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuessResult, ItemDisplay } from '@/lib/api'
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

  // SEC-F7 / reviewer C2: a corrupted element inside `guesses[]` used to be
  // accepted and made `usedIds` throw instead of the silent reset.
  const invalidGuesses: ReadonlyArray<[string, unknown]> = [
    ['null', null],
    ['a string', 'x'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
    ['correct not a boolean', { correct: 'yes', guess: display(1), feedback: {} }],
    ['guess missing', { correct: true, feedback: {} }],
    ['guess null', { correct: true, guess: null, feedback: {} }],
    ['guess an array', { correct: true, guess: [1], feedback: {} }],
    ['guess.id not a number', { correct: true, guess: { ...display(1), id: '1' }, feedback: {} }],
    ['guess.id missing', { correct: true, guess: { nameEn: 'x' }, feedback: {} }],
    ['feedback missing', { correct: true, guess: display(1) }],
    ['feedback not an object', { correct: true, guess: display(1), feedback: 'hit' }],
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

  it('only checks the shape of a guess shallowly (correct, guess.id, feedback object)', () => {
    const minimal = { correct: false, guess: { id: 3 }, feedback: {} }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ boards: { 'free|weapon': { token: 't', guesses: [minimal], status: 'playing' } }, streaks: {} }),
    )
    expect(loadBoard('free|weapon')?.guesses).toEqual([minimal])
    expectSilent()
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
