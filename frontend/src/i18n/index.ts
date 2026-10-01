/**
 * vue-i18n setup (spec §8): default locale = browser language, fallback FR.
 *
 * The chosen locale is persisted in `localStorage['destidle.locale']`. A saved
 * value is only honoured when it is exactly one of the supported locales; any
 * other content is silently ignored (REQ-015) and the browser language is used
 * instead. Storage failures (disabled or full) never throw.
 */
import { createI18n } from 'vue-i18n'
import fr from './fr.json'
import en from './en.json'

export type Locale = 'fr' | 'en'

const STORAGE_KEY = 'destidle.locale'
const LOCALES: readonly Locale[] = ['fr', 'en']

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/**
 * Pure resolution of the initial locale.
 * - `saved` wins when it is exactly `'fr'` or `'en'`;
 * - otherwise a browser language starting with `fr` (case-insensitive) gives
 *   `'fr'`, starting with `en` gives `'en'`;
 * - anything else (unsupported language, empty, undefined) falls back to `'fr'`.
 */
export function resolveInitialLocale(saved: string | null, browserLanguage: string | undefined): Locale {
  if (isLocale(saved)) return saved
  const lang = (browserLanguage ?? '').toLowerCase()
  if (lang.startsWith('fr')) return 'fr'
  if (lang.startsWith('en')) return 'en'
  return 'fr'
}

function readSavedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const initialLocale = resolveInitialLocale(readSavedLocale(), navigator.language)

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'fr',
  messages: { fr, en },
})

document.documentElement.lang = initialLocale

export function setLocale(l: Locale) {
  i18n.global.locale.value = l
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* storage unavailable or full: the locale still applies for this session */
  }
  document.documentElement.lang = l
}
