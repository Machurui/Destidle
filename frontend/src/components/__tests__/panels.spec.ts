import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WinPanel from '../WinPanel.vue'
import LosePanel from '../LosePanel.vue'
import { i18n, setLocale } from '../../i18n'
import type { ItemDisplay } from '../../lib/api'

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
