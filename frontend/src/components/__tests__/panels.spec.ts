import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import WinPanel from '../WinPanel.vue'
import LosePanel from '../LosePanel.vue'
import { i18n, setLocale } from '../../i18n'
import type { Category, ItemDisplay, Mode } from '../../lib/api'

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

const global = { plugins: [i18n] }

// Every wrapper of this file is unmounted after its test: no "copied" timer
// (2 s) outlives the test that started it.
enableAutoUnmount(afterEach)

describe('WinPanel / LosePanel stubs (new-game entry point)', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('WinPanel hides the new-game button in daily mode', () => {
    const w = mount(WinPanel, { props: { target, guessCount: 3, mode: 'daily', category: 'weapon' }, global })
    expect(w.find('.win-title').text()).toBe('// CIBLE ACQUISE')
    expect(w.find('.win-actions button.btn.primary').exists()).toBe(false)
  })

  it('WinPanel emits new-game in free mode and is disabled while busy', async () => {
    const w = mount(WinPanel, { props: { target, guessCount: 3, mode: 'free', category: 'weapon' }, global })
    const btn = w.find('.win-actions button.btn.primary')
    expect(btn.attributes('type')).toBe('button')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(w.emitted('new-game')).toHaveLength(1)

    await w.setProps({ busy: true })
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(w.emitted('new-game')).toHaveLength(1)
  })

  it('LosePanel hides the retry button in daily mode', () => {
    const w = mount(LosePanel, { props: { target, mode: 'daily' }, global })
    expect(w.classes()).toContain('loss')
    expect(w.find('.win-title').text()).toBe('// CIBLE ÉCHAPPÉE')
    expect(w.find('.win-actions button.btn.primary').exists()).toBe(false)
  })

  it('LosePanel emits new-game in free mode and is disabled while busy', async () => {
    const w = mount(LosePanel, { props: { target, mode: 'free', busy: true }, global })
    const btn = w.find('.win-actions button.btn.primary')
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(w.emitted('new-game')).toBeUndefined()

    await w.setProps({ busy: false })
    await btn.trigger('click')
    expect(w.emitted('new-game')).toHaveLength(1)
  })
})

// ------------------------------------------------- TASK-016 full panels

const armorTarget: ItemDisplay = {
  id: 7,
  nameEn: 'Celestial Nighthawk',
  nameFr: 'Faucon céleste',
  game: 'D2',
  rarityEn: 'Exotic',
  rarityFr: 'Exotique',
  seasonEn: 'Season 2',
  seasonFr: 'Saison 2',
  slotEn: null,
  slotFr: null,
  typeEn: 'Helmet',
  typeFr: 'Casque',
  element: null,
  elementEn: null,
  elementFr: null,
  classEn: 'Hunter',
  classFr: 'Chasseur',
  lightGgUrl: null,
}

const LIGHT_GG = 'https://www.light.gg/db/items/123/'

function mountWin(props: {
  target?: ItemDisplay
  guessCount?: number
  mode?: Mode
  category?: Category
  dailyNumber?: number
  busy?: boolean
}) {
  return mount(WinPanel, {
    props: { target, guessCount: 3, mode: 'daily', category: 'weapon', ...props },
    global,
  })
}

function mountLose(props: { target?: ItemDisplay; mode?: Mode; busy?: boolean }) {
  return mount(LosePanel, { props: { target, mode: 'daily', ...props }, global })
}

/** The share button: the only non-primary action of the win panel. */
const copyButton = (w: VueWrapper) => w.find('.win-actions button.btn:not(.primary)')

/** Installs (or removes, with `undefined`) a `navigator.clipboard` stub for one test. */
function stubClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true, writable: true })
}

describe('WinPanel result blocks and line (REQ-012 / REQ-016)', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it.each([
    [3, '▰▰▰▱▱▱▱▱'],
    [8, '▰▰▰▰▰▰▰▰'],
    [1, '▰▱▱▱▱▱▱▱'],
  ])('renders %i guesses as %s', (guessCount, blocks) => {
    expect(mountWin({ guessCount }).find('.win-blocks').text()).toBe(blocks)
  })

  it('pluralizes the solved line in both locales', async () => {
    expect(mountWin({ guessCount: 1 }).find('.win-line').text()).toBe('Trouvé en 1 essai')
    const w = mountWin({ guessCount: 3 })
    expect(w.find('.win-line').text()).toBe('Trouvé en 3 essais')

    setLocale('en')
    await nextTick()
    expect(w.find('.win-line').text()).toBe('Solved in 3 guesses')
  })
})

describe('WinPanel share to clipboard (REQ-016)', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('copies the localized daily result without the target name, then resets the label after 2 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    const w = mountWin({ guessCount: 3, mode: 'daily', category: 'weapon', dailyNumber: 12 })

    const btn = copyButton(w)
    expect(btn.text()).toBe('COPIER LE RÉSULTAT')
    await btn.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('DESTIDLE #12 — ARMES\nTrouvé en 3 essais\n▰▰▰▱▱▱▱▱')
    expect(writeText.mock.calls[0]![0]).not.toContain('Soleil de plomb')
    expect(btn.text()).toBe('COPIÉ !')

    vi.advanceTimersByTime(1999)
    await nextTick()
    expect(btn.text()).toBe('COPIÉ !')
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(btn.text()).toBe('COPIER LE RÉSULTAT')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the pending label reset when the panel is unmounted (copy, unmount, 2 s later: no error)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })
    const errors = vi.spyOn(console, 'error')
    const warnings = vi.spyOn(console, 'warn')
    // Removed through a v-if, as App.vue does when the game is replaced.
    const show = ref(true)
    const host = mount(
      defineComponent({
        setup: () => () =>
          show.value
            ? h(WinPanel, { target, guessCount: 3, mode: 'daily', category: 'weapon', dailyNumber: 12 })
            : null,
      }),
      { global },
    )

    await copyButton(host).trigger('click')
    await flushPromises()
    expect(copyButton(host).text()).toBe('COPIÉ !')
    expect(vi.getTimerCount()).toBe(1)

    show.value = false
    await nextTick()
    expect(host.find('.win-panel').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0) // cleared by onBeforeUnmount
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow()
    await nextTick()
    expect(errors).not.toHaveBeenCalled()
    expect(warnings).not.toHaveBeenCalled()
  })

  it('uses the free-play header in English, and for a daily without a number', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    setLocale('en')

    const free = mountWin({ guessCount: 2, mode: 'free', category: 'weapon' })
    await copyButton(free).trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('DESTIDLE — Free play (WEAPONS)\nSolved in 2 guesses\n▰▰▱▱▱▱▱▱')
    expect(copyButton(free).text()).toBe('COPIED!')

    const daily = mountWin({ guessCount: 2, mode: 'daily', category: 'armor' })
    await copyButton(daily).trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('DESTIDLE — Free play (ARMOR)\nSolved in 2 guesses\n▰▰▱▱▱▱▱▱')
  })

  it('fails silently when the clipboard API is missing', async () => {
    stubClipboard(undefined)
    const w = mountWin({ guessCount: 3 })
    await copyButton(w).trigger('click')
    await flushPromises()
    expect(copyButton(w).text()).toBe('COPIER LE RÉSULTAT')
  })

  it('fails silently when the clipboard write is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    stubClipboard({ writeText })
    const w = mountWin({ guessCount: 3 })
    await copyButton(w).trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copyButton(w).text()).toBe('COPIER LE RÉSULTAT')
  })

  it('exposes a non-submitting copy button and keeps it in daily mode without NEW GAME', () => {
    const daily = mountWin({ mode: 'daily' })
    expect(copyButton(daily).attributes('type')).toBe('button')
    expect(daily.findAll('.win-actions button')).toHaveLength(1)
    expect(daily.find('.win-actions .btn.primary').exists()).toBe(false)

    const free = mountWin({ mode: 'free' })
    const buttons = free.findAll('.win-actions button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.classes()).not.toContain('primary')
    expect(buttons[1]!.classes()).toContain('primary')
    expect(buttons[1]!.attributes('type')).toBe('button')
  })
})

describe('WinPanel / LosePanel target details', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('shows the localized target name in both panels and follows the locale', async () => {
    const win = mountWin({})
    const lose = mountLose({})
    expect(win.find('.win-target').text()).toBe('Soleil de plomb')
    expect(lose.find('.win-target').text()).toBe('Soleil de plomb')

    setLocale('en')
    await nextTick()
    expect(win.find('.win-target').text()).toBe('Sunshot')
    expect(lose.find('.win-target').text()).toBe('Sunshot')
  })

  it.each([
    ['WinPanel', () => mountWin({})],
    ['LosePanel', () => mountLose({})],
  ])('%s meta lists game, type, element badge and season', async (_name, factory) => {
    const w = factory()
    const meta = w.find('.win-meta')
    expect(meta.exists()).toBe(true)
    const spans = meta.findAll(':scope > span:not(.el-badge)').map((s) => s.text())
    expect(spans).toEqual(['D2', '·', 'Revolver', '·', '·', 'Saison 1'])
    expect(meta.find('.el-badge .el-glyph').text()).toBe('☼')
    expect(meta.find('.el-badge .el-name').text()).toBe('Solaire')
    expect(meta.find('a').exists()).toBe(false)

    setLocale('en')
    await nextTick()
    expect(meta.text()).toContain('Hand Cannon')
    expect(meta.text()).toContain('Season 1')
    expect(meta.find('.el-badge .el-name').text()).toBe('Solar')
  })

  it.each([
    ['WinPanel', () => mountWin({ target: armorTarget })],
    ['LosePanel', () => mountLose({ target: armorTarget })],
  ])('%s meta shows the class of an armor piece and no element badge', async (_name, factory) => {
    const w = factory()
    const meta = w.find('.win-meta')
    expect(meta.find('.el-badge').exists()).toBe(false)
    expect(meta.findAll(':scope > span:not(.el-badge)').map((s) => s.text())).toEqual(['D2', '·', 'Casque', '·', 'Chasseur', '·', 'Saison 2'])

    setLocale('en')
    await nextTick()
    expect(meta.text()).toContain('Hunter')
    expect(meta.text()).toContain('Helmet')
  })

  it('LosePanel offers no copy button: RETRY is the only action in free mode, none in daily', () => {
    const free = mountLose({ mode: 'free' })
    const buttons = free.findAll('.win-actions button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.classes()).toContain('primary')
    expect(buttons[0]!.text()).toBe('RÉESSAYER')
    expect(free.find('.win-blocks').exists()).toBe(false)

    expect(mountLose({ mode: 'daily' }).findAll('.win-actions button')).toHaveLength(0)
  })
})

describe('light.gg link (SEC-F8)', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  const panels: [string, (target: ItemDisplay) => VueWrapper][] = [
    ['WinPanel', (t) => mountWin({ target: t })],
    ['LosePanel', (t) => mountLose({ target: t })],
  ]

  it.each(panels)('%s renders a safe external link to the light.gg item page', (_name, factory) => {
    const w = factory({ ...target, lightGgUrl: LIGHT_GG })
    const link = w.find('.win-meta a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe(LIGHT_GG)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.attributes('title')).toBe('En savoir plus sur light.gg')
    expect(link.text()).toBe('light.gg ↗')
  })

  const rejected: (string | null)[] = [
    null,
    'javascript:alert(1)',
    'http://www.light.gg/x',
    'https://www.light.gg.evil.example/',
    'https://light.gg/x',
    'HTTPS://WWW.LIGHT.GG/x',
  ]

  describe.each(panels)('%s renders no link for an untrusted URL', (_name, factory) => {
    it.each(rejected)('%s', (url) => {
      const w = factory({ ...target, lightGgUrl: url })
      expect(w.find('.win-meta a').exists()).toBe(false)
      expect(w.find('a').exists()).toBe(false)
      expect(w.find('.win-meta').text()).not.toContain('light.gg')
    })
  })

  it('rejects a non-string value restored from storage without throwing', () => {
    const w = mountWin({ target: { ...target, lightGgUrl: 42 as unknown as string } })
    expect(w.find('a').exists()).toBe(false)
  })
})

describe('WinPanel / LosePanel in archive mode', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  afterEach(() => {
    stubClipboard(undefined)
  })

  it('WinPanel shares the daily header and offers ← ARCHIVE instead of a new game', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard({ writeText })
    const w = mountWin({ mode: 'archive', dailyNumber: 12, guessCount: 3 })

    const primary = w.find('.win-actions button.btn.primary')
    expect(primary.text()).toBe('← ARCHIVE')
    await primary.trigger('click')
    expect(w.emitted('back')).toEqual([[]])
    expect(w.emitted('new-game')).toBeUndefined()

    await copyButton(w).trigger('click')
    expect(writeText).toHaveBeenCalledWith('DESTIDLE #12 — ARMES\nTrouvé en 3 essais\n▰▰▰▱▱▱▱▱')
  })

  it('LosePanel offers ← ARCHIVE in archive mode', async () => {
    const w = mountLose({ mode: 'archive' })
    const buttons = w.findAll('.win-actions button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.text()).toBe('← ARCHIVE')
    await buttons[0]!.trigger('click')
    expect(w.emitted('back')).toEqual([[]])
    expect(w.emitted('new-game')).toBeUndefined()
  })

  it('the ← ARCHIVE buttons are disabled while busy', () => {
    expect(mountWin({ mode: 'archive', dailyNumber: 12, busy: true }).find('.btn.primary').attributes('disabled')).toBeDefined()
    expect(mountLose({ mode: 'archive', busy: true }).find('.btn.primary').attributes('disabled')).toBeDefined()
  })

  it('daily mode still has no ← ARCHIVE nor new-game button', () => {
    expect(mountWin({ mode: 'daily', dailyNumber: 12 }).find('.btn.primary').exists()).toBe(false)
    expect(mountLose({ mode: 'daily' }).find('.btn.primary').exists()).toBe(false)
  })
})
