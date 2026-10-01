import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import SearchBox from '../SearchBox.vue'
import { i18n, setLocale } from '@/i18n'
import type { Category, ItemSummary } from '@/lib/api'

const items = [
  { id: 1, nameEn: 'Hawkmoon', nameFr: 'Tête-de-faucon', game: 'D2', typeEn: 'Hand Cannon', typeFr: 'Revolver', iconUrl: '' },
  { id: 2, nameEn: 'Sunshot', nameFr: 'Rayon de soleil', game: 'D2', typeEn: 'Hand Cannon', typeFr: 'Revolver', iconUrl: '' },
  { id: 3, nameEn: 'Gjallarhorn', nameFr: 'Gjallarhorn', game: 'D1', typeEn: 'Rocket Launcher', typeFr: 'Lance-roquettes', iconUrl: '' },
] as const

const make = (usedIds = new Set<number>()) =>
  mount(SearchBox, { props: { items: [...items], usedIds }, global: { plugins: [i18n] } })

/** Same as `make` but with an explicit item list and optional category. */
function mountWith(list: ItemSummary[], category?: Category, usedIds = new Set<number>()) {
  return mount(SearchBox, {
    props: category ? { items: list, usedIds, category } : { items: list, usedIds },
    global: { plugins: [i18n] },
  })
}

function item(id: number, nameEn: string, iconUrl = ''): ItemSummary {
  return { id, nameEn, nameFr: nameEn, game: 'D2', typeEn: 'Hand Cannon', typeFr: 'Revolver', iconUrl }
}

const key = (k: string) => ({ key: k })

describe('SearchBox', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('matche le nom FR sans accents', async () => {
    i18n.global.locale.value = 'fr' // le dd-name affiche le nom localisé
    const w = make()
    await w.find('input').setValue('tete de')
    expect(w.findAll('.dd-item')).toHaveLength(0) // « tete de » ≠ « tete-de » : tiret conservé
    await w.find('input').setValue('tete-de')
    expect(w.findAll('.dd-item')).toHaveLength(1)
    expect(w.find('.dd-name').text()).toContain('Tête-de-faucon')
  })

  it('matche le nom EN et exclut les items joués', async () => {
    const w = make(new Set([2]))
    await w.find('input').setValue('s')
    const names = w.findAll('.dd-name').map(n => n.text())
    expect(names.some(n => n.includes('Sunshot'))).toBe(false) // exclu : déjà joué
    expect(names.some(n => n.includes('Gjallarhorn'))).toBe(false) // aucun « s » dans ses deux noms
  })

  it('Entrée émet pick sur l’item actif', async () => {
    const w = make()
    await w.find('input').setValue('hawk')
    await w.find('input').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')![0]).toEqual([1])
  })

  it('renders the prototype structure and the input attributes', () => {
    const w = make()
    expect(w.element.tagName).toBe('DIV')
    expect(w.classes()).toContain('search-wrap')
    const box = w.find('.search-wrap > .search-box')
    expect(box.exists()).toBe(true)
    expect(box.find('.search-glyph').text()).toBe('▸')
    expect(box.find('.search-hint').text()).toBe('ENTRÉE')
    const input = box.find('input')
    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('autocomplete')).toBe('off')
    expect(input.attributes('autofocus')).toBeDefined()
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
  })

  it('shows no dropdown for an empty or blank query, even when focused', async () => {
    const w = make()
    expect(w.find('.dropdown').exists()).toBe(false)
    await w.find('input').trigger('focus')
    expect(w.find('.dropdown').exists()).toBe(false)
    await w.find('input').setValue('   ')
    expect(w.find('.dropdown').exists()).toBe(false)
  })

  it('shows no dropdown when nothing matches', async () => {
    const w = make()
    await w.find('input').setValue('zzz')
    expect(w.find('.dropdown').exists()).toBe(false)
    expect(w.find('input').attributes('aria-expanded')).toBe('false')
  })

  it('caps the list at 8 results and keeps the original order', async () => {
    const list = Array.from({ length: 10 }, (_, i) => item(100 + i, `Alpha ${i + 1}`))
    const w = mountWith(list)
    await w.find('input').setValue('alpha')
    const rows = w.findAll('.dd-item')
    expect(rows).toHaveLength(8)
    expect(rows.map(r => r.find('.dd-name').text())).toEqual(
      ['Alpha 1', 'Alpha 2', 'Alpha 3', 'Alpha 4', 'Alpha 5', 'Alpha 6', 'Alpha 7', 'Alpha 8'],
    )
  })

  it('matches accent-insensitively from an accented query to a plain name', async () => {
    const w = make()
    await w.find('input').setValue('gjàllar')
    const names = w.findAll('.dd-name').map(n => n.text())
    expect(names).toEqual(['Gjallarhorn'])
  })

  it('matches on either language regardless of the displayed locale', async () => {
    setLocale('en')
    const w = make()
    await w.find('input').setValue('rayon')
    expect(w.findAll('.dd-name').map(n => n.text())).toEqual(['Sunshot']) // EN name shown, FR name matched
  })

  it('↓↓↑ then Enter picks the second item', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o') // Hawkmoon, Sunshot, Gjallarhorn (ids 1, 2, 3)
    expect(w.findAll('.dd-item')).toHaveLength(3)
    await input.trigger('keydown', key('ArrowDown'))
    await input.trigger('keydown', key('ArrowDown'))
    await input.trigger('keydown', key('ArrowUp'))
    const rows = w.findAll('.dd-item')
    expect(rows[1]!.classes()).toContain('active')
    expect(rows[0]!.classes()).not.toContain('active')
    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toEqual([[2]])
  })

  it('ArrowDown stops at the last item and ArrowUp at the first', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    for (let i = 0; i < 6; i++) await input.trigger('keydown', key('ArrowDown'))
    let rows = w.findAll('.dd-item')
    expect(rows[2]!.classes()).toContain('active')
    expect(rows.filter(r => r.classes().includes('active'))).toHaveLength(1)
    for (let i = 0; i < 6; i++) await input.trigger('keydown', key('ArrowUp'))
    rows = w.findAll('.dd-item')
    expect(rows[0]!.classes()).toContain('active')
    expect(rows.filter(r => r.classes().includes('active'))).toHaveLength(1)
  })

  it('prevents the default of ArrowDown, ArrowUp and Enter (no caret move, no form submit)', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    for (const k of ['ArrowDown', 'ArrowUp', 'Enter']) {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      input.element.dispatchEvent(ev)
      expect(ev.defaultPrevented, k).toBe(true)
    }
  })

  it('resets the active index to the first row when the query changes', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    await input.trigger('keydown', key('ArrowDown'))
    expect(w.findAll('.dd-item')[1]!.classes()).toContain('active')
    await input.setValue('on') // Hawkmoon, Tête-de-faucon → ids 1 ; Gjallarhorn → 3
    const rows = w.findAll('.dd-item')
    expect(rows[0]!.classes()).toContain('active')
    expect(rows.filter(r => r.classes().includes('active'))).toHaveLength(1)
  })

  it('Enter emits nothing when there is no result', async () => {
    const w = make()
    const input = w.find('input')
    await input.trigger('keydown', key('Enter'))
    await input.setValue('zzz')
    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toBeUndefined()
  })

  it('Escape closes the list and a new keystroke reopens it', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    expect(w.find('.dropdown').exists()).toBe(true)
    await input.trigger('keydown', key('Escape'))
    expect(w.find('.dropdown').exists()).toBe(false)
    expect(input.attributes('aria-expanded')).toBe('false')
    await input.setValue('on')
    expect(w.find('.dropdown').exists()).toBe(true)
    expect(input.attributes('aria-expanded')).toBe('true')
  })

  it('Enter after Escape picks nothing: it reopens the list, a second Enter picks the visible row', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    await input.trigger('keydown', key('ArrowDown'))
    await input.trigger('keydown', key('Escape'))
    expect(w.find('.dropdown').exists()).toBe(false)

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.element.dispatchEvent(enter)
    await nextTick()
    expect(enter.defaultPrevented).toBe(true)
    expect(w.emitted('pick')).toBeUndefined()
    expect((input.element as HTMLInputElement).value).toBe('o')
    expect(w.find('.dropdown').exists()).toBe(true)
    expect(input.attributes('aria-expanded')).toBe('true')
    const rows = w.findAll('.dd-item')
    expect(rows[1]!.classes()).toContain('active')
    expect(input.attributes('aria-activedescendant')).toBe(rows[1]!.attributes('id'))

    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toEqual([[2]])
  })

  const shrinkers: [string, (w: ReturnType<typeof make>) => Promise<void>][] = [
    ['usedIds', (w) => w.setProps({ usedIds: new Set([3]) })],
    ['items', (w) => w.setProps({ items: [items[0], items[1]] })],
  ]

  it.each(shrinkers)('keeps a visible active row when %s shrinks the list without a keystroke', async (_name, shrink) => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o') // ids 1, 2, 3
    await input.trigger('keydown', key('ArrowDown'))
    await input.trigger('keydown', key('ArrowDown'))
    expect(w.findAll('.dd-item')[2]!.classes()).toContain('active')

    await shrink(w) // Gjallarhorn (id 3) leaves the list, the query is unchanged
    const rows = w.findAll('.dd-item')
    expect(rows).toHaveLength(2)
    expect(rows.filter(r => r.classes().includes('active'))).toHaveLength(1)
    expect(rows[1]!.classes()).toContain('active')
    expect(input.attributes('aria-activedescendant')).toBe(rows[1]!.attributes('id'))
    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toEqual([[2]])
  })

  it('goes back to the first row when the list empties then refills without a keystroke', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    await input.trigger('keydown', key('ArrowDown'))
    await input.trigger('keydown', key('ArrowDown'))
    await w.setProps({ usedIds: new Set([1, 2, 3]) })
    expect(w.find('.dropdown').exists()).toBe(false)
    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toBeUndefined()

    await w.setProps({ usedIds: new Set<number>() })
    const rows = w.findAll('.dd-item')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.classes()).toContain('active')
    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toEqual([[1]])
  })

  it('blur closes the list and focus reopens it while the query still matches', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    await input.trigger('blur')
    expect(w.find('.dropdown').exists()).toBe(false)
    await input.trigger('focus')
    expect(w.find('.dropdown').exists()).toBe(true)
  })

  it('hovering a row makes it active and Enter picks it', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    await w.findAll('.dd-item')[2]!.trigger('mouseenter')
    const rows = w.findAll('.dd-item')
    expect(rows[2]!.classes()).toContain('active')
    expect(rows.filter(r => r.classes().includes('active'))).toHaveLength(1)
    await input.trigger('keydown', key('Enter'))
    expect(w.emitted('pick')).toEqual([[3]])
  })

  it('clicking a row emits pick, clears the input and closes the list', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('o')
    const row = w.findAll('.dd-item')[1]!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row.element.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true) // keeps the focus on the input
    await row.trigger('click')
    expect(w.emitted('pick')).toEqual([[2]])
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(w.find('.dropdown').exists()).toBe(false)
    expect(input.attributes('aria-expanded')).toBe('false')
  })

  it('Enter clears the input and closes the list after the pick', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('hawk')
    await input.trigger('keydown', key('Enter'))
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(w.find('.dropdown').exists()).toBe(false)
  })

  it('renders the meta as « game · localized type » in fr and en', async () => {
    const w = make()
    await w.find('input').setValue('hawk')
    expect(w.find('.dd-meta').text()).toBe('D2 · Revolver')
    setLocale('en')
    await nextTick()
    expect(w.find('.dd-meta').text()).toBe('D2 · Hand Cannon')
    expect(w.find('.dd-name').text()).toBe('Hawkmoon')
  })

  it('renders the icon only when iconUrl is non-empty', async () => {
    const w = mountWith([item(10, 'Icon One', 'https://cdn.example/icon.png'), item(11, 'Icon Two')])
    await w.find('input').setValue('icon')
    const rows = w.findAll('.dd-item')
    expect(rows).toHaveLength(2)
    const img = rows[0]!.find('.dd-left > img.dd-icon')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('https://cdn.example/icon.png')
    expect(img.attributes('alt')).toBe('')
    expect(img.attributes('loading')).toBe('lazy')
    expect(rows[1]!.find('img').exists()).toBe(false)
    expect(rows[1]!.find('.dd-left > .dd-name').text()).toBe('Icon Two')
  })

  it('uses the weapon placeholder by default and the armor one for category "armor"', () => {
    expect(make().find('input').attributes('placeholder')).toBe(i18n.global.t('search.placeholderWeapon'))
    expect(mountWith([...items], 'armor').find('input').attributes('placeholder'))
      .toBe(i18n.global.t('search.placeholderArmor'))
    expect(mountWith([...items], 'weapon').find('input').attributes('placeholder'))
      .toBe(i18n.global.t('search.placeholderWeapon'))
  })

  it('exposes a consistent combobox / listbox ARIA wiring', async () => {
    const w = make()
    const input = w.find('input')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
    await input.setValue('o')
    const list = w.find('.dropdown')
    expect(list.attributes('role')).toBe('listbox')
    expect(list.attributes('id')).toBeTruthy()
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-controls')).toBe(list.attributes('id'))
    const rows = w.findAll('.dd-item')
    for (const r of rows) {
      expect(r.attributes('role')).toBe('option')
      expect(r.attributes('id')).toBeTruthy()
    }
    expect(input.attributes('aria-activedescendant')).toBe(rows[0]!.attributes('id'))
    expect(rows[0]!.attributes('aria-selected')).toBe('true')
    expect(rows[1]!.attributes('aria-selected')).toBe('false')
    await input.trigger('keydown', key('ArrowDown'))
    expect(input.attributes('aria-activedescendant')).toBe(w.findAll('.dd-item')[1]!.attributes('id'))
    await input.trigger('keydown', key('Escape'))
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
  })
})
