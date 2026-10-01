import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_GUESSES, MAX_SPLASH_LEVEL, useGame } from '../useGame'
import { STORAGE_KEY } from '../useLocalState'
import type { StoredBoard } from '../useLocalState'
import type { GuessResult, ItemSummary } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const item = (id: number, name: string): ItemSummary => ({
  id,
  nameEn: name,
  nameFr: `${name} FR`,
  game: 'D2',
  typeEn: 'Hand Cannon',
  typeFr: 'Revolver',
  iconUrl: '/api/icons/x.jpg',
})

const guessResult = (id: number, correct: boolean): GuessResult => ({
  correct,
  guess: {
    id,
    nameEn: `G${id}`,
    nameFr: `G${id}`,
    game: 'D2',
    rarityEn: 'Exotic',
    rarityFr: 'Exotique',
    seasonEn: 'S1',
    seasonFr: 'S1',
    slotEn: 'Kinetic',
    slotFr: 'Cinétique',
    typeEn: 'HC',
    typeFr: 'HC',
    element: 'Solar',
    elementEn: 'Solar',
    elementFr: 'Solaire',
    classEn: null,
    classFr: null,
    lightGgUrl: null,
  },
  feedback: {
    rarity: 'hit',
    season: { kind: 'miss', dir: 1 },
    slot: 'miss',
    type: 'miss',
    element: 'hit',
    class: null,
    game: 'hit',
  },
})

const DAILY_1 = { puzzleToken: 'tok1', date: '2026-07-16', number: 1 }
const DAILY_2 = { puzzleToken: 'tok2', date: '2026-07-17', number: 2 }
const DAILY_ARMOR = { puzzleToken: 'tokA', date: '2026-07-16', number: 1 }
const TEN_ITEMS = Array.from({ length: 10 }, (_, i) => item(i + 1, `W${i + 1}`))

// ---------------------------------------------------------------------------
// fetch mock: a router keyed by URL prefix. A route value is either the JSON
// payload to return, or a handler `(body, url) => payload | Response | Promise`
// that may also throw to simulate a network failure.
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown> | undefined
type RouteHandler = (body: JsonBody, url: string) => unknown
type Routes = Record<string, unknown>

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

/** ProblemDetails-like error response. */
const problem = (status: number): Response =>
  new Response(JSON.stringify({ status, title: `HTTP ${status}` }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })

const networkFailure = (): never => {
  throw new TypeError('Failed to fetch')
}

function mockFetch(routes: Routes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      const key = Object.keys(routes).find((k) => url.startsWith(k))
      if (key === undefined) return new Response('not found', { status: 404 })
      const route = routes[key]
      const body: JsonBody =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
      const data: unknown = typeof route === 'function' ? await (route as RouteHandler)(body, url) : route
      return data instanceof Response ? data : json(data)
    }),
  )
}

function fetchCalls(prefix: string) {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith(prefix))
}

/** Parses the JSON body of the n-th POST to `prefix`, asserting method and content type. */
function postedBody(prefix: string, index = 0): Record<string, unknown> {
  const call = fetchCalls(prefix)[index]
  if (!call) throw new Error(`no call #${index} to ${prefix}`)
  const [, init] = call
  expect(init?.method).toBe('POST')
  expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function storedBoards(): Record<string, StoredBoard> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return {}
  return (JSON.parse(raw) as { boards: Record<string, StoredBoard> }).boards
}

/** Writes the given boards into an otherwise empty store (simulates a previous session). */
function seedBoards(boards: Record<string, StoredBoard>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards, streaks: {} }))
}

function seedBoard(key: string, board: StoredBoard): void {
  seedBoards({ [key]: board })
}

/** A board lost after `MAX_GUESSES` wrong guesses, without its target (the reveal failed). */
const lostBoard = (token: string, extra: Partial<StoredBoard> = {}): StoredBoard => ({
  token,
  guesses: Array.from({ length: MAX_GUESSES }, (_, i) => guessResult(i + 1, false)),
  status: 'lost',
  ...extra,
})

const REVEALED = guessResult(99, true).guess

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const weaponDaily = (extra: Routes = {}): Routes => ({
  '/api/items': [item(1, 'Sunshot'), item(2, 'Gjallarhorn')],
  '/api/game/daily': DAILY_1,
  ...extra,
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('useGame constants', () => {
  it('exposes the game limits', () => {
    expect(MAX_GUESSES).toBe(8)
    expect(MAX_SPLASH_LEVEL).toBe(9)
    expect(useGame().MAX_GUESSES).toBe(8)
  })
})

describe('useGame — daily mode', () => {
  it('init loads items and the daily puzzle and starts a blank board', async () => {
    mockFetch(weaponDaily())
    const g = useGame()
    expect(g.category.value).toBe('weapon')
    expect(g.mode.value).toBe('daily')
    expect(g.board.value).toBeNull()
    expect(g.splashSrc.value).toBeNull()

    const pending = g.init()
    expect(g.loading.value).toBe(true)
    await pending

    expect(g.loading.value).toBe(false)
    expect(g.error.value).toBeNull()
    expect(g.items.value).toHaveLength(2)
    expect(g.poolSize.value).toBe(2)
    expect(g.daily.value).toEqual(DAILY_1)
    expect(g.board.value).toEqual({
      token: 'tok1',
      date: '2026-07-16',
      number: 1,
      guesses: [],
      status: 'playing',
    })
    expect(g.status.value).toBe('playing')
    expect(g.guesses.value).toEqual([])
    expect(g.usedIds.value.size).toBe(0)
    expect(g.splashLevel.value).toBe(0)
    expect(g.splashSrc.value).toBe('/api/game/splash?token=tok1&level=0')
    expect(g.streak.value).toBe(0)

    expect(fetchCalls('/api/items?category=weapon')).toHaveLength(1)
    expect(fetchCalls('/api/game/daily?category=weapon')).toHaveLength(1)
    expect(storedBoards()['daily|weapon|2026-07-16']).toMatchObject({ token: 'tok1', guesses: [] })
  })

  it('a correct guess marks the board won and records the streak of the day', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, true) }))
    const g = useGame()
    await g.init()

    await g.submitGuess(1)

    expect(postedBody('/api/game/guess')).toEqual({ puzzleToken: 'tok1', itemId: 1 })
    expect(g.status.value).toBe('won')
    expect(g.guesses.value).toHaveLength(1)
    expect(g.guesses.value[0]?.correct).toBe(true)
    expect(g.streak.value).toBe(1)
    expect(g.splashLevel.value).toBe(9)
    expect(g.submitting.value).toBe(false)
    expect(g.error.value).toBeNull()
    expect(storedBoards()['daily|weapon|2026-07-16']?.status).toBe('won')
  })

  it('eight wrong guesses mark the board lost and reveal the target', async () => {
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1,
      '/api/game/guess': (b: JsonBody) => guessResult(Number(b?.itemId), false),
      '/api/game/reveal': { item: guessResult(99, true).guess },
    })
    const g = useGame()
    await g.init()

    for (let i = 1; i <= 8; i++) await g.submitGuess(i)

    expect(fetchCalls('/api/game/guess')).toHaveLength(8)
    expect(g.guesses.value).toHaveLength(8)
    expect(g.status.value).toBe('lost')
    expect(postedBody('/api/game/reveal')).toEqual({ puzzleToken: 'tok1' })
    expect(g.board.value?.revealed?.id).toBe(99)
    expect(g.splashLevel.value).toBe(9)
    expect(g.error.value).toBeNull()
    expect(storedBoards()['daily|weapon|2026-07-16']).toMatchObject({ status: 'lost', revealed: { id: 99 } })

    // The game is over: further guesses never reach the API.
    await g.submitGuess(9)
    expect(fetchCalls('/api/game/guess')).toHaveLength(8)
    expect(g.guesses.value).toHaveLength(8)
  })

  it('a failing reveal keeps the board lost without a target and exposes the error', async () => {
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1,
      '/api/game/guess': (b: JsonBody) => guessResult(Number(b?.itemId), false),
      '/api/game/reveal': () => problem(500),
    })
    const g = useGame()
    await g.init()

    for (let i = 1; i <= 8; i++) await g.submitGuess(i)

    expect(g.status.value).toBe('lost')
    expect(g.board.value?.revealed).toBeUndefined()
    expect(g.error.value?.status).toBe(500)
    expect(g.submitting.value).toBe(false)
    expect(storedBoards()['daily|weapon|2026-07-16']?.status).toBe('lost')
  })

  it('restores the board of the day from localStorage without re-guessing', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, false) }))
    const g1 = useGame()
    await g1.init()
    await g1.submitGuess(1)

    const g2 = useGame()
    await g2.init()

    expect(g2.guesses.value).toHaveLength(1)
    expect(g2.guesses.value[0]?.guess.id).toBe(1)
    expect(g2.usedIds.value.has(1)).toBe(true)
    expect(g2.status.value).toBe('playing')
    expect(g2.splashLevel.value).toBe(1)
    expect(fetchCalls('/api/game/guess')).toHaveLength(1)
  })

  it('a restored board takes the fresh token and number sent by the server', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, false) }))
    const g1 = useGame()
    await g1.init()
    await g1.submitGuess(1)

    mockFetch(weaponDaily({ '/api/game/daily': { puzzleToken: 'tok1b', date: '2026-07-16', number: 1 } }))
    const g2 = useGame()
    await g2.init()

    expect(g2.board.value?.token).toBe('tok1b')
    expect(g2.board.value?.date).toBe('2026-07-16')
    expect(g2.guesses.value).toHaveLength(1)
    expect(g2.splashSrc.value).toContain('token=tok1b')
    expect(storedBoards()['daily|weapon|2026-07-16']?.token).toBe('tok1b')
  })

  it('a date change starts a blank board and drops the previous day', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, false) }))
    const g1 = useGame()
    await g1.init()
    await g1.submitGuess(1)

    mockFetch(weaponDaily({ '/api/game/daily': DAILY_2 }))
    const g2 = useGame()
    await g2.init()

    expect(g2.daily.value).toEqual(DAILY_2)
    expect(g2.board.value).toEqual({
      token: 'tok2',
      date: '2026-07-17',
      number: 2,
      guesses: [],
      status: 'playing',
    })
    expect(g2.guesses.value).toHaveLength(0)
    const boards = storedBoards()
    expect(boards['daily|weapon|2026-07-16']).toBeUndefined()
    expect(boards['daily|weapon|2026-07-17']).toBeDefined()
  })

  it('counts consecutive daily wins across two days', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, true) }))
    const g1 = useGame()
    await g1.init()
    await g1.submitGuess(1)
    expect(g1.streak.value).toBe(1)

    mockFetch(weaponDaily({ '/api/game/daily': DAILY_2, '/api/game/guess': guessResult(1, true) }))
    const g2 = useGame()
    await g2.init()
    expect(g2.streak.value).toBe(1) // yesterday's win still counts
    expect(g2.status.value).toBe('playing')

    await g2.submitGuess(1)
    expect(g2.streak.value).toBe(2)
  })

  it('reports a streak of 0 when the last win is older than yesterday', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, true) }))
    const g1 = useGame()
    await g1.init()
    await g1.submitGuess(1)

    mockFetch(weaponDaily({ '/api/game/daily': { puzzleToken: 'tok5', date: '2026-07-20', number: 5 } }))
    const g2 = useGame()
    await g2.init()

    expect(g2.streak.value).toBe(0)
  })

  it('ignores guesses without a board, for an already played item and after a win', async () => {
    let n = 0
    mockFetch(weaponDaily({ '/api/game/guess': () => guessResult(++n, n === 2) }))
    const g = useGame()

    await g.submitGuess(1) // no board yet
    expect(fetchCalls('/api/game/guess')).toHaveLength(0)

    await g.init()
    await g.submitGuess(1)
    await g.submitGuess(1) // already played
    expect(fetchCalls('/api/game/guess')).toHaveLength(1)
    expect(g.guesses.value).toHaveLength(1)

    await g.submitGuess(2) // correct → won
    expect(g.status.value).toBe('won')
    await g.submitGuess(3)
    expect(fetchCalls('/api/game/guess')).toHaveLength(2)
    expect(g.guesses.value).toHaveLength(2)
  })

  it('ignores a guess while another one is in flight', async () => {
    const first = deferred<GuessResult>()
    mockFetch(
      weaponDaily({
        '/api/game/guess': (b: JsonBody) => (b?.itemId === 1 ? first.promise : guessResult(2, false)),
      }),
    )
    const g = useGame()
    await g.init()

    const pending = g.submitGuess(1)
    expect(g.submitting.value).toBe(true)
    await g.submitGuess(2) // ignored: a guess is already in flight
    expect(fetchCalls('/api/game/guess')).toHaveLength(1)

    first.resolve(guessResult(1, false))
    await pending
    expect(g.submitting.value).toBe(false)
    expect(g.guesses.value.map((r) => r.guess.id)).toEqual([1])

    await g.submitGuess(2) // accepted once the previous one is done
    expect(g.guesses.value.map((r) => r.guess.id)).toEqual([1, 2])
  })

  it('splashLevel follows the guess count and jumps to 9 when the game ends', async () => {
    const token = 'tok 1/x+y'
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': { puzzleToken: token, date: '2026-07-16', number: 1 },
      '/api/game/guess': (b: JsonBody) => guessResult(Number(b?.itemId), b?.itemId === 8),
    })
    const g = useGame()
    await g.init()
    const expectedLevels: Record<number, number> = { 0: 0, 1: 1, 4: 4, 7: 7 }

    expect(g.splashLevel.value).toBe(0)
    for (let i = 1; i <= 7; i++) {
      await g.submitGuess(i)
      const expected = expectedLevels[i]
      if (expected !== undefined) {
        expect(g.splashLevel.value).toBe(expected)
        expect(g.splashSrc.value).toBe(`/api/game/splash?token=${encodeURIComponent(token)}&level=${expected}`)
      }
    }
    expect(g.splashLevel.value).toBe(7)

    await g.submitGuess(8)
    expect(g.status.value).toBe('won')
    expect(g.splashLevel.value).toBe(9)
    expect(g.splashSrc.value).toContain('level=9')
    expect(g.splashSrc.value).toContain(`token=${encodeURIComponent(token)}`)
  })

  it('setCategory loads a distinct board that coexists with the weapon one', async () => {
    mockFetch({
      '/api/items': (_b: JsonBody, url: string) =>
        url.includes('category=armor') ? [item(10, 'Helm of Saint-14')] : [item(1, 'Sunshot')],
      '/api/game/daily': (_b: JsonBody, url: string) => (url.includes('category=armor') ? DAILY_ARMOR : DAILY_1),
      '/api/game/guess': (b: JsonBody) => guessResult(Number(b?.itemId), false),
    })
    const g = useGame()
    await g.init()
    await g.submitGuess(1)

    await g.setCategory('armor')

    expect(g.category.value).toBe('armor')
    expect(fetchCalls('/api/items?category=armor')).toHaveLength(1)
    expect(fetchCalls('/api/game/daily?category=armor')).toHaveLength(1)
    expect(g.items.value.map((i) => i.id)).toEqual([10])
    expect(g.board.value).toEqual({
      token: 'tokA',
      date: '2026-07-16',
      number: 1,
      guesses: [],
      status: 'playing',
    })
    const boards = storedBoards()
    expect(boards['daily|weapon|2026-07-16']?.guesses).toHaveLength(1)
    expect(boards['daily|armor|2026-07-16']?.guesses).toHaveLength(0)

    await g.setCategory('weapon')
    expect(g.board.value?.token).toBe('tok1')
    expect(g.guesses.value).toHaveLength(1)
  })

  it('setCategory and setMode with the current value do nothing', async () => {
    mockFetch(weaponDaily())
    const g = useGame()
    await g.init()
    const before = vi.mocked(fetch).mock.calls.length

    await g.setCategory('weapon')
    await g.setMode('daily')

    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
  })

  it('a stale init does not overwrite the state of a newer one', async () => {
    const armorDaily = deferred<typeof DAILY_ARMOR>()
    mockFetch({
      '/api/items': [item(1, 'Sunshot')],
      '/api/game/daily': (_b: JsonBody, url: string) =>
        url.includes('category=armor') ? armorDaily.promise : DAILY_1,
      '/api/game/free': { puzzleToken: 'free1' },
    })
    const g = useGame()
    await g.init()

    const switchCategory = g.setCategory('armor') // daily(armor) stays pending
    const switchMode = g.setMode('free') // free(armor) resolves first
    await switchMode
    expect(g.board.value?.token).toBe('free1')
    expect(g.daily.value).toBeNull()
    expect(g.loading.value).toBe(false)

    armorDaily.resolve(DAILY_ARMOR)
    await switchCategory

    expect(g.mode.value).toBe('free')
    expect(g.category.value).toBe('armor')
    expect(g.board.value?.token).toBe('free1')
    expect(g.daily.value).toBeNull()
    expect(g.loading.value).toBe(false)
    expect(g.error.value).toBeNull()
    expect(storedBoards()['daily|armor|2026-07-16']).toBeUndefined()
  })
})

describe('useGame — free mode', () => {
  it('setMode(free) posts the category and starts a blank board', async () => {
    mockFetch(weaponDaily({ '/api/game/free': { puzzleToken: 'free1' } }))
    const g = useGame()
    await g.init()

    await g.setMode('free')

    expect(g.mode.value).toBe('free')
    expect(postedBody('/api/game/free')).toEqual({ category: 'weapon' })
    expect(g.daily.value).toBeNull()
    expect(g.board.value).toEqual({ token: 'free1', guesses: [], status: 'playing' })
    expect(g.status.value).toBe('playing')
    expect(g.splashSrc.value).toBe('/api/game/splash?token=free1&level=0')
    expect(g.error.value).toBeNull()
    expect(g.loading.value).toBe(false)
    expect(fetchCalls('/api/items')).toHaveLength(2)
    expect(storedBoards()['free|weapon']).toMatchObject({ token: 'free1' })
  })

  it('newFree fetches a new token and resets the board', async () => {
    let n = 0
    mockFetch(
      weaponDaily({
        '/api/game/free': () => ({ puzzleToken: `free${++n}` }),
        '/api/game/guess': (b: JsonBody) => guessResult(Number(b?.itemId), false),
      }),
    )
    const g = useGame()
    await g.init()
    await g.setMode('free')
    await g.submitGuess(1)
    expect(g.guesses.value).toHaveLength(1)
    expect(postedBody('/api/game/guess')).toEqual({ puzzleToken: 'free1', itemId: 1 })

    await g.newFree()

    expect(fetchCalls('/api/game/free')).toHaveLength(2)
    expect(g.board.value).toEqual({ token: 'free2', guesses: [], status: 'playing' })
    expect(g.daily.value).toBeNull()
    expect(g.error.value).toBeNull()
    expect(g.loading.value).toBe(false)
    expect(storedBoards()['free|weapon']?.token).toBe('free2')
  })

  it('newFree is a no-op in daily mode', async () => {
    mockFetch(weaponDaily({ '/api/game/free': { puzzleToken: 'free1' } }))
    const g = useGame()
    await g.init()

    await g.newFree()

    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(g.board.value?.token).toBe('tok1')
  })

  it('a finished free board is restored as-is on the next init', async () => {
    mockFetch(
      weaponDaily({
        '/api/game/free': { puzzleToken: 'free1' },
        '/api/game/guess': guessResult(1, true),
      }),
    )
    const g1 = useGame()
    await g1.init()
    await g1.setMode('free')
    await g1.submitGuess(1)
    expect(g1.status.value).toBe('won')
    expect(g1.streak.value).toBe(0) // free wins do not count towards the daily streak

    const g2 = useGame()
    await g2.setMode('free')

    expect(g2.status.value).toBe('won')
    expect(g2.board.value?.token).toBe('free1')
    expect(g2.guesses.value).toHaveLength(1)
    expect(fetchCalls('/api/game/free')).toHaveLength(1)
    expect(fetchCalls('/api/game/guess')).toHaveLength(1)
  })

  it('free and daily boards of the same category are independent', async () => {
    mockFetch(
      weaponDaily({
        '/api/game/free': { puzzleToken: 'free1' },
        '/api/game/guess': (b: JsonBody) => guessResult(Number(b?.itemId), false),
      }),
    )
    const g = useGame()
    await g.init()
    await g.submitGuess(1)
    await g.submitGuess(2)

    await g.setMode('free')
    expect(g.guesses.value).toHaveLength(0)
    await g.submitGuess(1)
    expect(g.guesses.value).toHaveLength(1)

    await g.setMode('daily')
    expect(g.guesses.value).toHaveLength(2)
    expect(g.board.value?.token).toBe('tok1')
    const boards = storedBoards()
    expect(boards['daily|weapon|2026-07-16']?.guesses).toHaveLength(2)
    expect(boards['free|weapon']?.guesses).toHaveLength(1)
  })
})

describe('useGame — errors (REQ-015)', () => {
  it('410 on a daily guess drops the token and refetches the current puzzle', async () => {
    let dailyCalls = 0
    mockFetch({
      '/api/items': [item(1, 'Sunshot'), item(2, 'Gjallarhorn')],
      '/api/game/daily': () => (dailyCalls++ === 0 ? DAILY_1 : DAILY_2),
      '/api/game/guess': (b: JsonBody) =>
        b?.puzzleToken === 'tok1' && b?.itemId === 2 ? problem(410) : guessResult(Number(b?.itemId), false),
    })
    const g = useGame()
    await g.init()
    await g.submitGuess(1)
    expect(g.guesses.value).toHaveLength(1)

    await g.submitGuess(2) // the day changed server-side → 410

    expect(fetchCalls('/api/game/daily')).toHaveLength(2)
    expect(g.daily.value?.date).toBe('2026-07-17')
    expect(g.board.value?.token).toBe('tok2')
    expect(g.guesses.value).toHaveLength(0)
    expect(g.error.value).toBeNull()
    expect(g.submitting.value).toBe(false)
    expect(g.loading.value).toBe(false)

    await g.submitGuess(2) // the game continues on the fresh token
    expect(postedBody('/api/game/guess', 2)).toEqual({ puzzleToken: 'tok2', itemId: 2 })
    expect(g.guesses.value).toHaveLength(1)
  })

  it('410 on a free guess fetches a new free token', async () => {
    let n = 0
    mockFetch(
      weaponDaily({
        '/api/game/free': () => ({ puzzleToken: `free${++n}` }),
        '/api/game/guess': (b: JsonBody) =>
          b?.puzzleToken === 'free1' ? problem(410) : guessResult(Number(b?.itemId), false),
      }),
    )
    const g = useGame()
    await g.init()
    await g.setMode('free')

    await g.submitGuess(1)

    expect(fetchCalls('/api/game/free')).toHaveLength(2)
    expect(fetchCalls('/api/game/daily')).toHaveLength(1)
    expect(g.board.value).toEqual({ token: 'free2', guesses: [], status: 'playing' })
    expect(g.daily.value).toBeNull()
    expect(g.error.value).toBeNull()
    expect(g.submitting.value).toBe(false)
  })

  it('400 on a guess exposes the error without refetching', async () => {
    let n = 0
    mockFetch(weaponDaily({ '/api/game/guess': () => (n++ === 0 ? problem(400) : guessResult(1, true)) }))
    const g = useGame()
    await g.init()

    await g.submitGuess(1)

    expect(g.error.value?.status).toBe(400)
    expect(g.error.value?.detail).toBe('HTTP 400')
    expect(g.error.value?.isNetwork).toBe(false)
    expect(g.guesses.value).toHaveLength(0)
    expect(g.status.value).toBe('playing')
    expect(g.board.value?.token).toBe('tok1')
    expect(fetchCalls('/api/game/daily')).toHaveLength(1)
    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(g.submitting.value).toBe(false)

    await g.submitGuess(1) // a later success clears the error
    expect(g.error.value).toBeNull()
    expect(g.status.value).toBe('won')
  })

  it('404 on a guess exposes the error without refetching', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': () => problem(404) }))
    const g = useGame()
    await g.init()

    await g.submitGuess(1)

    expect(g.error.value?.status).toBe(404)
    expect(g.guesses.value).toHaveLength(0)
    expect(fetchCalls('/api/game/daily')).toHaveLength(1)
    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(storedBoards()['daily|weapon|2026-07-16']?.guesses).toHaveLength(0)
  })

  it('an unreachable API on init exposes a network error and retry recovers', async () => {
    mockFetch({ '/api/items': networkFailure })
    const g = useGame()

    await expect(g.init()).resolves.toBeUndefined()

    expect(g.error.value?.status).toBe(0)
    expect(g.error.value?.isNetwork).toBe(true)
    expect(g.loading.value).toBe(false)
    expect(g.board.value).toBeNull()
    expect(g.items.value).toEqual([])

    mockFetch(weaponDaily())
    await g.retry()

    expect(g.error.value).toBeNull()
    expect(g.board.value?.token).toBe('tok1')
    expect(g.items.value).toHaveLength(2)
    expect(g.loading.value).toBe(false)
  })

  it('a failing init after a category change clears the previous context until retry succeeds', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, true) }))
    const g = useGame()
    await g.init()
    await g.submitGuess(1)
    expect(g.streak.value).toBe(1)

    mockFetch({ '/api/items': networkFailure })
    await g.setCategory('armor')

    // The weapon board / pool / streak must not be shown under the armor tab.
    expect(g.category.value).toBe('armor')
    expect(g.error.value?.status).toBe(0)
    expect(g.error.value?.isNetwork).toBe(true)
    expect(g.board.value).toBeNull()
    expect(g.daily.value).toBeNull()
    expect(g.items.value).toEqual([])
    expect(g.streak.value).toBe(0)
    expect(g.splashSrc.value).toBeNull()
    expect(g.loading.value).toBe(false)

    mockFetch({ '/api/items': [item(10, 'Helm')], '/api/game/daily': DAILY_ARMOR })
    await g.retry()

    expect(g.error.value).toBeNull()
    expect(g.board.value?.token).toBe('tokA')
    expect(g.daily.value).toEqual(DAILY_ARMOR)
    expect(g.items.value.map((i) => i.id)).toEqual([10])
    expect(g.loading.value).toBe(false)
  })

  it('a failing init in the same context keeps the displayed board', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, false) }))
    const g = useGame()
    await g.init()
    await g.submitGuess(1)

    mockFetch({ '/api/items': networkFailure })
    await g.retry()

    expect(g.error.value?.status).toBe(0)
    expect(g.board.value?.token).toBe('tok1')
    expect(g.guesses.value).toHaveLength(1)
    expect(g.daily.value).toEqual(DAILY_1)
    expect(g.items.value).toHaveLength(2)
    expect(g.loading.value).toBe(false)

    mockFetch(weaponDaily())
    await g.retry()

    expect(g.error.value).toBeNull()
    expect(g.guesses.value).toHaveLength(1)
  })

  it('a failing refetch after a 410 keeps the board of the same context', async () => {
    let dailyCalls = 0
    mockFetch({
      '/api/items': [item(1, 'Sunshot'), item(2, 'Gjallarhorn')],
      '/api/game/daily': () => (dailyCalls++ === 0 ? DAILY_1 : networkFailure()),
      '/api/game/guess': (b: JsonBody) => (b?.itemId === 2 ? problem(410) : guessResult(1, false)),
    })
    const g = useGame()
    await g.init()
    await g.submitGuess(1)

    await g.submitGuess(2) // 410 → init() in the same context, whose daily fetch fails

    expect(fetchCalls('/api/game/daily')).toHaveLength(2)
    expect(g.error.value?.status).toBe(0)
    expect(g.board.value?.token).toBe('tok1')
    expect(g.guesses.value).toHaveLength(1)
    expect(g.submitting.value).toBe(false)
    expect(g.loading.value).toBe(false)
  })

  it('an unreachable API on a guess keeps the guesses and exposes a network error', async () => {
    mockFetch(weaponDaily({ '/api/game/guess': (b: JsonBody) => (b?.itemId === 2 ? networkFailure() : guessResult(1, false)) }))
    const g = useGame()
    await g.init()
    await g.submitGuess(1)

    await g.submitGuess(2)

    expect(g.error.value?.status).toBe(0)
    expect(g.error.value?.isNetwork).toBe(true)
    expect(g.guesses.value).toHaveLength(1)
    expect(g.status.value).toBe('playing')
    expect(g.submitting.value).toBe(false)
    expect(fetchCalls('/api/game/daily')).toHaveLength(1)
  })

  it('a corrupted localStorage is reset silently', async () => {
    localStorage.setItem(STORAGE_KEY, '{oops')
    mockFetch(weaponDaily())
    const g = useGame()

    await expect(g.init()).resolves.toBeUndefined()

    expect(g.error.value).toBeNull()
    expect(g.board.value).toEqual({
      token: 'tok1',
      date: '2026-07-16',
      number: 1,
      guesses: [],
      status: 'playing',
    })
    expect(g.streak.value).toBe(0)
    expect(storedBoards()['daily|weapon|2026-07-16']).toBeDefined()
  })

  it('a board whose guesses are partially corrupted is reset silently (REPRO-2, SEC-F7)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'daily|weapon|2026-07-16': {
            token: 'old',
            date: '2026-07-16',
            number: 1,
            guesses: [null, 'x', {}],
            status: 'playing',
          },
        },
        streaks: {},
      }),
    )
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, false) }))
    const g = useGame()

    await expect(g.init()).resolves.toBeUndefined()

    expect(g.error.value).toBeNull()
    expect(g.board.value).toEqual({
      token: 'tok1',
      date: '2026-07-16',
      number: 1,
      guesses: [],
      status: 'playing',
    })
    expect(g.guesses.value).toEqual([])
    expect(() => g.usedIds.value).not.toThrow()
    expect(g.usedIds.value).toEqual(new Set())
    expect(g.splashLevel.value).toBe(0)
    expect(g.status.value).toBe('playing')

    await g.submitGuess(1) // the game goes on from the blank board
    expect(g.guesses.value.map((r) => r.guess.id)).toEqual([1])
    expect(storedBoards()['daily|weapon|2026-07-16']?.guesses).toHaveLength(1)
  })

  it('a stored board with a corrupted date is replaced and a later win never throws (SEC-F7)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        boards: {
          'daily|weapon|2026-07-16': { token: 'old', date: 'xx', number: 1, guesses: [], status: 'playing' },
        },
        streaks: { weapon: { count: 1, lastWinDate: '2026-07-15' } },
      }),
    )
    mockFetch(weaponDaily({ '/api/game/guess': guessResult(1, true) }))
    const g = useGame()

    await g.init()
    expect(g.board.value?.date).toBe('2026-07-16')
    expect(g.streak.value).toBe(1)

    await expect(g.submitGuess(1)).resolves.toBeUndefined()

    expect(g.status.value).toBe('won')
    expect(g.streak.value).toBe(2)
    expect(g.error.value).toBeNull()
  })

  it('a failing newFree exposes the error and keeps the current board', async () => {
    let n = 0
    mockFetch(weaponDaily({ '/api/game/free': () => (n++ === 0 ? { puzzleToken: 'free1' } : problem(503)) }))
    const g = useGame()
    await g.init()
    await g.setMode('free')

    await g.newFree()

    expect(g.error.value?.status).toBe(503)
    expect(g.board.value?.token).toBe('free1')
    expect(g.loading.value).toBe(false)
  })
})

describe('useGame — restored lost board without a target (REQ-008)', () => {
  const DAILY_1B = { puzzleToken: 'tok1b', date: '2026-07-16', number: 1 }

  it('daily: init reveals the target with the fresh token and persists it', async () => {
    seedBoard('daily|weapon|2026-07-16', lostBoard('tok1', { date: '2026-07-16', number: 1 }))
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1B,
      '/api/game/reveal': { item: REVEALED },
    })
    const g = useGame()

    await g.init()

    expect(fetchCalls('/api/game/reveal')).toHaveLength(1)
    expect(postedBody('/api/game/reveal')).toEqual({ puzzleToken: 'tok1b' })
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.token).toBe('tok1b')
    expect(g.board.value?.revealed?.id).toBe(99)
    expect(g.guesses.value).toHaveLength(8)
    expect(g.splashLevel.value).toBe(9)
    expect(g.error.value).toBeNull()
    expect(g.loading.value).toBe(false)
    expect(storedBoards()['daily|weapon|2026-07-16']).toMatchObject({
      token: 'tok1b',
      status: 'lost',
      revealed: { id: 99 },
    })
  })

  it('daily: a failing reveal keeps the lost board, exposes the error and retry completes it', async () => {
    seedBoard('daily|weapon|2026-07-16', lostBoard('tok1', { date: '2026-07-16', number: 1 }))
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1B,
      '/api/game/reveal': networkFailure,
    })
    const g = useGame()

    await g.init()

    expect(fetchCalls('/api/game/reveal')).toHaveLength(1)
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.token).toBe('tok1b')
    expect(g.board.value?.revealed).toBeUndefined()
    expect(g.guesses.value).toHaveLength(8)
    expect(g.daily.value).toEqual(DAILY_1B)
    expect(g.error.value?.status).toBe(0)
    expect(g.loading.value).toBe(false)
    expect(storedBoards()['daily|weapon|2026-07-16']?.revealed).toBeUndefined()

    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1B,
      '/api/game/reveal': { item: REVEALED },
    })
    await g.retry()

    expect(fetchCalls('/api/game/reveal')).toHaveLength(1)
    expect(g.board.value?.revealed?.id).toBe(99)
    expect(g.status.value).toBe('lost')
    expect(g.error.value).toBeNull()
    expect(storedBoards()['daily|weapon|2026-07-16']?.revealed?.id).toBe(99)
  })

  it('daily: a reveal answering 410 keeps the lost board and exposes the error', async () => {
    seedBoard('daily|weapon|2026-07-16', lostBoard('tok1', { date: '2026-07-16', number: 1 }))
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1B,
      '/api/game/reveal': () => problem(410),
    })
    const g = useGame()

    await g.init()

    expect(fetchCalls('/api/game/daily')).toHaveLength(1)
    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.revealed).toBeUndefined()
    expect(g.error.value?.status).toBe(410)
    expect(g.loading.value).toBe(false)
  })

  it('free: a reveal answering 410 starts a new free game without error', async () => {
    seedBoard('free|weapon', lostBoard('freeDead'))
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/reveal': () => problem(410),
      '/api/game/free': { puzzleToken: 'free2' },
    })
    const g = useGame()

    await g.setMode('free')

    expect(postedBody('/api/game/reveal')).toEqual({ puzzleToken: 'freeDead' })
    expect(postedBody('/api/game/free')).toEqual({ category: 'weapon' })
    expect(g.board.value).toEqual({ token: 'free2', guesses: [], status: 'playing' })
    expect(g.status.value).toBe('playing')
    expect(g.splashLevel.value).toBe(0)
    expect(g.error.value).toBeNull()
    expect(g.loading.value).toBe(false)
    expect(storedBoards()['free|weapon']).toEqual({ token: 'free2', guesses: [], status: 'playing' })
  })

  it('free: a reveal answering 500 keeps the lost board and exposes the error', async () => {
    seedBoard('free|weapon', lostBoard('free1'))
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/reveal': () => problem(500),
      '/api/game/free': { puzzleToken: 'free2' },
    })
    const g = useGame()

    await g.setMode('free')

    expect(fetchCalls('/api/game/reveal')).toHaveLength(1)
    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.token).toBe('free1')
    expect(g.board.value?.revealed).toBeUndefined()
    expect(g.guesses.value).toHaveLength(8)
    expect(g.error.value?.status).toBe(500)
    expect(g.loading.value).toBe(false)
    expect(storedBoards()['free|weapon']?.status).toBe('lost')
  })

  it('free: a reveal succeeding fills the target of the restored board', async () => {
    seedBoard('free|weapon', lostBoard('free1'))
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/reveal': { item: REVEALED },
      '/api/game/free': { puzzleToken: 'free2' },
    })
    const g = useGame()

    await g.setMode('free')

    expect(postedBody('/api/game/reveal')).toEqual({ puzzleToken: 'free1' })
    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.revealed?.id).toBe(99)
    expect(g.error.value).toBeNull()
    expect(storedBoards()['free|weapon']?.revealed?.id).toBe(99)
  })

  it('a restored lost board that already has its target is not revealed again', async () => {
    seedBoard(
      'daily|weapon|2026-07-16',
      lostBoard('tok1', { date: '2026-07-16', number: 1, revealed: REVEALED }),
    )
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1B,
      '/api/game/reveal': () => problem(500),
    })
    const g = useGame()

    await g.init()

    expect(fetchCalls('/api/game/reveal')).toHaveLength(0)
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.revealed?.id).toBe(99)
    expect(g.error.value).toBeNull()
  })

  it.each(['won', 'playing'] as const)('a restored %s board never triggers a reveal', async (status) => {
    const guesses = [guessResult(1, status === 'won')]
    seedBoards({
      'daily|weapon|2026-07-16': { token: 'tok1', date: '2026-07-16', number: 1, guesses, status },
      'free|weapon': { token: 'free1', guesses, status },
    })
    mockFetch({
      '/api/items': TEN_ITEMS,
      '/api/game/daily': DAILY_1B,
      '/api/game/free': { puzzleToken: 'free2' },
      '/api/game/reveal': () => problem(500),
    })
    const g = useGame()

    await g.init()
    expect(g.status.value).toBe(status)
    expect(g.guesses.value).toHaveLength(1)

    await g.setMode('free')
    expect(g.status.value).toBe(status)
    expect(g.board.value?.token).toBe('free1')

    expect(fetchCalls('/api/game/reveal')).toHaveLength(0)
    expect(fetchCalls('/api/game/free')).toHaveLength(0)
    expect(g.error.value).toBeNull()
  })
})

describe('useGame — guess in flight during a context switch (reviewer C1)', () => {
  /** Weapon and armor daily puzzles; a guess on `tok1` stays pending until `slowGuess` resolves. */
  function twoCategories(slowGuess: { promise: Promise<unknown> }, extra: Routes = {}): void {
    mockFetch({
      '/api/items': (_b: JsonBody, url: string) =>
        url.includes('category=armor') ? [item(10, 'Helm of Saint-14')] : TEN_ITEMS,
      '/api/game/daily': (_b: JsonBody, url: string) => (url.includes('category=armor') ? DAILY_ARMOR : DAILY_1),
      '/api/game/guess': (b: JsonBody) =>
        b?.puzzleToken === 'tok1' ? slowGuess.promise : guessResult(Number(b?.itemId), false),
      ...extra,
    })
  }

  it('REPRO-1: a guess resolving after setCategory is stored for its own context and never shown under the new tab', async () => {
    const slowGuess = deferred<GuessResult>()
    twoCategories(slowGuess)
    const g = useGame()
    await g.init()
    expect(g.board.value?.token).toBe('tok1')

    const pendingGuess = g.submitGuess(1) // weapon guess in flight
    await g.setCategory('armor') // the user switches tabs during the latency
    expect(g.board.value?.token).toBe('tokA')
    expect(g.submitting.value).toBe(true)
    await g.submitGuess(10) // still ignored while the weapon guess is in flight
    expect(fetchCalls('/api/game/guess')).toHaveLength(1)

    slowGuess.resolve(guessResult(1, false)) // the weapon guess arrives
    await pendingGuess

    // The armor board stays displayed, untouched.
    expect(g.category.value).toBe('armor')
    expect(g.board.value).toEqual({
      token: 'tokA',
      date: '2026-07-16',
      number: 1,
      guesses: [],
      status: 'playing',
    })
    expect(g.guesses.value).toEqual([])
    expect(g.usedIds.value.size).toBe(0)
    expect(g.splashSrc.value).toBe('/api/game/splash?token=tokA&level=0')
    expect(g.submitting.value).toBe(false)
    expect(g.error.value).toBeNull()
    // The evaluated weapon guess is kept, under the weapon key only.
    let boards = storedBoards()
    expect(boards['daily|weapon|2026-07-16']).toMatchObject({ token: 'tok1', status: 'playing' })
    expect(boards['daily|weapon|2026-07-16']?.guesses.map((r) => r.guess.id)).toEqual([1])
    expect(boards['daily|armor|2026-07-16']).toEqual({
      token: 'tokA',
      date: '2026-07-16',
      number: 1,
      guesses: [],
      status: 'playing',
    })

    // A guess under the armor tab is evaluated against the armor puzzle and stored there only.
    await g.submitGuess(10)
    expect(postedBody('/api/game/guess', 1)).toEqual({ puzzleToken: 'tokA', itemId: 10 })
    expect(g.guesses.value.map((r) => r.guess.id)).toEqual([10])
    expect(g.splashSrc.value).toBe('/api/game/splash?token=tokA&level=1')
    boards = storedBoards()
    expect(boards['daily|armor|2026-07-16']).toMatchObject({ token: 'tokA' })
    expect(boards['daily|armor|2026-07-16']?.guesses.map((r) => r.guess.id)).toEqual([10])
    expect(boards['daily|weapon|2026-07-16']?.guesses.map((r) => r.guess.id)).toEqual([1])

    // Reload under the armor tab, then back to weapon: each context has its own guesses.
    const g2 = useGame()
    await g2.setCategory('armor')
    expect(g2.board.value?.token).toBe('tokA')
    expect(g2.guesses.value.map((r) => r.guess.id)).toEqual([10])
    await g2.setCategory('weapon')
    expect(g2.board.value?.token).toBe('tok1')
    expect(g2.guesses.value.map((r) => r.guess.id)).toEqual([1])
  })

  it('a correct guess resolving after setCategory records the win for its own category, not the displayed streak', async () => {
    const slowGuess = deferred<GuessResult>()
    twoCategories(slowGuess)
    const g = useGame()
    await g.init()

    const pendingGuess = g.submitGuess(1)
    await g.setCategory('armor')
    slowGuess.resolve(guessResult(1, true))
    await pendingGuess

    expect(g.board.value?.token).toBe('tokA')
    expect(g.status.value).toBe('playing')
    expect(g.streak.value).toBe(0) // the armor streak, untouched
    expect(g.error.value).toBeNull()
    expect(storedBoards()['daily|weapon|2026-07-16']?.status).toBe('won')
    expect(storedBoards()['daily|armor|2026-07-16']?.status).toBe('playing')

    await g.setCategory('weapon')
    expect(g.status.value).toBe('won')
    expect(g.streak.value).toBe(1)
    expect(g.splashLevel.value).toBe(MAX_SPLASH_LEVEL)
  })

  it('the eighth guess and its reveal resolving after setCategory complete the stored weapon board only', async () => {
    const slowGuess = deferred<GuessResult>()
    twoCategories(slowGuess, { '/api/game/reveal': { item: REVEALED } })
    seedBoard('daily|weapon|2026-07-16', {
      token: 'tok1',
      date: '2026-07-16',
      number: 1,
      guesses: Array.from({ length: MAX_GUESSES - 1 }, (_, i) => guessResult(i + 1, false)),
      status: 'playing',
    })
    const g = useGame()
    await g.init()
    expect(g.guesses.value).toHaveLength(7)

    const pendingGuess = g.submitGuess(8)
    await g.setCategory('armor')
    slowGuess.resolve(guessResult(8, false))
    await pendingGuess

    expect(postedBody('/api/game/reveal')).toEqual({ puzzleToken: 'tok1' })
    expect(g.board.value?.token).toBe('tokA')
    expect(g.status.value).toBe('playing')
    expect(g.guesses.value).toEqual([])
    expect(g.error.value).toBeNull()
    expect(g.submitting.value).toBe(false)
    const weapon = storedBoards()['daily|weapon|2026-07-16']
    expect(weapon).toMatchObject({ status: 'lost', revealed: { id: 99 } })
    expect(weapon?.guesses).toHaveLength(8)
    expect(storedBoards()['daily|armor|2026-07-16']?.status).toBe('playing')

    await g.setCategory('weapon')
    expect(g.status.value).toBe('lost')
    expect(g.board.value?.revealed?.id).toBe(99)
    expect(fetchCalls('/api/game/reveal')).toHaveLength(1) // already revealed: not revealed again on restore
  })

  it('a 410 resolving after setMode does not refetch the superseded context', async () => {
    const slowGuess = deferred<Response>()
    mockFetch(
      weaponDaily({
        '/api/game/free': { puzzleToken: 'free1' },
        '/api/game/guess': () => slowGuess.promise,
      }),
    )
    const g = useGame()
    await g.init()

    const pendingGuess = g.submitGuess(1)
    await g.setMode('free')
    expect(g.board.value?.token).toBe('free1')

    slowGuess.resolve(problem(410))
    await pendingGuess

    expect(fetchCalls('/api/game/daily')).toHaveLength(1)
    expect(fetchCalls('/api/game/free')).toHaveLength(1)
    expect(g.mode.value).toBe('free')
    expect(g.board.value).toEqual({ token: 'free1', guesses: [], status: 'playing' })
    expect(g.daily.value).toBeNull()
    expect(g.error.value).toBeNull()
    expect(g.submitting.value).toBe(false)
    expect(g.loading.value).toBe(false)
    expect(storedBoards()['daily|weapon|2026-07-16']?.guesses).toEqual([])
  })

  it('an error resolving after setCategory is not exposed under the new context', async () => {
    const slowGuess = deferred<Response>()
    twoCategories(slowGuess)
    const g = useGame()
    await g.init()

    const pendingGuess = g.submitGuess(1)
    await g.setCategory('armor')
    slowGuess.resolve(problem(500))
    await pendingGuess

    expect(g.error.value).toBeNull()
    expect(g.board.value?.token).toBe('tokA')
    expect(g.submitting.value).toBe(false)
    expect(storedBoards()['daily|weapon|2026-07-16']?.guesses).toEqual([])

    await g.submitGuess(10) // the new context works normally afterwards
    expect(g.guesses.value.map((r) => r.guess.id)).toEqual([10])
  })

  it('a guess resolving in an unchanged context still updates the board (no false positive)', async () => {
    const slowGuess = deferred<GuessResult>()
    twoCategories(slowGuess)
    const g = useGame()
    await g.init()

    const pendingGuess = g.submitGuess(1)
    await g.setCategory('weapon') // same value: no-op, no sequence bump
    slowGuess.resolve(guessResult(1, false))
    await pendingGuess

    expect(g.guesses.value.map((r) => r.guess.id)).toEqual([1])
    expect(g.board.value?.token).toBe('tok1')
    expect(g.splashLevel.value).toBe(1)
  })
})
