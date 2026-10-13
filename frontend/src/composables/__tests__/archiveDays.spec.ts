import { describe, expect, it } from 'vitest'
import { addDays, buildArchiveDays, pastPuzzles } from '../archiveDays'
import type { StoredBoard } from '../useLocalState'
import type { GuessResult } from '@/lib/api'

const guess = (id: number, correct: boolean) => ({ correct, guess: { id }, feedback: {} }) as unknown as GuessResult

const board = (status: StoredBoard['status'], count: number): StoredBoard => ({
  token: 't',
  guesses: Array.from({ length: count }, (_, i) => guess(i + 1, status === 'won' && i === count - 1)),
  status,
})

describe('addDays', () => {
  it.each([
    ['2026-07-16', 1, '2026-07-17'],
    ['2026-07-16', -1, '2026-07-15'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-10-25', 1, '2026-10-26'], // DST change in Europe: calendar arithmetic is unaffected
    ['2026-07-20', 0, '2026-07-20'],
  ])('addDays(%s, %d) = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })
})

describe('pastPuzzles', () => {
  it('lists the puzzles before today, newest first, down to number 1', () => {
    expect(pastPuzzles('2026-07-20', 5)).toEqual([
      { date: '2026-07-19', number: 4 },
      { date: '2026-07-18', number: 3 },
      { date: '2026-07-17', number: 2 },
      { date: '2026-07-16', number: 1 },
    ])
  })

  it('is empty on the launch day (puzzle number 1)', () => {
    expect(pastPuzzles('2026-07-16', 1)).toEqual([])
  })
})

describe('buildArchiveDays', () => {
  it('reads each day result from the boards keyed by date', () => {
    const days = buildArchiveDays('2026-07-20', 5, {
      '2026-07-19': board('won', 3),
      '2026-07-18': board('lost', 8),
      '2026-07-17': board('playing', 2),
      '2026-07-12': board('won', 1), // before launch: never listed
    })
    expect(days).toEqual([
      { date: '2026-07-19', number: 4, status: 'won', guessCount: 3 },
      { date: '2026-07-18', number: 3, status: 'lost', guessCount: 8 },
      { date: '2026-07-17', number: 2, status: 'playing', guessCount: 2 },
      { date: '2026-07-16', number: 1, status: 'new', guessCount: 0 },
    ])
  })

  it('counts a board opened but never guessed as not played', () => {
    expect(buildArchiveDays('2026-07-17', 2, { '2026-07-16': board('playing', 0) })).toEqual([
      { date: '2026-07-16', number: 1, status: 'new', guessCount: 0 },
    ])
  })
})
