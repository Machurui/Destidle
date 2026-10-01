import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import Legend from '../Legend.vue'
import { i18n, setLocale } from '@/i18n'

function mountLegend() {
  return mount(Legend, { global: { plugins: [i18n] } })
}

describe('Legend', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders the French title and the five rows', () => {
    const wrapper = mountLegend()
    expect(wrapper.find('.legend > .legend-title').text()).toBe('// LÉGENDE')
    const rows = wrapper.findAll('.legend-row')
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.text())).toEqual([
      'Correspondance exacte',
      'Proche (saison ±2)',
      'Différent',
      '▲La cible est plus récente',
      '▼La cible est plus ancienne',
    ])
  })

  it('renders the hit / near / miss swatches and the season arrows', () => {
    const wrapper = mountLegend()
    expect(wrapper.find('.legend-row > .sw.hit').exists()).toBe(true)
    expect(wrapper.find('.legend-row > .sw.near').exists()).toBe(true)
    expect(wrapper.find('.legend-row > .sw.miss').exists()).toBe(true)
    const arrows = wrapper.findAll('.legend-row > .ar')
    expect(arrows.map((a) => a.text())).toEqual(['▲', '▼'])
  })

  it('switches to the English labels', async () => {
    const wrapper = mountLegend()
    setLocale('en')
    await nextTick()
    expect(wrapper.find('.legend-title').text()).toBe('// LEGEND')
    expect(wrapper.findAll('.legend-row').map((r) => r.text())).toEqual([
      'Exact match',
      'Close (season ±2)',
      'Different',
      '▲Target season is later',
      '▼Target season is earlier',
    ])
  })
})
