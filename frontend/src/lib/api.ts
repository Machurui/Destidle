/**
 * Typed client for the Destidle API (contract CT-01 / CT-04, camelCase JSON).
 * All URLs are relative (`/api/...`) so the Vite proxy (dev) or the API host
 * serving the SPA (prod) resolves them.
 *
 * Error model (DEC-006, REQ-015):
 * - network failure / invalid JSON  → `ApiError` with `status === 0`
 * - 400 = malformed request (do not refetch), 404 = unknown item,
 *   410 = puzzle token unusable (illegible, expired daily, target gone) → drop
 *   the token and refetch a fresh puzzle.
 */

export type Category = 'weapon' | 'armor'
export type Mode = 'daily' | 'free' | 'archive'
export type Game = 'D1' | 'D2'
export type MatchKind = 'hit' | 'near' | 'miss'

/** `GET /api/items` row — autocomplete only, no sensitive attribute. */
export interface ItemSummary {
  id: number
  nameEn: string
  nameFr: string
  game: Game
  typeEn: string
  typeFr: string
  iconUrl: string
}

export interface SeasonFeedback {
  kind: MatchKind
  /** 1 = target is more recent, -1 = older, 0 = same season. */
  dir: -1 | 0 | 1
}

/** CT-04: `type`/`element` are null for armor, `class` is null for weapons. */
export interface Feedback {
  rarity: MatchKind
  season: SeasonFeedback
  slot: MatchKind
  type: MatchKind | null
  element: MatchKind | null
  class: MatchKind | null
  game: MatchKind
}

/** Displayable values of a guessed / revealed item (both languages). */
export interface ItemDisplay {
  id: number
  nameEn: string
  nameFr: string
  game: Game
  rarityEn: string
  rarityFr: string
  seasonEn: string
  seasonFr: string
  slotEn: string | null
  slotFr: string | null
  typeEn: string
  typeFr: string
  element: string | null
  elementEn: string | null
  elementFr: string | null
  classEn: string | null
  classFr: string | null
  lightGgUrl: string | null
}

export interface GuessResult {
  correct: boolean
  guess: ItemDisplay
  feedback: Feedback
}

export interface DailyInfo {
  puzzleToken: string
  date: string
  number: number
}

export interface FreeInfo {
  puzzleToken: string
}

export interface RevealInfo {
  item: ItemDisplay
}

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a usable response. */
  readonly status: number
  /** `ProblemDetails.detail` (or `title`) when the API sent one. */
  readonly detail: string | undefined

  constructor(status: number, detail?: string) {
    super(detail ? `API ${status}: ${detail}` : `API ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** True when the API could not be reached (or answered garbage). */
  get isNetwork(): boolean {
    return this.status === 0
  }
}

async function problemDetail(r: Response): Promise<string | undefined> {
  try {
    const body: unknown = await r.json()
    if (body && typeof body === 'object') {
      const p = body as { detail?: unknown; title?: unknown }
      if (typeof p.detail === 'string') return p.detail
      if (typeof p.title === 'string') return p.title
    }
  } catch {
    /* body is not JSON: no detail available */
  }
  return undefined
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(input, { ...init, headers: { Accept: 'application/json', ...init?.headers } })
  } catch {
    throw new ApiError(0)
  }
  if (!r.ok) throw new ApiError(r.status, await problemDetail(r))
  try {
    return (await r.json()) as T
  } catch {
    throw new ApiError(0, 'invalid JSON response')
  }
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  items: (category: Category) =>
    request<ItemSummary[]>(`/api/items?category=${encodeURIComponent(category)}`),
  daily: (category: Category) =>
    request<DailyInfo>(`/api/game/daily?category=${encodeURIComponent(category)}`),
  /** Past daily puzzle: `date` from the launch day to yesterday (Europe/Paris), same target as that day. */
  archive: (category: Category, date: string) =>
    request<DailyInfo>(
      `/api/game/archive?category=${encodeURIComponent(category)}&date=${encodeURIComponent(date)}`,
    ),
  free: (category: Category) => request<FreeInfo>('/api/game/free', post({ category })),
  guess: (puzzleToken: string, itemId: number) =>
    request<GuessResult>('/api/game/guess', post({ puzzleToken, itemId })),
  reveal: (puzzleToken: string) => request<RevealInfo>('/api/game/reveal', post({ puzzleToken })),
  /** Splash image URL for a puzzle token and a pixelation level 0..9 (9 = sharp). */
  splashUrl: (puzzleToken: string, level: number) =>
    `/api/game/splash?token=${encodeURIComponent(puzzleToken)}&level=${level}`,
}

export type Api = typeof api
