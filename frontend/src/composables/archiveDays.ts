/**
 * Archive list (spec archive §4): the past daily puzzles, derived from today's
 * date and number (the API numbers a day `d` as `d − launch + 1`), each with
 * the player's result read from the stored daily boards. Pure functions.
 */
import type { StoredBoard } from './useLocalState'

export type ArchiveStatus = 'won' | 'lost' | 'playing' | 'new'

export interface ArchiveDay {
  /** `yyyy-MM-dd` (Europe/Paris calendar day, as issued by the API). */
  date: string
  number: number
  status: ArchiveStatus
  guessCount: number
}

/** `date` shifted by `days` calendar days (UTC arithmetic: no timezone, no DST). */
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

/** Puzzles before today's (number `todayNumber`), newest first: numbers `todayNumber − 1` down to 1. */
export function pastPuzzles(today: string, todayNumber: number): { date: string; number: number }[] {
  const out: { date: string; number: number }[] = []
  for (let n = todayNumber - 1; n >= 1; n--) out.push({ date: addDays(today, n - todayNumber), number: n })
  return out
}

/**
 * One entry per past puzzle with the result of its stored board (`boards` is
 * keyed by date). A board opened but never guessed counts as not played.
 */
export function buildArchiveDays(
  today: string,
  todayNumber: number,
  boards: Record<string, StoredBoard>,
): ArchiveDay[] {
  return pastPuzzles(today, todayNumber).map(({ date, number }) => {
    const board = boards[date]
    if (!board || board.guesses.length === 0) return { date, number, status: 'new', guessCount: 0 }
    return { date, number, status: board.status, guessCount: board.guesses.length }
  })
}
