/**
 * QA TASK-015 (devflow-qa) — integration of the App shell with the REAL
 * `useGame` / `useLocalState` / `api` modules; only the global `fetch` is
 * simulated. `App.spec.ts` isolates the shell behind a fake composable; this
 * file checks the actual wiring (REQ-010 signal formula through real guesses,
 * REQ-012 block order, REQ-015 banner + RETRY → `init()`, 410 → silent refetch,
 * DEC-010 busy states driven by real in-flight requests).
 *
 * Guesses are submitted through the `pick` emit of the SearchBox stub and
 * new games through the panel buttons, exactly as the user would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '@/App.vue'
import SearchBox from '@/components/SearchBox.vue'
import { i18n, setLocale } from '@/i18n'
import { MAX_GUESSES, MAX_SPLASH_LEVEL } from '@/composables/useGame'
import type { Feedback, ItemDisplay, ItemSummary } from '@/lib/api'

// ---------------------------------------------------------------- fixtures

const TARGET_ID = 3
const DATE = '2026-10-01'
const NUMBER = 78

function summary(id: number, game: 'D1' | 'D2' = 'D2'): ItemSummary {
  return {
    id,
    nameEn: `Item ${id}`,
    nameFr: `Objet ${id}`,
    game,
    typeEn: 'Hand Cannon',
    typeFr: 'Revolver',
    iconUrl: `/api/icons/${id}.jpg`,
  }
}

const WEAPONS: ItemSummary[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => summary(id))
const ARMORS: ItemSummary[] = [101, 102].map((id) => summary(id, 'D1'))

function display(id: number): ItemDisplay {
  return {
    id,
    nameEn: `Item ${id}`,
    nameFr: `Objet ${id}`,
    game: 'D2',
    rarityEn: 'Exotic',
    rarityFr: 'Exotique',
    seasonEn: 'Season 1',
    seasonFr: 'Saison 1',
    slotEn: 'Energy',
    slotFr: 'Énergétique',
    typeEn: 'Hand Cannon',
    typeFr: 'Revolver',
    element: 'Solar',
    elementEn: 'Solar',
    elementFr: 'Solaire',
    classEn: null,
    classFr: null,
    lightGgUrl: null,
  }
}

function feedback(correct: boolean): Feedback {
  return {
    rarity: 'hit',
    season: { kind: correct ? 'hit' : 'near', dir: correct ? 0 : 1 },
    slot: correct ? 'hit' : 'miss',
    type: correct ? 'hit' : 'miss',
    element: 'hit',
    class: null,
    game: 'hit',
  }
}

function problem(status: number, detail: string) {
  return { status, body: { type: 'about:blank', title: 'error', status, detail } }
}

// ------------------------------------------------------- simulated API

interface Reply {
  status: number
  body: unknown
}
interface Call {
  method: string
  url: string
  body?: unknown
}

let calls: Call[] = []
let failNetwork = false
let dailyIssued = 0
let freeIssued = 0
let guessGate: Promise<void> | null = null
let freeGate: Promise<void> | null = null
let overrides: Partial<Record<'items' | 'daily' | 'free' | 'guess' | 'reveal', Reply>> = {}

function hold(kind: 'guess' | 'free'): () => void {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  if (kind === 'guess') guessGate = gate
  else freeGate = gate
  return () => {
    if (kind === 'guess') guessGate = null
    else freeGate = null
    release()
  }
}

async function route(method: string, url: string, body: unknown): Promise<Reply> {
  const u = new URL(url, 'http://localhost')
  const category = u.searchParams.get('category')
  if (method === 'GET' && u.pathname === '/api/items') {
    return overrides.items ?? { status: 200, body: category === 'armor' ? ARMORS : WEAPONS }
  }
  if (method === 'GET' && u.pathname === '/api/game/daily') {
    dailyIssued += 1
    return (
      overrides.daily ?? {
        status: 200,
        body: { puzzleToken: `tok-daily-${category}-${dailyIssued}`, date: DATE, number: NUMBER },
      }
    )
  }
  if (method === 'POST' && u.pathname === '/api/game/free') {
    if (freeGate) await freeGate
    freeIssued += 1
    return overrides.free ?? { status: 200, body: { puzzleToken: `tok-free-${freeIssued}` } }
  }
  if (method === 'POST' && u.pathname === '/api/game/guess') {
    if (guessGate) await guessGate
    if (overrides.guess) return overrides.guess
    const { itemId } = body as { itemId: number }
    const correct = itemId === TARGET_ID
    return { status: 200, body: { correct, guess: display(itemId), feedback: feedback(correct) } }
  }
  if (method === 'POST' && u.pathname === '/api/game/reveal') {
    return overrides.reveal ?? { status: 200, body: { item: display(TARGET_ID) } }
  }
  return problem(404, 'route inconnue')
}

const fetchStub = vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
  const method = init?.method ?? 'GET'
  const url = String(input)
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
  calls.push({ method, url, body })
  if (failNetwork) throw new TypeError('fetch failed')
  const r = await route(method, url, body)
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
})

const count = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.url.startsWith(path)).length

// ----------------------------------------------------------------- helpers

let mounted: VueWrapper[] = []

async function settle() {
  for (let i = 0; i < 5; i += 1) await flushPromises()
}

async function mountApp() {
  const wrapper = mount(App, { global: { plugins: [i18n] } })
  mounted.push(wrapper)
  await settle()
  return wrapper
}

/** Map of intel stat label → value as rendered. */
function stats(wrapper: VueWrapper): Record<string, string> {
  const out: Record<string, string> = {}
  for (const stat of wrapper.findAll('.intel .stat')) {
    out[stat.find('.stat-k').text()] = stat.find('.stat-v').text()
  }
  return out
}

function switchButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('.topbar .mode-switch button').find((b) => b.text() === text)
  expect(button, `switch "${text}"`).toBeDefined()
  return button!
}

/** Direct children of `.app` as `tag.class.class` (prototype block order). */
function blocks(wrapper: VueWrapper): string[] {
  return Array.from(wrapper.find('.app').element.children).map(
    (el) => `${el.tagName.toLowerCase()}.${el.className.split(' ').filter(Boolean).join('.')}`,
  )
}

/** Submits a guess the way the real SearchBox will: through its `pick` emit. */
async function pick(wrapper: VueWrapper, id: number) {
  wrapper.findComponent(SearchBox).vm.$emit('pick', id)
  await settle()
}

function litTicks(wrapper: VueWrapper) {
  return wrapper.findAll('.bar-tick.on').length
}

function splashSrc(wrapper: VueWrapper) {
  return wrapper.find('img.splash-canvas').attributes('src')
}

/** Spec §6 / CT-05: `min(8, floor(g / 8 × 9))` while playing, 9 once over. */
const expectedLevel = (g: number) =>
  Math.min(MAX_SPLASH_LEVEL - 1, Math.floor((g / MAX_GUESSES) * MAX_SPLASH_LEVEL))

// ------------------------------------------------------------------- tests

describe('App shell × real useGame (QA TASK-015)', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
    calls = []
    failNetwork = false
    dailyIssued = 0
    freeIssued = 0
    guessGate = null
    freeGate = null
    overrides = {}
    fetchStub.mockClear()
    vi.stubGlobal('fetch', fetchStub)
  })

  afterEach(() => {
    for (const wrapper of mounted) wrapper.unmount()
    mounted = []
    vi.unstubAllGlobals()
  })

  it('loads the daily weapon puzzle on mount and renders the prototype blocks in order', async () => {
    const wrapper = await mountApp()
    expect(count('GET', '/api/items?category=weapon')).toBe(1)
    expect(count('GET', '/api/game/daily?category=weapon')).toBe(1)
    expect(calls).toHaveLength(2)

    expect(blocks(wrapper)).toEqual([
      'header.topbar',
      'section.intel',
      'div.splash-stage',
      'div.search-wrap',
      'div.legend',
      'footer.footer',
    ])
    const s = stats(wrapper)
    expect(s['DÉFI']).toBe(`#${NUMBER}`)
    expect(s['ESSAIS']).toBe(`0 / ${MAX_GUESSES}`)
    expect(s['POOL']).toBe(String(WEAPONS.length))
    expect(s['MODE']).toBe('QUOTIDIEN')
    expect(s['SÉRIE']).toBe('0')

    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-daily-weapon-1&level=0')
    expect(wrapper.findAll('.bar-tick')).toHaveLength(10)
    expect(litTicks(wrapper)).toBe(1)
    expect(wrapper.find('.splash-frame').classes('revealed')).toBe(false)
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(wrapper.find('.loading').exists()).toBe(false)
    expect(wrapper.find('.board').exists()).toBe(false)
  })

  it('REQ-010: the signal follows min(8, floor(g/8×9)) through real guesses, then 9 on defeat with the reveal', async () => {
    const wrapper = await mountApp()
    const wrong = WEAPONS.filter((i) => i.id !== TARGET_ID)
    for (let g = 1; g < MAX_GUESSES; g += 1) {
      await pick(wrapper, wrong[g - 1]!.id)
      const level = expectedLevel(g)
      expect(stats(wrapper)['ESSAIS'], `g=${g}`).toBe(`${g} / ${MAX_GUESSES}`)
      expect(litTicks(wrapper), `g=${g}`).toBe(level + 1)
      expect(splashSrc(wrapper), `g=${g}`).toBe(`/api/game/splash?token=tok-daily-weapon-1&level=${level}`)
      expect(wrapper.find('.splash-frame').classes('revealed'), `g=${g}`).toBe(false)
      expect(wrapper.find('.board').exists()).toBe(true)
      expect(wrapper.find('.legend').exists()).toBe(false)
      expect(wrapper.find('.search-wrap').exists()).toBe(true)
    }
    // Level 8 is never requested while playing: g = 7 gives floor(7.875) = 7.
    expect(expectedLevel(MAX_GUESSES - 1)).toBe(7)

    await pick(wrapper, wrong[MAX_GUESSES - 1]!.id)
    expect(count('POST', '/api/game/guess')).toBe(MAX_GUESSES)
    expect(count('POST', '/api/game/reveal')).toBe(1)
    expect(stats(wrapper)['ESSAIS']).toBe(`${MAX_GUESSES} / ${MAX_GUESSES}`)
    expect(litTicks(wrapper)).toBe(10)
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-daily-weapon-1&level=9')
    expect(wrapper.find('.splash-frame').classes('revealed')).toBe(true)
    expect(wrapper.find('.win-panel.loss').exists()).toBe(true)
    expect(wrapper.find('.win-panel.loss .win-title').text()).toBe('// CIBLE ÉCHAPPÉE')
    expect(wrapper.find('.win-actions button.btn.primary').exists()).toBe(false) // daily: no retry
    expect(wrapper.find('.search-wrap').exists()).toBe(false)
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(blocks(wrapper)).toEqual([
      'header.topbar',
      'section.intel',
      'div.splash-stage',
      'div.win-panel.loss', // the answer sits above the board
      'div.board',
      'footer.footer',
    ])
    expect(stats(wrapper)['SÉRIE']).toBe('0')
  })

  it('REQ-010 / DEC-010: a daily win reveals the signal, shows the win panel without NEW GAME and the streak', async () => {
    const wrapper = await mountApp()
    await pick(wrapper, 1)
    await pick(wrapper, 2)
    expect(litTicks(wrapper)).toBe(expectedLevel(2) + 1)
    await pick(wrapper, TARGET_ID)
    expect(count('POST', '/api/game/guess')).toBe(3)
    expect(count('POST', '/api/game/reveal')).toBe(0)
    expect(litTicks(wrapper)).toBe(10)
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-daily-weapon-1&level=9')
    expect(wrapper.find('.splash-frame').classes('revealed')).toBe(true)
    expect(wrapper.find('.win-panel').exists()).toBe(true)
    expect(wrapper.find('.win-panel').classes('loss')).toBe(false)
    expect(wrapper.find('.win-actions button.btn.primary').exists()).toBe(false)
    expect(wrapper.find('.search-wrap').exists()).toBe(false)
    const s = stats(wrapper)
    expect(s['ESSAIS']).toBe(`3 / ${MAX_GUESSES}`)
    expect(s['SÉRIE']).toBe('1')
    // No entry point is left to guess again: the search box is gone.
    expect(wrapper.findComponent(SearchBox).exists()).toBe(false)
    expect(count('POST', '/api/game/guess')).toBe(3)
  })

  it('REQ-015: unreachable API → network banner, RETRY re-runs init() and the board appears', async () => {
    failNetwork = true
    const wrapper = await mountApp()
    expect(blocks(wrapper)).toEqual(['header.topbar', 'div.error-banner', 'footer.footer'])
    const banner = wrapper.find('.error-banner')
    expect(banner.find('span').text()).toBe('API injoignable — le serveur tourne ?')
    expect(wrapper.find('.loading').exists()).toBe(false)
    expect(wrapper.find('.intel').exists()).toBe(false)
    const before = calls.length

    setLocale('en')
    await settle()
    expect(wrapper.find('.error-banner span').text()).toBe('API unreachable — is the server running?')
    expect(wrapper.find('.error-banner button.btn').text()).toBe('RETRY')
    setLocale('fr')

    failNetwork = false
    await banner.find('button.btn').trigger('click')
    await settle()
    expect(calls.length).toBe(before + 2)
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(wrapper.find('.intel').exists()).toBe(true)
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-daily-weapon-1&level=0')
  })

  it('REQ-015: an HTTP error shows the status in the banner, in both locales', async () => {
    overrides.daily = problem(503, 'base vide')
    const wrapper = await mountApp()
    expect(wrapper.find('.error-banner span').text()).toBe('Erreur serveur (503) — réessayez.')
    expect(wrapper.find('.intel').exists()).toBe(false)
    setLocale('en')
    await settle()
    expect(wrapper.find('.error-banner span').text()).toBe('Server error (503) — try again.')
  })

  it('REQ-015: a 410 on a guess refetches the daily silently (no banner, guesses kept, fresh token)', async () => {
    const wrapper = await mountApp()
    await pick(wrapper, 1)
    expect(stats(wrapper)['ESSAIS']).toBe(`1 / ${MAX_GUESSES}`)

    overrides.guess = problem(410, 'le défi du jour a changé')
    await pick(wrapper, 2)
    expect(count('POST', '/api/game/guess')).toBe(2)
    expect(count('GET', '/api/game/daily?category=weapon')).toBe(2)
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(stats(wrapper)['ESSAIS']).toBe(`1 / ${MAX_GUESSES}`)
    expect(splashSrc(wrapper)).toBe(`/api/game/splash?token=tok-daily-weapon-2&level=${expectedLevel(1)}`)
    expect(wrapper.find('.search-wrap').exists()).toBe(true)

    // The failed guess is not replayed and the game goes on with the new token.
    overrides = {}
    await pick(wrapper, 2)
    expect(count('POST', '/api/game/guess')).toBe(3)
    expect(stats(wrapper)['ESSAIS']).toBe(`2 / ${MAX_GUESSES}`)
  })

  it('REQ-015: a 4xx/5xx on a guess shows the banner above the board, which stays playable', async () => {
    const wrapper = await mountApp()
    overrides.guess = problem(500, 'boom')
    await pick(wrapper, 1)
    expect(blocks(wrapper)).toEqual([
      'header.topbar',
      'div.error-banner',
      'section.intel',
      'div.splash-stage',
      'div.search-wrap',
      'div.legend',
      'footer.footer',
    ])
    expect(wrapper.find('.error-banner span').text()).toBe('Erreur serveur (500) — réessayez.')
    expect(count('GET', '/api/game/daily?category=weapon')).toBe(1) // no refetch
    expect(stats(wrapper)['ESSAIS']).toBe(`0 / ${MAX_GUESSES}`)

    overrides = {}
    await pick(wrapper, 1)
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(stats(wrapper)['ESSAIS']).toBe(`1 / ${MAX_GUESSES}`)
  })

  it('DEC-010: the category/mode switches are disabled only while a guess is in flight', async () => {
    const wrapper = await mountApp()
    const release = hold('guess')
    wrapper.findComponent(SearchBox).vm.$emit('pick', 1)
    await settle()
    for (const label of ['ARMES', 'ARMURES', 'QUOTIDIEN', 'LIBRE']) {
      expect(switchButton(wrapper, label).attributes('disabled'), label).toBeDefined()
    }
    expect(switchButton(wrapper, 'FR').attributes('disabled')).toBeUndefined()
    expect(switchButton(wrapper, 'EN').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.search-wrap').exists()).toBe(true) // loading is false
    expect(wrapper.find('.loading').exists()).toBe(false)
    expect(stats(wrapper)['ESSAIS']).toBe(`0 / ${MAX_GUESSES}`)

    // A click on a disabled switch does not reach the composable.
    await switchButton(wrapper, 'ARMURES').trigger('click')
    await settle()
    expect(count('GET', '/api/items?category=armor')).toBe(0)

    release()
    await settle()
    for (const label of ['ARMES', 'ARMURES', 'QUOTIDIEN', 'LIBRE', 'FR', 'EN']) {
      expect(switchButton(wrapper, label).attributes('disabled'), label).toBeUndefined()
    }
    expect(stats(wrapper)['ESSAIS']).toBe(`1 / ${MAX_GUESSES}`)
  })

  it('DEC-010: free mode hides DÉFI/SÉRIE, NEW GAME is enabled once won, busy while the next puzzle loads', async () => {
    const wrapper = await mountApp()
    await switchButton(wrapper, 'LIBRE').trigger('click')
    await settle()
    expect(count('POST', '/api/game/free')).toBe(1)
    expect(switchButton(wrapper, 'LIBRE').classes('on')).toBe(true)
    let s = stats(wrapper)
    expect(s['MODE']).toBe('LIBRE')
    expect(s['DÉFI']).toBeUndefined()
    expect(s['SÉRIE']).toBeUndefined()
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-free-1&level=0')

    await pick(wrapper, 1)
    await pick(wrapper, TARGET_ID)
    const button = wrapper.find('.win-panel .win-actions button.btn.primary')
    expect(button.text()).toBe('NOUVELLE PARTIE')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(stats(wrapper)['SÉRIE']).toBeUndefined() // free wins never show a streak
    expect(litTicks(wrapper)).toBe(10)

    const release = hold('free')
    await button.trigger('click')
    await settle()
    expect(count('POST', '/api/game/free')).toBe(2)
    expect(wrapper.find('.win-panel .win-actions button.btn.primary').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.intel').exists()).toBe(true) // board kept while loading
    expect(wrapper.find('.loading').exists()).toBe(false)
    expect(wrapper.find('.search-wrap').exists()).toBe(false)
    // Switches are NOT disabled by a load (only by a guess submission).
    expect(switchButton(wrapper, 'ARMES').attributes('disabled')).toBeUndefined()

    release()
    await settle()
    expect(wrapper.find('.win-panel').exists()).toBe(false)
    s = stats(wrapper)
    expect(s['ESSAIS']).toBe(`0 / ${MAX_GUESSES}`)
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-free-2&level=0')
    expect(litTicks(wrapper)).toBe(1)
    expect(wrapper.find('.legend').exists()).toBe(true)
    expect(wrapper.find('.search-wrap').exists()).toBe(true)
  })

  it('DEC-010: a lost free game offers RÉESSAYER, which starts a new free puzzle', async () => {
    const wrapper = await mountApp()
    await switchButton(wrapper, 'LIBRE').trigger('click')
    await settle()
    const wrong = WEAPONS.filter((i) => i.id !== TARGET_ID)
    for (let g = 0; g < MAX_GUESSES; g += 1) await pick(wrapper, wrong[g]!.id)
    expect(count('POST', '/api/game/reveal')).toBe(1)
    const button = wrapper.find('.win-panel.loss .win-actions button.btn.primary')
    expect(button.text()).toBe('RÉESSAYER')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await settle()
    expect(count('POST', '/api/game/free')).toBe(2)
    expect(wrapper.find('.win-panel').exists()).toBe(false)
    expect(stats(wrapper)['ESSAIS']).toBe(`0 / ${MAX_GUESSES}`)
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-free-2&level=0')
  })

  it('switching the category reloads the pool and the daily puzzle of that category', async () => {
    const wrapper = await mountApp()
    await pick(wrapper, 1)
    await switchButton(wrapper, 'ARMURES').trigger('click')
    await settle()
    expect(count('GET', '/api/items?category=armor')).toBe(1)
    expect(count('GET', '/api/game/daily?category=armor')).toBe(1)
    expect(switchButton(wrapper, 'ARMURES').classes('on')).toBe(true)
    const s = stats(wrapper)
    expect(s['POOL']).toBe(String(ARMORS.length))
    expect(s['ESSAIS']).toBe(`0 / ${MAX_GUESSES}`)
    expect(splashSrc(wrapper)).toBe('/api/game/splash?token=tok-daily-armor-2&level=0')
    expect(wrapper.find('.board').exists()).toBe(false)
    expect(wrapper.find('.legend').exists()).toBe(true)

    // Back to weapons: the board with its guess is restored without any POST.
    const posts = count('POST', '/api/game/guess')
    await switchButton(wrapper, 'ARMES').trigger('click')
    await settle()
    expect(count('POST', '/api/game/guess')).toBe(posts)
    expect(stats(wrapper)['ESSAIS']).toBe(`1 / ${MAX_GUESSES}`)
    expect(litTicks(wrapper)).toBe(expectedLevel(1) + 1)
  })
})
