/**
 * Local persistence of the game state (REQ-013, REQ-015).
 *
 * Everything lives in `localStorage` under a single JSON key (`destidle.v1`):
 * - one board per (mode, category[, date]) — the four mode × category
 *   combinations each have their own state, daily boards are keyed by date;
 * - one streak per category (consecutive daily wins).
 *
 * Any corrupted or unreadable content is silently replaced by an empty store,
 * and a storage failure (quota, disabled storage) never throws: the game keeps
 * working without persistence.
 */
import type { Category, GuessResult, ItemDisplay, Mode } from '@/lib/api'

export const STORAGE_KEY = 'destidle.v1'

export type BoardStatus = 'playing' | 'won' | 'lost'

export interface StoredBoard {
  /** Puzzle token of the target (opaque, issued by the API). */
  token: string
  /** Daily only: `yyyy-MM-dd` (Europe/Paris, from the API). */
  date?: string
  /** Daily only: puzzle number. */
  number?: number
  guesses: GuessResult[]
  status: BoardStatus
  /** Target item, filled after a loss (or a voluntary reveal). */
  revealed?: ItemDisplay
}

interface Streak {
  count: number
  /** `yyyy-MM-dd` of the last recorded daily win. */
  lastWinDate: string
}

interface Store {
  boards: Record<string, StoredBoard>
  streaks: Partial<Record<Category, Streak>>
}

const BOARD_STATUSES: readonly BoardStatus[] = ['playing', 'won', 'lost']
/** `yyyy-MM-dd` as issued by the API; anything else is treated as corrupted. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function emptyStore(): Store {
  return { boards: {}, streaks: {} }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isDate(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v)
}

/**
 * Shallow check of a stored guess: enough for the computed views (`usedIds`,
 * board rendering) to never throw on a partially corrupted store. Nested
 * fields of `guess` / `feedback` are not validated (SEC-F8 is handled at
 * render time).
 */
function isGuessResult(v: unknown): v is GuessResult {
  return (
    isRecord(v) &&
    typeof v.correct === 'boolean' &&
    isRecord(v.guess) &&
    typeof v.guess.id === 'number' &&
    isRecord(v.feedback)
  )
}

function isBoard(v: unknown): v is StoredBoard {
  return (
    isRecord(v) &&
    typeof v.token === 'string' &&
    Array.isArray(v.guesses) &&
    v.guesses.every(isGuessResult) &&
    BOARD_STATUSES.includes(v.status as BoardStatus) &&
    (v.date === undefined || isDate(v.date)) &&
    (v.number === undefined || typeof v.number === 'number') &&
    (v.revealed === undefined || isRecord(v.revealed))
  )
}

function isStreak(v: unknown): v is Streak {
  return isRecord(v) && typeof v.count === 'number' && isDate(v.lastWinDate)
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Parses the store, dropping any entry whose shape is invalid (silent reset). */
function load(): Store {
  const raw = readRaw()
  if (!raw) return emptyStore()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyStore()
  }
  if (!isRecord(parsed)) return emptyStore()
  const store = emptyStore()
  if (isRecord(parsed.boards)) {
    for (const [key, board] of Object.entries(parsed.boards)) {
      if (isBoard(board)) store.boards[key] = board
    }
  }
  if (isRecord(parsed.streaks)) {
    for (const category of ['weapon', 'armor'] as const) {
      const streak = parsed.streaks[category]
      if (isStreak(streak)) store.streaks[category] = streak
    }
  }
  return store
}

function save(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* storage unavailable or full: keep playing without persistence */
  }
}

/** `daily|weapon|2026-07-16` or `free|weapon`. */
export function boardKey(mode: Mode, category: Category, date?: string): string {
  return mode === 'daily' ? `daily|${category}|${date ?? ''}` : `free|${category}`
}

export function loadBoard(key: string): StoredBoard | null {
  return load().boards[key] ?? null
}

export function saveBoard(key: string, board: StoredBoard): void {
  const store = load()
  store.boards[key] = board
  save(store)
}

/** Removes every daily board of `category` except the one dated `keepDate`. */
export function clearDailyBoards(category: Category, keepDate: string): void {
  const store = load()
  const prefix = `daily|${category}|`
  const keep = boardKey('daily', category, keepDate)
  let changed = false
  for (const key of Object.keys(store.boards)) {
    if (key.startsWith(prefix) && key !== keep) {
      delete store.boards[key]
      changed = true
    }
  }
  if (changed) save(store)
}

/**
 * Previous calendar day of a `yyyy-MM-dd` string (pure date arithmetic, no
 * timezone). A string that matches the format but is not a calendar date
 * (`2026-99-99`) yields `''`, which never equals a stored date: the streak is
 * then simply considered broken instead of throwing a `RangeError`.
 */
function dayBefore(date: string): string {
  const t = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return ''
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

/**
 * Current streak of `category`. When `today` is given, a streak whose last win
 * is older than yesterday is considered broken and reported as 0.
 */
export function getStreak(category: Category, today?: string): number {
  const streak = load().streaks[category]
  if (!streak) return 0
  if (today !== undefined && streak.lastWinDate !== today && streak.lastWinDate !== dayBefore(today)) {
    return 0
  }
  return streak.count
}

/**
 * Records a daily win on `date`: +1 when the previous win was the day before,
 * unchanged when the same day is recorded twice, otherwise restarts at 1.
 * Returns the new streak count.
 */
export function recordDailyWin(category: Category, date: string): number {
  const store = load()
  const prev = store.streaks[category]
  let next: Streak
  if (prev && prev.lastWinDate === date) {
    next = prev
  } else if (prev && prev.lastWinDate === dayBefore(date)) {
    next = { count: prev.count + 1, lastWinDate: date }
  } else {
    next = { count: 1, lastWinDate: date }
  }
  store.streaks[category] = next
  save(store)
  return next.count
}
