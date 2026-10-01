import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import FooterBar from '../FooterBar.vue'
import { i18n, setLocale } from '@/i18n'

function mountFooter() {
  return mount(FooterBar, { global: { plugins: [i18n] } })
}

describe('FooterBar', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders the two French footer lines', () => {
    const spans = mountFooter().findAll('footer.footer > span')
    expect(spans).toHaveLength(2)
    expect(spans.map((s) => s.text())).toEqual([
      'Données : exotiques Destiny 1 & 2 — API Bungie',
      'Fait pour les Gardiens',
    ])
  })

  it('switches to the English footer lines', async () => {
    const wrapper = mountFooter()
    setLocale('en')
    await nextTick()
    expect(wrapper.findAll('footer.footer > span').map((s) => s.text())).toEqual([
      'Data: Destiny 1 & 2 exotics — Bungie API',
      'Built for Guardians',
    ])
  })
})
