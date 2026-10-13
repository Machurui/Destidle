import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import IntelBar from '../IntelBar.vue'
import { i18n, setLocale } from '@/i18n'
import type { Category, Mode } from '@/lib/api'

interface Props {
  category: Category
  mode: Mode
  guessCount: number
  max: number
  poolSize: number
  dailyNumber?: number
  streak: number
}

const base: Props = { category: 'weapon', mode: 'daily', guessCount: 3, max: 8, poolSize: 142, streak: 0 }

function mountIntel(overrides: Partial<Props> = {}) {
  return mount(IntelBar, { props: { ...base, ...overrides }, global: { plugins: [i18n] } })
}

/** Map of stat label → stat value as rendered. */
function stats(wrapper: ReturnType<typeof mountIntel>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const stat of wrapper.findAll('.stat')) {
    out[stat.find('.stat-k').text()] = stat.find('.stat-v').text()
  }
  return out
}

describe('IntelBar', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('shows the weapon briefing for the weapon category', () => {
    const wrapper = mountIntel({ category: 'weapon' })
    expect(wrapper.find('.intel-tag').text()).toBe('BRIEFING')
    expect(wrapper.find('.intel-text').text()).toBe(
      "Le signal s'affine à chaque erreur. Identifiez l'arme exotique.",
    )
  })

  it('shows the armor briefing for the armor category', () => {
    const wrapper = mountIntel({ category: 'armor' })
    expect(wrapper.find('.intel-text').text()).toBe(
      "Le signal s'affine à chaque erreur. Identifiez l'armure exotique.",
    )
  })

  it('renders guesses, pool and mode counters', () => {
    const s = stats(mountIntel({ guessCount: 3, max: 8, poolSize: 142, mode: 'daily' }))
    expect(s['ESSAIS']).toBe('3 / 8')
    expect(s['POOL']).toBe('142')
    expect(s['MODE']).toBe('QUOTIDIEN')
    expect(stats(mountIntel({ mode: 'free' }))['MODE']).toBe('LIBRE')
  })

  it('shows the puzzle number and the streak in daily mode', () => {
    const wrapper = mountIntel({ mode: 'daily', dailyNumber: 12, streak: 4 })
    const s = stats(wrapper)
    expect(s['DÉFI']).toBe('#12')
    expect(s['SÉRIE']).toBe('4')
    expect(wrapper.findAll('.stat-k').map((k) => k.text())).toEqual([
      'DÉFI',
      'ESSAIS',
      'POOL',
      'MODE',
      'SÉRIE',
    ])
  })

  it('hides both the puzzle number and the streak in free mode', () => {
    const s = stats(mountIntel({ mode: 'free', dailyNumber: 12, streak: 4 }))
    expect(s['DÉFI']).toBeUndefined()
    expect(s['SÉRIE']).toBeUndefined()
    expect(Object.keys(s)).toEqual(['ESSAIS', 'POOL', 'MODE'])
  })

  it('keeps the streak but hides the puzzle number when it is unknown in daily mode', () => {
    const s = stats(mountIntel({ mode: 'daily', streak: 2 }))
    expect(s['DÉFI']).toBeUndefined()
    expect(s['SÉRIE']).toBe('2')
  })

  it('shows the puzzle number even when it is 0 in daily mode', () => {
    expect(stats(mountIntel({ mode: 'daily', dailyNumber: 0 }))['DÉFI']).toBe('#0')
  })

  it('switches labels when the locale changes to en', async () => {
    const wrapper = mountIntel({ mode: 'daily', dailyNumber: 12, streak: 4 })
    setLocale('en')
    await nextTick()
    const s = stats(wrapper)
    expect(s['STREAK']).toBe('4')
    expect(s['PUZZLE']).toBe('#12')
    expect(s['GUESSES']).toBe('3 / 8')
    expect(s['MODE']).toBe('DAILY')
    expect(wrapper.find('.intel-text').text()).toBe(
      'The signal sharpens with each wrong guess. Identify the exotic weapon.',
    )
  })

  it('shows the puzzle number and the archive mode, without the streak, in archive mode', () => {
    const s = stats(mountIntel({ mode: 'archive', dailyNumber: 12, streak: 4 }))
    expect(s['DÉFI']).toBe('#12')
    expect(s['MODE']).toBe('ARCHIVE')
    expect(s['SÉRIE']).toBeUndefined()
  })
})
