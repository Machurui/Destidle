import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '@/App.vue'
import { i18n, setLocale } from '@/i18n'
import { useGame } from '@/composables/useGame'
import type { UseGame } from '@/composables/useGame'
import type { StoredBoard } from '@/composables/useLocalState'
import { ApiError } from '@/lib/api'
import type { Category, DailyInfo, GuessResult, ItemDisplay, ItemSummary, Mode } from '@/lib/api'

/**
 * `useGame` is replaced by a hand-made state holder so each test can set the
 * screen state directly. Only the derived values (`status`, `guesses`, …)
 * reproduce the composable's formulas, on top of the real `MAX_GUESSES` /
 * `MAX_SPLASH_LEVEL` constants; every action is a spy that resolves.
 */
vi.mock('@/composables/useGame', async () => {
  const { computed, ref, shallowRef } = await import('vue')
  const { api } = await import('@/lib/api')
  const { MAX_GUESSES, MAX_SPLASH_LEVEL } =
    await vi.importActual<typeof import('@/composables/useGame')>('@/composables/useGame')

  const category = ref<Category>('weapon')
  const mode = ref<Mode>('daily')
  const items = shallowRef<ItemSummary[]>([])
  const board = ref<StoredBoard | null>(null)
  const daily = ref<DailyInfo | null>(null)
  const error = shallowRef<ApiError | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const streak = ref(0)

  const status = computed(() => board.value?.status ?? 'playing')
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

  const fake: UseGame = {
    category,
    mode,
    items,
    board,
    daily,
    error,
    loading,
    submitting,
    streak,
    status,
    guesses,
    usedIds,
    poolSize,
    splashLevel,
    splashSrc,
    init: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
    setCategory: vi.fn((_c: Category) => Promise.resolve()),
    setMode: vi.fn((_m: Mode) => Promise.resolve()),
    submitGuess: vi.fn((_id: number) => Promise.resolve()),
    newFree: vi.fn(() => Promise.resolve()),
    MAX_GUESSES,
  }
  return { useGame: () => fake, MAX_GUESSES, MAX_SPLASH_LEVEL }
})

const game = useGame()

// ---------------------------------------------------------------- fixtures

const target: ItemDisplay = {
  id: 1,
  nameEn: 'Sunshot',
  nameFr: 'Soleil de plomb',
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

function summary(id: number): ItemSummary {
  return {
    id,
    nameEn: `Item ${id}`,
    nameFr: `Objet ${id}`,
    game: 'D2',
    typeEn: 'Hand Cannon',
    typeFr: 'Revolver',
    iconUrl: `/icons/${id}.png`,
  }
}

function guess(id: number, correct = false): GuessResult {
  return {
    correct,
    guess: { ...target, id, nameEn: `Item ${id}`, nameFr: `Objet ${id}` },
    feedback: {
      rarity: 'hit',
      season: { kind: correct ? 'hit' : 'near', dir: correct ? 0 : 1 },
      slot: correct ? 'hit' : 'miss',
      type: correct ? 'hit' : 'miss',
      element: 'hit',
      class: null,
      game: 'hit',
    },
  }
}

/** `n` wrong guesses (ids 100..); when `correct` the last one is the hit. */
function guesses(n: number, correct = false): GuessResult[] {
  return Array.from({ length: n }, (_, i) => guess(100 + i, correct && i === n - 1))
}

function board(overrides: Partial<StoredBoard> = {}): StoredBoard {
  return { token: 'tok-1', guesses: [], status: 'playing', ...overrides }
}

const DAILY: DailyInfo = { puzzleToken: 'tok-daily', date: '2026-10-01', number: 12 }

// ----------------------------------------------------------------- helpers

/** Wrappers mounted by the current test, unmounted after it. */
let mounted: VueWrapper[] = []

function mountApp() {
  const wrapper = mount(App, { global: { plugins: [i18n] } })
  mounted.push(wrapper)
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

/** Top bar switch button by its label (ARMES, LIBRE, FR, …). */
function switchButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('.topbar .mode-switch button').find((b) => b.text() === text)
  expect(button, `switch "${text}"`).toBeDefined()
  return button!
}

function resetGame() {
  game.category.value = 'weapon'
  game.mode.value = 'daily'
  game.items.value = []
  game.board.value = null
  game.daily.value = null
  game.error.value = null
  game.loading.value = false
  game.submitting.value = false
  game.streak.value = 0
  for (const fn of [game.init, game.retry, game.setCategory, game.setMode, game.submitGuess, game.newFree]) {
    vi.mocked(fn).mockClear()
  }
}

// ------------------------------------------------------------------- tests

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
    resetGame()
  })

  afterEach(() => {
    for (const wrapper of mounted) wrapper.unmount()
    mounted = []
  })

  it('calls init once on mount and always renders the top bar and the footer', () => {
    const wrapper = mountApp()
    expect(game.init).toHaveBeenCalledTimes(1)
    expect(wrapper.find('header.topbar').exists()).toBe(true)
    expect(wrapper.find('footer.footer').exists()).toBe(true)
    expect(wrapper.find('.app > header.topbar').exists()).toBe(true)
    expect(wrapper.find('.app > footer.footer').exists()).toBe(true)
  })

  it('renders the brand name', () => {
    expect(mountApp().find('.brand-name').text()).toContain('DESTIDLE')
  })

  it('shows only the loading placeholder while the first puzzle loads', () => {
    game.loading.value = true
    const wrapper = mountApp()
    expect(wrapper.find('.loading').text()).toBe('Chargement…')
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(wrapper.find('.intel').exists()).toBe(false)
    expect(wrapper.find('.splash-stage').exists()).toBe(false)
  })

  describe('error banner (REQ-015)', () => {
    it('shows the network message with a RETRY button that calls retry()', async () => {
      game.error.value = new ApiError(0)
      const wrapper = mountApp()
      const banner = wrapper.find('.error-banner')
      expect(banner.exists()).toBe(true)
      expect(banner.find('span').text()).toBe('API injoignable — le serveur tourne ?')
      const retry = banner.find('button.btn')
      expect(retry.text()).toBe('RÉESSAYER')
      expect(retry.attributes('type')).toBe('button')
      expect(wrapper.find('.intel').exists()).toBe(false)
      expect(wrapper.find('.loading').exists()).toBe(false)

      await retry.trigger('click')
      expect(game.retry).toHaveBeenCalledTimes(1)
      expect(game.init).toHaveBeenCalledTimes(1)
    })

    it('shows the HTTP status for a server error, in both locales', async () => {
      game.error.value = new ApiError(500)
      const wrapper = mountApp()
      expect(wrapper.find('.error-banner span').text()).toBe('Erreur serveur (500) — réessayez.')
      setLocale('en')
      await nextTick()
      expect(wrapper.find('.error-banner span').text()).toBe('Server error (500) — try again.')
      expect(wrapper.find('.error-banner button.btn').text()).toBe('RETRY')
    })

    it('keeps the game content visible under the banner when a board is displayed', () => {
      game.error.value = new ApiError(503)
      game.board.value = board()
      const wrapper = mountApp()
      expect(wrapper.find('.error-banner span').text()).toBe('Erreur serveur (503) — réessayez.')
      expect(wrapper.find('.intel').exists()).toBe(true)
      expect(wrapper.find('.splash-stage').exists()).toBe(true)
      expect(wrapper.find('.loading').exists()).toBe(false)
    })
  })

  describe('game content (REQ-010 / REQ-012)', () => {
    it('renders intel, splash, search box and legend for a blank daily board', () => {
      game.board.value = board({ token: 'tok-daily', date: DAILY.date, number: DAILY.number })
      game.items.value = [summary(1), summary(2), summary(3)]
      game.daily.value = DAILY
      game.streak.value = 4
      const wrapper = mountApp()

      const s = stats(wrapper)
      expect(s['POOL']).toBe('3')
      expect(s['ESSAIS']).toBe('0 / 8')
      expect(s['DÉFI']).toBe('#12')
      expect(s['SÉRIE']).toBe('4')
      expect(s['MODE']).toBe('QUOTIDIEN')

      expect(wrapper.find('.splash-stage').exists()).toBe(true)
      const img = wrapper.find('img.splash-canvas')
      expect(img.exists()).toBe(true)
      expect(img.attributes('src')).toBe(game.splashSrc.value)
      expect(img.attributes('src')).toBe('/api/game/splash?token=tok-daily&level=0')
      expect(wrapper.findAll('.bar-tick.on')).toHaveLength(1)
      expect(wrapper.find('.splash-frame').classes('revealed')).toBe(false)

      expect(wrapper.find('.search-wrap').exists()).toBe(true)
      expect(wrapper.find('.legend').exists()).toBe(true)
      expect(wrapper.find('.board').exists()).toBe(false)
      expect(wrapper.find('.win-panel').exists()).toBe(false)
      expect(wrapper.find('.loading').exists()).toBe(false)
      expect(wrapper.find('.error-banner').exists()).toBe(false)
    })

    it('hides the streak and the puzzle number in free mode', () => {
      game.mode.value = 'free'
      game.board.value = board()
      game.streak.value = 4
      const wrapper = mountApp()
      const s = stats(wrapper)
      expect(s['SÉRIE']).toBeUndefined()
      expect(s['DÉFI']).toBeUndefined()
      expect(s['MODE']).toBe('LIBRE')
    })

    it('shows the board instead of the legend once there are guesses and sharpens the signal', () => {
      game.board.value = board({ guesses: guesses(2) })
      const wrapper = mountApp()
      expect(wrapper.find('.board').exists()).toBe(true)
      expect(wrapper.find('.legend').exists()).toBe(false)
      expect(wrapper.find('.search-wrap').exists()).toBe(true)
      expect(stats(wrapper)['ESSAIS']).toBe('2 / 8')
      // floor(2 / 8 * 9) = 2 → ticks 0..2 lit, level 2 requested.
      expect(wrapper.findAll('.bar-tick.on')).toHaveLength(3)
      expect(wrapper.find('img.splash-canvas').attributes('src')).toBe('/api/game/splash?token=tok-1&level=2')
    })
  })

  describe('won board', () => {
    it('shows the win panel with an enabled NEW GAME button in free mode that calls newFree()', async () => {
      game.mode.value = 'free'
      game.board.value = board({ guesses: guesses(3, true), status: 'won' })
      const wrapper = mountApp()

      const panel = wrapper.find('.win-panel')
      expect(panel.exists()).toBe(true)
      expect(panel.classes('loss')).toBe(false)
      const button = panel.find('.win-actions button.btn.primary')
      expect(button.text()).toBe('NOUVELLE PARTIE')
      expect(button.attributes('disabled')).toBeUndefined()
      expect(wrapper.find('.search-wrap').exists()).toBe(false)
      expect(wrapper.find('.legend').exists()).toBe(false)
      expect(wrapper.find('.board').exists()).toBe(true)
      expect(wrapper.find('.splash-frame.revealed').exists()).toBe(true)
      expect(wrapper.findAll('.bar-tick.on')).toHaveLength(10)

      await button.trigger('click')
      expect(game.newFree).toHaveBeenCalledTimes(1)
    })

    it('shows the win panel without a new-game button in daily mode', () => {
      game.board.value = board({ guesses: guesses(1, true), status: 'won', date: DAILY.date, number: 12 })
      game.daily.value = DAILY
      const wrapper = mountApp()
      expect(wrapper.find('.win-panel').exists()).toBe(true)
      expect(wrapper.find('.win-actions button.btn.primary').exists()).toBe(false)
      expect(wrapper.find('.search-wrap').exists()).toBe(false)
    })
  })

  describe('lost board', () => {
    it('shows the lose panel with its target and a RETRY button that calls newFree() in free mode', async () => {
      game.mode.value = 'free'
      game.board.value = board({ guesses: guesses(8), status: 'lost', revealed: target })
      const wrapper = mountApp()

      const panel = wrapper.find('.win-panel.loss')
      expect(panel.exists()).toBe(true)
      const button = panel.find('.win-actions button')
      expect(button.text()).toBe('RÉESSAYER')
      expect(button.attributes('disabled')).toBeUndefined()
      expect(wrapper.find('.search-wrap').exists()).toBe(false)
      expect(wrapper.find('.legend').exists()).toBe(false)
      expect(wrapper.find('.board').exists()).toBe(true)
      expect(wrapper.find('.splash-frame.revealed').exists()).toBe(true)

      await button.trigger('click')
      expect(game.newFree).toHaveBeenCalledTimes(1)
    })

    it('shows no lose panel while a lost board has no revealed target yet', () => {
      game.mode.value = 'free'
      game.board.value = board({ guesses: guesses(8), status: 'lost' })
      const wrapper = mountApp()
      expect(wrapper.find('.win-panel.loss').exists()).toBe(false)
      expect(wrapper.find('.win-panel').exists()).toBe(false)
      expect(wrapper.find('.board').exists()).toBe(true)
      expect(wrapper.find('.search-wrap').exists()).toBe(false)
      expect(wrapper.find('.legend').exists()).toBe(false)
    })
  })

  describe('end-of-game layout', () => {
    it.each([
      ['won', () => board({ guesses: guesses(3, true), status: 'won' })],
      ['lost', () => board({ guesses: guesses(8), status: 'lost', revealed: target })],
    ])('shows the answer between the splash and the board when %s', (_, endBoard) => {
      game.mode.value = 'free'
      game.board.value = endBoard()
      const wrapper = mountApp()

      const splash = wrapper.find('.splash-stage').element
      const panel = wrapper.find('.win-panel').element
      const guessBoard = wrapper.find('.board').element
      expect(splash.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(panel.compareDocumentPosition(guessBoard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  describe('busy states (DEC-010)', () => {
    it('disables the category/mode switches while submitting, never the locale switch', async () => {
      game.board.value = board()
      game.submitting.value = true
      const wrapper = mountApp()
      for (const label of ['ARMES', 'ARMURES', 'QUOTIDIEN', 'LIBRE']) {
        expect(switchButton(wrapper, label).attributes('disabled'), label).toBeDefined()
      }
      expect(switchButton(wrapper, 'FR').attributes('disabled')).toBeUndefined()
      expect(switchButton(wrapper, 'EN').attributes('disabled')).toBeUndefined()

      game.submitting.value = false
      await nextTick()
      for (const label of ['ARMES', 'ARMURES', 'QUOTIDIEN', 'LIBRE', 'FR', 'EN']) {
        expect(switchButton(wrapper, label).attributes('disabled'), label).toBeUndefined()
      }
    })

    it('does not disable the switches while a puzzle is only loading', () => {
      game.board.value = board()
      game.loading.value = true
      const wrapper = mountApp()
      for (const label of ['ARMES', 'ARMURES', 'QUOTIDIEN', 'LIBRE', 'FR', 'EN']) {
        expect(switchButton(wrapper, label).attributes('disabled'), label).toBeUndefined()
      }
    })

    it('disables the NEW GAME button while submitting', () => {
      game.mode.value = 'free'
      game.board.value = board({ guesses: guesses(3, true), status: 'won' })
      game.submitting.value = true
      const wrapper = mountApp()
      const button = wrapper.find('.win-panel .win-actions button.btn.primary')
      expect(button.text()).toBe('NOUVELLE PARTIE')
      expect(button.attributes('disabled')).toBeDefined()
    })

    it('keeps the current board displayed while the same context reloads', () => {
      game.board.value = board({ guesses: guesses(2) })
      game.loading.value = true
      const wrapper = mountApp()
      expect(wrapper.find('.intel').exists()).toBe(true)
      expect(wrapper.find('.splash-stage').exists()).toBe(true)
      expect(wrapper.find('.board').exists()).toBe(true)
      expect(wrapper.find('.loading').exists()).toBe(false)
      expect(wrapper.find('.search-wrap').exists()).toBe(false)
    })

    it('disables the NEW GAME button while a new free puzzle loads', () => {
      game.mode.value = 'free'
      game.board.value = board({ guesses: guesses(3, true), status: 'won' })
      game.loading.value = true
      const wrapper = mountApp()
      expect(wrapper.find('.intel').exists()).toBe(true)
      expect(wrapper.find('.loading').exists()).toBe(false)
      const button = wrapper.find('.win-panel .win-actions button.btn.primary')
      expect(button.text()).toBe('NOUVELLE PARTIE')
      expect(button.attributes('disabled')).toBeDefined()
    })
  })

  describe('top bar actions', () => {
    it('forwards the category switch to setCategory', async () => {
      const wrapper = mountApp()
      await switchButton(wrapper, 'ARMURES').trigger('click')
      expect(game.setCategory).toHaveBeenCalledTimes(1)
      expect(game.setCategory).toHaveBeenCalledWith('armor')
      expect(game.setMode).not.toHaveBeenCalled()
    })

    it('forwards the mode switch to setMode', async () => {
      const wrapper = mountApp()
      await switchButton(wrapper, 'LIBRE').trigger('click')
      expect(game.setMode).toHaveBeenCalledTimes(1)
      expect(game.setMode).toHaveBeenCalledWith('free')
      expect(game.setCategory).not.toHaveBeenCalled()
    })

    it('reflects the current category and mode on the switches', () => {
      game.category.value = 'armor'
      game.mode.value = 'free'
      const wrapper = mountApp()
      expect(switchButton(wrapper, 'ARMURES').classes('on')).toBe(true)
      expect(switchButton(wrapper, 'ARMES').classes('on')).toBe(false)
      expect(switchButton(wrapper, 'LIBRE').classes('on')).toBe(true)
      expect(switchButton(wrapper, 'QUOTIDIEN').classes('on')).toBe(false)
    })
  })
})
