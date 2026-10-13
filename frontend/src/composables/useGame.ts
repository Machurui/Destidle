/**
 * Game state machine (contract CT-05, REQ-008 / REQ-013 / REQ-015).
 *
 * One instance drives one screen: it owns the current category and mode,
 * the autocomplete pool, the board of the (mode, category[, date]) being
 * played and the daily streak. Every board mutation replaces the object
 * (never mutates it) and is persisted through `useLocalState`.
 *
 * Context switches: `init()` targets the `${mode}|${category}` context. When
 * it differs from the last successfully loaded one, the board, daily info,
 * pool and streak are cleared before any request so a failed switch never
 * shows the previous context's board under the new tab (the error banner and
 * `retry()` take over). A reload of the same context (`retry()`, 410 refetch)
 * keeps the current board displayed until it is replaced.
 *
 * Restored lost boards (REQ-008): a board saved `lost` without its target
 * (the reveal failed right after the last guess) is revealed again on load,
 * before being committed. Daily: a failing reveal commits the board as-is
 * and exposes the error. Free: a 410 means the stored token is dead, so a
 * new free game starts; any other failure commits the board and exposes it.
 *
 * Archive mode (spec archive §4): with `archiveDate === null` the screen is
 * the list of past days (`archiveDays`, built from today's daily info and the
 * stored boards, no board loaded); `openArchiveDay(date)` loads that day from
 * `/api/game/archive` under the daily key of its date, so a day played live
 * opens as it was left and a finished day stays frozen. Archive wins never
 * touch the streak; a 410 reloads the same day.
 *
 * Error model (DEC-006): any `ApiError` is exposed in `error` (status 0 =
 * unreachable API) and the caller decides how to display it; a 410 during
 * `submitGuess` (raised by the guess or by the reveal that follows the last
 * guess) means the puzzle token is unusable, so the token is dropped and a
 * fresh puzzle is fetched (daily → `init()`, archive → `init()` on the same day, free → `newFree()`). 400 / 404
 * / 5xx never refetch. Non-API exceptions are programming errors and are
 * rethrown untouched.
 */
import { computed, ref, shallowRef, toRaw } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { Category, DailyInfo, GuessResult, ItemSummary, Mode } from '@/lib/api'
import {
  boardKey,
  getStreak,
  loadBoard,
  loadDailyBoards,
  recordDailyWin,
  saveBoard,
} from './useLocalState'
import type { BoardStatus, StoredBoard } from './useLocalState'
import { buildArchiveDays } from './archiveDays'
import type { ArchiveDay } from './archiveDays'

export const MAX_GUESSES = 8
/** Sharpest splash level (only requested once the game is over). */
export const MAX_SPLASH_LEVEL = 9

export type GameStatus = BoardStatus

export interface UseGame {
  category: Ref<Category>
  mode: Ref<Mode>
  items: Ref<ItemSummary[]>
  board: Ref<StoredBoard | null>
  /** Daily or archive-day puzzle info; `null` in free mode and on the archive list. */
  daily: Ref<DailyInfo | null>
  /** Last unrecovered API error; `status === 0` means the API is unreachable. */
  error: Ref<ApiError | null>
  /** True while `init()` / `newFree()` is loading a puzzle. */
  loading: Ref<boolean>
  /** True while a guess is being submitted. */
  submitting: Ref<boolean>
  streak: Ref<number>
  /** Archive mode: date of the opened day; `null` while the list of days is shown. */
  archiveDate: Ref<string | null>
  /** Archive mode: past puzzles of the category, newest first; empty outside the list. */
  archiveDays: Ref<ArchiveDay[]>
  status: ComputedRef<GameStatus>
  guesses: ComputedRef<GuessResult[]>
  usedIds: ComputedRef<Set<number>>
  poolSize: ComputedRef<number>
  splashLevel: ComputedRef<number>
  splashSrc: ComputedRef<string | null>
  init(): Promise<void>
  /** Alias of `init()` for the error banner (REQ-015). */
  retry(): Promise<void>
  setCategory(c: Category): Promise<void>
  setMode(m: Mode): Promise<void>
  submitGuess(itemId: number): Promise<void>
  /** Free mode only: fetches a new random target and starts a blank board. */
  newFree(): Promise<void>
  /** Archive mode only: opens the board of a past day. */
  openArchiveDay(date: string): Promise<void>
  /** Archive mode only: back from a day to the list of days. */
  closeArchiveDay(): Promise<void>
  MAX_GUESSES: number
}

interface RevealedBoard {
  board: StoredBoard
  /** Set when the automatic reveal of a restored lost board failed. */
  error?: ApiError
}

interface LoadedPuzzle extends RevealedBoard {
  key: string
  daily: DailyInfo | null
  streak: number
}

export function useGame(): UseGame {
  const category = ref<Category>('weapon')
  const mode = ref<Mode>('daily')
  const items = shallowRef<ItemSummary[]>([])
  const board = ref<StoredBoard | null>(null)
  const daily = ref<DailyInfo | null>(null)
  const error = shallowRef<ApiError | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const streak = ref(0)
  const archiveDate = ref<string | null>(null)
  const archiveDays = shallowRef<ArchiveDay[]>([])

  const status = computed<GameStatus>(() => board.value?.status ?? 'playing')
  const guesses = computed<GuessResult[]>(() => board.value?.guesses ?? [])
  const usedIds = computed(() => new Set(guesses.value.map((g) => g.guess.id)))
  const poolSize = computed(() => items.value.length)
  const splashLevel = computed(() =>
    status.value !== 'playing'
      ? MAX_SPLASH_LEVEL
      : Math.min(MAX_SPLASH_LEVEL - 1, Math.floor((guesses.value.length / MAX_GUESSES) * MAX_SPLASH_LEVEL)),
  )
  const splashSrc = computed(() =>
    board.value ? api.splashUrl(board.value.token, splashLevel.value) : null,
  )

  /**
   * Sequence number of the latest `init()` / `newFree()`. A superseded load
   * (e.g. `setCategory` immediately followed by `setMode`) must not write
   * into the state after its awaits. `submitGuess` captures it too: a guess
   * resolving after a context switch must not touch the displayed state.
   */
  let sequence = 0
  /** `${mode}|${category}|${archive date}` of the last screen committed by `init()`; `null` before the first one. */
  let loadedContext: string | null = null

  function commit(key: string, next: StoredBoard): void {
    board.value = next
    saveBoard(key, next)
  }

  /**
   * Persists `next` under `key` (the server did evaluate the guess, it is
   * never lost) but shows it only when `seq` is still the current sequence:
   * a guess that resolves after `init()` / `newFree()` belongs to a superseded
   * context and must not replace the board displayed now.
   */
  function commitIfCurrent(seq: number, key: string, next: StoredBoard): void {
    saveBoard(key, next)
    if (seq === sequence) board.value = next
  }

  /**
   * Reveals the target of a board saved `lost` without one (its reveal failed
   * after the last guess). The `ApiError` of a failing reveal is returned
   * rather than thrown so the board can still be committed.
   */
  async function ensureRevealed(restored: StoredBoard): Promise<RevealedBoard> {
    if (restored.status !== 'lost' || restored.revealed !== undefined) return { board: restored }
    try {
      const { item } = await api.reveal(restored.token)
      return { board: { ...restored, revealed: item } }
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      return { board: restored, error: e }
    }
  }

  async function fetchFreeBoard(cat: Category): Promise<StoredBoard> {
    const info = await api.free(cat)
    return { token: info.puzzleToken, guesses: [], status: 'playing' }
  }

  /**
   * Board of a dated puzzle (daily or archive day). A stored board keeps its
   * guesses (the target of a date is deterministic) but takes the token and
   * number the server just issued: the stored token may have become
   * unreadable (RISK-005 / DEC-006) or be the dead daily token of a past day.
   */
  function restoreDated(key: string, info: DailyInfo): StoredBoard {
    const existing = loadBoard(key)
    return existing
      ? { ...existing, token: info.puzzleToken, number: info.number }
      : { token: info.puzzleToken, date: info.date, number: info.number, guesses: [], status: 'playing' }
  }

  async function loadDaily(cat: Category): Promise<LoadedPuzzle> {
    const info = await api.daily(cat)
    const key = boardKey('daily', cat, info.date)
    return { key, daily: info, streak: getStreak(cat, info.date), ...(await ensureRevealed(restoreDated(key, info))) }
  }

  async function loadArchive(cat: Category, date: string): Promise<LoadedPuzzle> {
    const info = await api.archive(cat, date)
    const key = boardKey('archive', cat, info.date)
    return { key, daily: info, streak: 0, ...(await ensureRevealed(restoreDated(key, info))) }
  }

  async function loadFree(cat: Category): Promise<LoadedPuzzle> {
    const key = boardKey('free', cat)
    const streak = getStreak(cat)
    // A finished free board stays displayed; `newFree()` starts over.
    const existing = loadBoard(key)
    if (!existing) return { key, board: await fetchFreeBoard(cat), daily: null, streak }
    const revealed = await ensureRevealed(existing)
    if (revealed.error?.status === 410) {
      // The stored token is dead: the target can never be revealed, start over.
      return { key, board: await fetchFreeBoard(cat), daily: null, streak }
    }
    return { key, daily: null, streak, ...revealed }
  }

  async function init(): Promise<void> {
    const seq = ++sequence
    const cat = category.value
    const currentMode = mode.value
    // Archive mode: `null` = the list of days, otherwise the opened day.
    const day = currentMode === 'archive' ? archiveDate.value : null
    const context = `${currentMode}|${cat}|${day ?? ''}`
    if (context !== loadedContext) {
      // Never show the previous context's state under the new tab, even if
      // the load below fails.
      board.value = null
      daily.value = null
      items.value = []
      streak.value = 0
      archiveDays.value = []
    }
    loading.value = true
    error.value = null
    try {
      if (currentMode === 'archive' && day === null) {
        // The list needs today's date and number only; no board, no pool.
        const today = await api.daily(cat)
        if (seq !== sequence) return
        archiveDays.value = buildArchiveDays(today.date, today.number, loadDailyBoards(cat))
        loadedContext = context
        return
      }
      const pool = await api.items(cat)
      const puzzle =
        day !== null
          ? await loadArchive(cat, day)
          : currentMode === 'daily'
            ? await loadDaily(cat)
            : await loadFree(cat)
      if (seq !== sequence) return
      items.value = pool
      daily.value = puzzle.daily
      streak.value = puzzle.streak
      commit(puzzle.key, puzzle.board)
      loadedContext = context
      // A failed automatic reveal does not prevent the commit: the board is
      // shown lost without its target and `retry()` reveals it again.
      if (puzzle.error) error.value = puzzle.error
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      if (seq === sequence) error.value = e
    } finally {
      if (seq === sequence) loading.value = false
    }
  }

  function retry(): Promise<void> {
    return init()
  }

  async function newFree(): Promise<void> {
    if (mode.value !== 'free') return
    const seq = ++sequence
    const cat = category.value
    loading.value = true
    error.value = null
    try {
      const fresh = await fetchFreeBoard(cat)
      if (seq !== sequence) return
      commit(boardKey('free', cat), fresh)
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      if (seq === sequence) error.value = e
    } finally {
      if (seq === sequence) loading.value = false
    }
  }

  async function submitGuess(itemId: number): Promise<void> {
    const current = board.value ? toRaw(board.value) : null
    if (!current || current.status !== 'playing' || usedIds.value.has(itemId) || submitting.value) {
      return
    }
    // Context of the guess, captured before the first await: `init()` /
    // `newFree()` may replace the displayed board while the request is in
    // flight (tab switch during the latency).
    const seq = sequence
    const cat = category.value
    const currentMode = mode.value
    const key = boardKey(currentMode, cat, current.date)
    submitting.value = true
    error.value = null
    try {
      const result = await api.guess(current.token, itemId)
      let next: StoredBoard = { ...current, guesses: [...current.guesses, result] }
      if (result.correct) {
        next = { ...next, status: 'won' }
        commitIfCurrent(seq, key, next)
        if (currentMode === 'daily' && next.date !== undefined) {
          // The win is real for its own category/date: always record it, but
          // only show the count if that daily context is still displayed.
          const count = recordDailyWin(cat, next.date)
          if (seq === sequence) streak.value = count
        }
      } else if (next.guesses.length >= MAX_GUESSES) {
        next = { ...next, status: 'lost' }
        commitIfCurrent(seq, key, next)
        // If the reveal fails the board stays lost without a target, the
        // error is exposed below and the next `init()` reveals it again.
        const { item } = await api.reveal(next.token)
        commitIfCurrent(seq, key, { ...next, revealed: item })
      } else {
        commitIfCurrent(seq, key, next)
      }
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      // The error belongs to a superseded context: the current one already
      // has its own board (and error state) from `init()` / `newFree()`.
      if (seq !== sequence) return
      if (e.status === 410) {
        // Unusable token (DEC-006): drop it and fetch the puzzle again. Daily:
        // the server returns today's token (a blank board when the date
        // changed); archive: the same day again; free: a new game.
        if (currentMode === 'free') await newFree()
        else await init()
      } else {
        error.value = e
      }
    } finally {
      submitting.value = false
    }
  }

  async function setCategory(c: Category): Promise<void> {
    if (c === category.value) return
    category.value = c
    // Archive: the other category's list, never the same date over there.
    archiveDate.value = null
    await init()
  }

  async function setMode(m: Mode): Promise<void> {
    if (m === mode.value) {
      // Clicking the active archive tab on an open day goes back to the list.
      if (m === 'archive') await closeArchiveDay()
      return
    }
    mode.value = m
    archiveDate.value = null
    await init()
  }

  async function openArchiveDay(date: string): Promise<void> {
    if (mode.value !== 'archive') return
    archiveDate.value = date
    await init()
  }

  async function closeArchiveDay(): Promise<void> {
    if (mode.value !== 'archive' || archiveDate.value === null) return
    archiveDate.value = null
    await init()
  }

  return {
    category,
    mode,
    items,
    board,
    daily,
    error,
    loading,
    submitting,
    streak,
    archiveDate,
    archiveDays,
    status,
    guesses,
    usedIds,
    poolSize,
    splashLevel,
    splashSrc,
    init,
    retry,
    setCategory,
    setMode,
    submitGuess,
    newFree,
    openArchiveDay,
    closeArchiveDay,
    MAX_GUESSES,
  }
}
