import { createI18n } from 'vue-i18n'
import fr from './fr.json'
import en from './en.json'

export type Locale = 'fr' | 'en'
const saved = localStorage.getItem('destidle.locale') as Locale | null
const browser: Locale = navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en'

export const i18n = createI18n({
  legacy: false,
  locale: saved ?? browser,
  fallbackLocale: 'fr',
  messages: { fr, en },
})

export function setLocale(l: Locale) {
  i18n.global.locale.value = l
  localStorage.setItem('destidle.locale', l)
  document.documentElement.lang = l
}
