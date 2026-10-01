import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveInitialLocale } from '../index'

const STORAGE_KEY = 'destidle.locale'

describe('resolveInitialLocale', () => {
  it.each([
    // saved value wins when it is exactly 'fr' or 'en'
    ['fr', 'en-US', 'fr'],
    ['fr', 'de-DE', 'fr'],
    ['fr', undefined, 'fr'],
    ['en', 'fr-FR', 'en'],
    ['en', 'de-DE', 'en'],
    ['en', undefined, 'en'],
    // any other saved value is ignored (silent reset) → browser detection
    ['zz', 'fr-FR', 'fr'],
    ['zz', 'en-US', 'en'],
    ['zz', 'de-DE', 'fr'],
    ['zz', undefined, 'fr'],
    ['FR', 'en-US', 'en'],
    ['EN', 'fr-FR', 'fr'],
    ['', 'en-US', 'en'],
    ['', 'de-DE', 'fr'],
    ['fr ', 'en-US', 'en'],
    ['french', 'en-US', 'en'],
    ['null', 'en-US', 'en'],
    // no saved value → browser language, prefix match, case-insensitive
    [null, 'fr-FR', 'fr'],
    [null, 'fr-CA', 'fr'],
    [null, 'fr', 'fr'],
    [null, 'FR-fr', 'fr'],
    [null, 'en-US', 'en'],
    [null, 'en-GB', 'en'],
    [null, 'en', 'en'],
    [null, 'EN-au', 'en'],
    // unsupported / missing browser language → fallback FR (spec §8)
    [null, 'de-DE', 'fr'],
    [null, 'es-ES', 'fr'],
    [null, 'it', 'fr'],
    [null, '', 'fr'],
    [null, undefined, 'fr'],
    // a language that merely contains 'fr'/'en' without starting with it is not matched
    [null, 'af', 'fr'],
    [null, 'ben', 'fr'],
  ] as const)('saved=%j browser=%j → %s', (saved, browser, expected) => {
    expect(resolveInitialLocale(saved, browser)).toBe(expected)
  })
})

describe('i18n module initialisation', () => {
  function stubBrowserLanguage(value: string) {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(value)
  }

  async function importI18n(browserLanguage: string, saved?: string) {
    if (saved !== undefined) localStorage.setItem(STORAGE_KEY, saved)
    stubBrowserLanguage(browserLanguage)
    document.documentElement.lang = 'xx'
    return await import('../index')
  }

  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.resetModules()
    document.documentElement.lang = ''
  })

  it('uses fr for a fr-FR browser without saved locale', async () => {
    const { i18n } = await importI18n('fr-FR')
    expect(i18n.global.locale.value).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('uses en for an en-US browser without saved locale', async () => {
    const { i18n } = await importI18n('en-US')
    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('falls back to fr for an unsupported browser language (de-DE)', async () => {
    const { i18n } = await importI18n('de-DE')
    expect(i18n.global.locale.value).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('prefers the saved locale over the browser language', async () => {
    const { i18n } = await importI18n('fr-FR', 'en')
    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('ignores a corrupted saved locale and falls back to the browser language', async () => {
    const { i18n } = await importI18n('en-US', 'zz')
    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('ignores a saved locale with the wrong case', async () => {
    const { i18n } = await importI18n('en-US', 'FR')
    expect(i18n.global.locale.value).toBe('en')
  })

  it('synchronises <html lang> with the resolved locale right after import', async () => {
    document.documentElement.lang = 'xx'
    const { i18n } = await importI18n('fr-CA', 'en')
    expect(document.documentElement.lang).toBe(i18n.global.locale.value)
    expect(document.documentElement.lang).toBe('en')
  })

  it('does not throw when localStorage.getItem throws and uses the browser language', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const { i18n } = await importI18n('en-GB')
    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('does not write to localStorage at startup (a corrupted value is ignored, not rewritten)', async () => {
    localStorage.setItem(STORAGE_KEY, 'zz')
    stubBrowserLanguage('fr-FR')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { i18n } = await import('../index')
    expect(i18n.global.locale.value).toBe('fr')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zz')
  })

  it('keeps fallbackLocale fr and the composition (legacy: false) mode', async () => {
    const { i18n } = await importI18n('de-DE')
    expect(i18n.global.fallbackLocale.value).toBe('fr')
    expect(i18n.mode).toBe('composition')
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'fr'])
  })

  it('setLocale still updates the locale, localStorage and <html lang>', async () => {
    const { i18n, setLocale } = await importI18n('de-DE')
    setLocale('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('setLocale does not throw when localStorage.setItem throws', async () => {
    const { i18n, setLocale } = await importI18n('fr-FR')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setLocale('en')).not.toThrow()
    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
