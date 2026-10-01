/**
 * QA TASK-016 (devflow-qa) — the TASK-016 components through the REAL shell:
 * `App.vue` + real `SearchBox` / `GuessBoard` / `GuessRow` / `WinPanel` /
 * `LosePanel` + real `useGame` / `useLocalState` / `api`; only the global
 * `fetch` (and `navigator.clipboard`, absent from jsdom) are simulated.
 *
 * Locks at shell level what the component specs can only emulate with a host:
 * - DEC-013 flip: App mounts `GuessBoard` behind `v-if="guesses.length > 0"`
 *   (no key), so the first guess, every next guess and the final winning or
 *   losing guess flip their row, while a reloaded board or a tab switch back
 *   renders static rows;
 * - REQ-016 share text built from the daily number the shell passes down,
 *   never with the target name;
 * - REQ-014 keyboard path: Enter sends exactly one guess, Escape then Enter
 *   sends none, a played item is no longer offered.
 * Guesses are typed in the real SearchBox input and validated with Enter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '@/App.vue'
import { i18n, setLocale } from '@/i18n'
import { MAX_GUESSES } from '@/composables/useGame'
import type { Feedback, ItemDisplay, ItemSummary } from '@/lib/api'

// ---------------------------------------------------------------- fixtures

const TARGET_ID = 3
const NUMBER = 78

function summary(id: number): ItemSummary {
  return { id, nameEn: `Item ${id}`, nameFr: `Objet ${id}`, game: 'D2', typeEn: 'Hand Cannon', typeFr: 'Revolver', iconUrl: '' }
}

/** Ids 1..12: « Objet 3 » is the target, « Objet 1x » never collides with a one-digit query thanks to the order. */
const WEAPONS: ItemSummary[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map(summary)

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
    lightGgUrl: `https://www.light.gg/db/items/${id}/`,
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

// ------------------------------------------------------- simulated API

let calls: { method: string; url: string }[] = []
let freeIssued = 0

function route(method: string, url: string, body: unknown): { status: number; body: unknown } {
  const u = new URL(url, 'http://localhost')
  const category = u.searchParams.get('category')
  if (method === 'GET' && u.pathname === '/api/items') return { status: 200, body: category === 'armor' ? [] : WEAPONS }
  if (method === 'GET' && u.pathname === '/api/game/daily') {
    return { status: 200, body: { puzzleToken: `tok-daily-${category}`, date: '2026-10-01', number: NUMBER } }
  }
  if (method === 'POST' && u.pathname === '/api/game/free') {
    freeIssued += 1
    return { status: 200, body: { puzzleToken: `tok-free-${freeIssued}` } }
  }
  if (method === 'POST' && u.pathname === '/api/game/guess') {
    const { itemId } = body as { itemId: number }
    const correct = itemId === TARGET_ID
    return { status: 200, body: { correct, guess: display(itemId), feedback: feedback(correct) } }
  }
  if (method === 'POST' && u.pathname === '/api/game/reveal') return { status: 200, body: { item: display(TARGET_ID) } }
  return { status: 404, body: { status: 404, detail: 'route inconnue' } }
}

const fetchStub = vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
  const method = init?.method ?? 'GET'
  const url = String(input)
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
  calls.push({ method, url })
  const r = route(method, url, body)
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
})

const count = (method: string, path: string) => calls.filter((c) => c.method === method && c.url.startsWith(path)).length

let clipboardWrites: string[] = []

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

function switchButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('.topbar .mode-switch button').find((b) => b.text() === text)
  expect(button, `switch "${text}"`).toBeDefined()
  return button!
}

/** Types the French name in the real SearchBox and validates the first (active) row with Enter. */
async function guess(wrapper: VueWrapper, id: number) {
  const input = wrapper.find('.search-wrap input')
  await input.setValue(`Objet ${id}`)
  const first = wrapper.find('.search-wrap .dd-item.active')
  expect(first.attributes('id')).toMatch(new RegExp(`-opt-${id}$`))
  await input.trigger('keydown', { key: 'Enter' })
  await settle()
}

/** Number of flipping cells per board row, top (latest) row first. */
function reveals(wrapper: VueWrapper): number[] {
  return wrapper.findAll('.board > .guess-row:not(.header-row)').map((r) => r.findAll('.cell.reveal').length)
}

/** `animation-delay` of the feedback cells of the top row. */
function topDelays(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('.board > .guess-row:not(.header-row)')[0]!
    .findAll('.cell:not(.name-cell)')
    .map((c) => (c.element as HTMLElement).style.animationDelay)
}

const FLIP_DELAYS = ['0ms', '110ms', '220ms', '330ms', '440ms', '550ms']

// ------------------------------------------------------------------- tests

describe('TASK-016 components × real shell (QA TASK-016)', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
    calls = []
    freeIssued = 0
    clipboardWrites = []
    fetchStub.mockClear()
    vi.stubGlobal('fetch', fetchStub)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText: async (text: string) => void clipboardWrites.push(text) },
    })
  })

  afterEach(() => {
    for (const wrapper of mounted) wrapper.unmount()
    mounted = []
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('flips the first guess, each next guess and the winning guess; a reload renders a static board', async () => {
    const wrapper = await mountApp()
    await guess(wrapper, 1)
    expect(reveals(wrapper)).toEqual([6])
    expect(topDelays(wrapper)).toEqual(FLIP_DELAYS)
    await guess(wrapper, 2)
    expect(reveals(wrapper)).toEqual([6, 0])
    await guess(wrapper, TARGET_ID)
    expect(wrapper.find('.win-panel').exists()).toBe(true)
    expect(reveals(wrapper)).toEqual([6, 0, 0])
    expect(topDelays(wrapper)).toEqual(FLIP_DELAYS)

    const reloaded = await mountApp()
    expect(reloaded.find('.win-panel').exists()).toBe(true)
    expect(reveals(reloaded)).toEqual([0, 0, 0])
    expect(count('POST', '/api/game/guess')).toBe(3)
  })

  it('renders a restored board static after a tab switch, then flips the next guess', async () => {
    const wrapper = await mountApp()
    await guess(wrapper, 1)
    await guess(wrapper, 2)
    await switchButton(wrapper, 'ARMURES').trigger('click')
    await settle()
    expect(wrapper.find('.board').exists()).toBe(false)
    await switchButton(wrapper, 'ARMES').trigger('click')
    await settle()
    expect(reveals(wrapper)).toEqual([0, 0])
    await guess(wrapper, 4)
    expect(reveals(wrapper)).toEqual([6, 0, 0])
  })

  it('flips the 8th (losing) guess after the reveal commit and shows RETRY with the revealed target in free mode', async () => {
    const wrapper = await mountApp()
    await switchButton(wrapper, 'LIBRE').trigger('click')
    await settle()
    const wrong = [1, 2, 4, 5, 6, 7, 8, 9]
    for (const id of wrong) await guess(wrapper, id)
    expect(count('POST', '/api/game/reveal')).toBe(1)
    const panel = wrapper.find('.win-panel.loss')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.win-target').text()).toBe(`Objet ${TARGET_ID}`)
    expect(panel.findAll('button').map((b) => b.text())).toEqual(['RÉESSAYER'])
    expect(reveals(wrapper)).toEqual([6, 0, 0, 0, 0, 0, 0, 0])
    expect(topDelays(wrapper)).toEqual(FLIP_DELAYS)

    const reloaded = await mountApp()
    await switchButton(reloaded, 'LIBRE').trigger('click')
    await settle()
    expect(reloaded.find('.win-panel.loss').exists()).toBe(true)
    expect(reveals(reloaded)).toEqual(Array(MAX_GUESSES).fill(0))
  })

  it('copies the daily result with the number from the API and without the target name', async () => {
    const wrapper = await mountApp()
    for (const id of [1, 2, TARGET_ID]) await guess(wrapper, id)
    await wrapper.find('.win-panel .win-actions button.btn').trigger('click')
    await settle()
    expect(clipboardWrites).toEqual([`DESTIDLE #${NUMBER} — ARMES\nTrouvé en 3 essais\n▰▰▰▱▱▱▱▱`])
    expect(clipboardWrites[0]).not.toContain(`Objet ${TARGET_ID}`)
    expect(clipboardWrites[0]).not.toContain(`Item ${TARGET_ID}`)
    expect(wrapper.find('.win-panel .win-actions button.btn').text()).toBe('COPIÉ !')
  })

  it('copies a free-play result with the free header and the singular form', async () => {
    const wrapper = await mountApp()
    await switchButton(wrapper, 'LIBRE').trigger('click')
    await settle()
    await guess(wrapper, TARGET_ID)
    await wrapper.find('.win-panel .win-actions button.btn:not(.primary)').trigger('click')
    await settle()
    expect(clipboardWrites).toEqual(['DESTIDLE — Partie libre (ARMES)\nTrouvé en 1 essai\n▰▱▱▱▱▱▱▱'])
    expect(wrapper.find('.win-panel .win-actions button.btn.primary').text()).toBe('NOUVELLE PARTIE')
  })

  it('sends one guess per Enter, none after Escape then Enter, and no longer offers a played item', async () => {
    const wrapper = await mountApp()
    await guess(wrapper, 1)
    expect(count('POST', '/api/game/guess')).toBe(1)

    const input = wrapper.find('.search-wrap input')
    await input.setValue('Objet 2')
    await input.trigger('keydown', { key: 'Escape' })
    await input.trigger('keydown', { key: 'Enter' })
    await settle()
    expect(count('POST', '/api/game/guess')).toBe(1)
    expect(wrapper.find('.search-wrap .dropdown').exists()).toBe(true)

    await input.setValue('Objet')
    const offered = wrapper.findAll('.search-wrap .dd-item').map((r) => r.attributes('id')!.split('-opt-')[1])
    expect(offered).not.toContain('1')
    expect(offered).toHaveLength(8)
  })
})
