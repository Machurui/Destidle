import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import TopBar from '../TopBar.vue'
import { i18n, setLocale } from '../../i18n'
import type { Category, Mode } from '../../lib/api'

interface Props {
  category?: Category
  mode?: Mode
  disabled?: boolean
}

function mountBar(props: Props = {}) {
  return mount(TopBar, {
    props: { category: 'weapon', mode: 'daily', ...props },
    global: { plugins: [i18n] },
  })
}

/** Switch groups in DOM order: 0 = category, 1 = mode, 2 = locale. */
function switchButtons(wrapper: VueWrapper, group: 0 | 1 | 2) {
  const groups = wrapper.findAll('.mode-switch')
  expect(groups).toHaveLength(3)
  const buttons = groups[group]!.findAll('button')
  // Category and locale: two buttons; mode: daily, free, archive.
  expect(buttons).toHaveLength(group === 1 ? 3 : 2)
  return [buttons[0]!, buttons[1]!, buttons[2]] as const
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('.mode-switch button').find((b) => b.text() === text)
  expect(button, `button "${text}"`).toBeDefined()
  return button!
}

describe('TopBar', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders the brand with the localized subtitle', () => {
    const wrapper = mountBar()
    const mark = wrapper.find('img.brand-mark')
    // Decorative: the same file as the tab icon, hidden from assistive technology (the name follows).
    // The build keeps /favicon.svg; Vitest inlines that public file as a data URI.
    expect(mark.attributes('src')).toMatch(/^(\/favicon\.svg|data:image\/svg\+xml,)/)
    expect(mark.attributes('alt')).toBe('')
    expect(wrapper.find('.brand-name').text()).toBe('destidle')
    expect(wrapper.find('.brand-sub').text()).toBe('// RECON EXOTIQUE')
  })

  it('switches the locale to en when the EN button is clicked', async () => {
    const wrapper = mountBar()
    await buttonByText(wrapper, 'EN').trigger('click')
    expect(i18n.global.locale.value).toBe('en')
    expect(wrapper.find('.brand-sub').text()).toBe('// EXOTIC RECON')
  })

  it('switches back to fr when the FR button is clicked', async () => {
    setLocale('en')
    const wrapper = mountBar()
    await buttonByText(wrapper, 'FR').trigger('click')
    expect(i18n.global.locale.value).toBe('fr')
    expect(wrapper.find('.brand-sub').text()).toBe('// RECON EXOTIQUE')
  })

  it('uses the translated labels for the category and mode switches', () => {
    const wrapper = mountBar()
    const [weapon, armor] = switchButtons(wrapper, 0)
    const [daily, free] = switchButtons(wrapper, 1)
    expect(weapon.text()).toBe(i18n.global.t('categories.weapon'))
    expect(armor.text()).toBe(i18n.global.t('categories.armor'))
    expect(daily.text()).toBe(i18n.global.t('modes.daily'))
    expect(free.text()).toBe(i18n.global.t('modes.free'))
  })

  it('marks the current category, mode and locale with `on` and aria-pressed', () => {
    const wrapper = mountBar({ category: 'armor', mode: 'free' })
    const [weapon, armor] = switchButtons(wrapper, 0)
    const [daily, free] = switchButtons(wrapper, 1)
    const [fr, en] = switchButtons(wrapper, 2)

    expect(armor.classes()).toContain('on')
    expect(weapon.classes()).not.toContain('on')
    expect(free.classes()).toContain('on')
    expect(daily.classes()).not.toContain('on')
    expect(fr.classes()).toContain('on')
    expect(en.classes()).not.toContain('on')

    expect(armor.attributes('aria-pressed')).toBe('true')
    expect(weapon.attributes('aria-pressed')).toBe('false')
    expect(free.attributes('aria-pressed')).toBe('true')
    expect(daily.attributes('aria-pressed')).toBe('false')
    expect(fr.attributes('aria-pressed')).toBe('true')
    expect(en.attributes('aria-pressed')).toBe('false')
  })

  it('every button is type="button"', () => {
    const wrapper = mountBar()
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(7)
    for (const b of buttons) expect(b.attributes('type')).toBe('button')
  })

  it('emits update:category with "armor" when ARMURES is clicked', async () => {
    const wrapper = mountBar()
    const [, armor] = switchButtons(wrapper, 0)
    await armor.trigger('click')
    expect(wrapper.emitted('update:category')).toEqual([['armor']])
    expect(wrapper.emitted('update:mode')).toBeUndefined()
  })

  it('emits update:mode with "free" when LIBRE is clicked', async () => {
    const wrapper = mountBar()
    const [, free] = switchButtons(wrapper, 1)
    await free.trigger('click')
    expect(wrapper.emitted('update:mode')).toEqual([['free']])
    expect(wrapper.emitted('update:category')).toBeUndefined()
  })

  it('emits update:mode with "archive" when ARCHIVE is clicked, and marks it when current', async () => {
    const wrapper = mountBar()
    const [, , archive] = switchButtons(wrapper, 1)
    expect(archive!.text()).toBe('ARCHIVE')
    expect(archive!.attributes('aria-pressed')).toBe('false')
    await archive!.trigger('click')
    expect(wrapper.emitted('update:mode')).toEqual([['archive']])

    const current = mountBar({ mode: 'archive' })
    const [daily, , archiveOn] = switchButtons(current, 1)
    expect(archiveOn!.classes()).toContain('on')
    expect(archiveOn!.attributes('aria-pressed')).toBe('true')
    expect(daily.classes()).not.toContain('on')
  })

  it('does not disable the category/mode switches by default', () => {
    const wrapper = mountBar()
    const [weapon, armor] = switchButtons(wrapper, 0)
    const [daily, free] = switchButtons(wrapper, 1)
    for (const b of [weapon, armor, daily, free]) expect(b.attributes('disabled')).toBeUndefined()
  })

  describe('with disabled: true', () => {
    it('disables the five category/mode buttons and swallows their clicks', async () => {
      const wrapper = mountBar({ disabled: true })
      const [weapon, armor] = switchButtons(wrapper, 0)
      const [daily, free, archive] = switchButtons(wrapper, 1)
      for (const b of [weapon, armor, daily, free, archive!]) {
        expect(b.attributes('disabled')).toBeDefined()
        await b.trigger('click')
      }
      expect(wrapper.emitted('update:category')).toBeUndefined()
      expect(wrapper.emitted('update:mode')).toBeUndefined()
    })

    it('keeps the FR/EN buttons enabled and functional', async () => {
      const wrapper = mountBar({ disabled: true })
      const [fr, en] = switchButtons(wrapper, 2)
      expect(fr.attributes('disabled')).toBeUndefined()
      expect(en.attributes('disabled')).toBeUndefined()

      await en.trigger('click')
      expect(i18n.global.locale.value).toBe('en')
      expect(wrapper.find('.brand-sub').text()).toBe('// EXOTIC RECON')

      await fr.trigger('click')
      expect(i18n.global.locale.value).toBe('fr')
      expect(wrapper.find('.brand-sub').text()).toBe('// RECON EXOTIQUE')
    })
  })
})
