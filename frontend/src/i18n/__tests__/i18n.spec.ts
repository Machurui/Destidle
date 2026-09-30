import { beforeEach, describe, expect, it } from 'vitest'
import fr from '../fr.json'
import en from '../en.json'
import { i18n, setLocale } from '../index'

/** Flattens a nested message object into dotted key paths (e.g. `win.solved`). */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

describe('i18n messages', () => {
  it('fr.json and en.json expose exactly the same set of keys', () => {
    const frKeys = flattenKeys(fr)
    const enKeys = flattenKeys(en)
    expect(frKeys.length).toBeGreaterThan(0)
    expect(enKeys).toEqual(frKeys)
  })

  it('falls back to fr', () => {
    expect(i18n.global.fallbackLocale.value).toBe('fr')
  })
})

describe('setLocale', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it.each(['en', 'fr'] as const)(
    "setLocale('%s') updates the active locale, localStorage and <html lang>",
    (locale) => {
      setLocale(locale)
      expect(i18n.global.locale.value).toBe(locale)
      expect(localStorage.getItem('destidle.locale')).toBe(locale)
      expect(document.documentElement.lang).toBe(locale)
    },
  )
})

describe('pluralization', () => {
  it('renders singular/plural forms in fr', () => {
    setLocale('fr')
    expect(i18n.global.t('win.solved', { n: 1 }, 1)).toBe('Trouvé en 1 essai')
    expect(i18n.global.t('win.solved', { n: 3 }, 3)).toBe('Trouvé en 3 essais')
  })

  it('renders singular/plural forms in en', () => {
    setLocale('en')
    expect(i18n.global.t('win.solved', { n: 1 }, 1)).toBe('Solved in 1 guess')
    expect(i18n.global.t('win.solved', { n: 3 }, 3)).toBe('Solved in 3 guesses')
  })
})
