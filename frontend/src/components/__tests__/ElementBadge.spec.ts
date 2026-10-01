import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementBadge from '../ElementBadge.vue'
import { i18n, setLocale } from '@/i18n'

function mountBadge(props: { element: string | null; label: string | null }) {
  return mount(ElementBadge, { props, global: { plugins: [i18n] } })
}

describe('ElementBadge', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders the Solar glyph, colour and label', () => {
    const wrapper = mountBadge({ element: 'Solar', label: 'Solaire' })
    const badge = wrapper.find('.el-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.find('.el-glyph').text()).toBe('☼')
    expect(badge.find('.el-name').text()).toBe('Solaire')
    // jsdom normalises hex colours to rgb()
    expect((badge.element as HTMLElement).style.color).toBe('rgb(255, 179, 71)')
  })

  it('falls back to a neutral glyph and colour for an unknown element', () => {
    const wrapper = mountBadge({ element: 'Foo', label: 'Foo' })
    const badge = wrapper.find('.el-badge')
    expect(badge.find('.el-glyph').text()).toBe('·')
    expect((badge.element as HTMLElement).style.color).toBe('rgb(187, 187, 187)')
  })

  it('renders an em dash and no badge when the element is null', () => {
    const wrapper = mountBadge({ element: null, label: null })
    expect(wrapper.find('.el-badge').exists()).toBe(false)
    expect(wrapper.text()).toBe('—')
  })
})
