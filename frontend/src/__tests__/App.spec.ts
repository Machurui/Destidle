import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../App.vue'
import { i18n, setLocale } from '../i18n'

function mountApp() {
  return mount(App, { global: { plugins: [i18n] } })
}

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders the brand with the localized subtitle', () => {
    const wrapper = mountApp()
    expect(wrapper.find('.brand-name').text()).toContain('DESTIDLE')
    expect(wrapper.find('.brand-sub').text()).toBe('// RECON EXOTIQUE')
  })

  it('switches the locale to en when the EN button is clicked', async () => {
    const wrapper = mountApp()
    const enButton = wrapper.findAll('button.btn').find((b) => b.text() === 'EN')
    expect(enButton).toBeDefined()
    await enButton!.trigger('click')
    expect(i18n.global.locale.value).toBe('en')
    expect(wrapper.find('.brand-sub').text()).toBe('// EXOTIC RECON')
  })

  it('switches back to fr when the FR button is clicked', async () => {
    setLocale('en')
    const wrapper = mountApp()
    const frButton = wrapper.findAll('button.btn').find((b) => b.text() === 'FR')
    expect(frButton).toBeDefined()
    await frButton!.trigger('click')
    expect(i18n.global.locale.value).toBe('fr')
    expect(wrapper.find('.brand-sub').text()).toBe('// RECON EXOTIQUE')
  })
})
