import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ArchiveList from '../ArchiveList.vue'
import { i18n, setLocale } from '@/i18n'
import type { ArchiveDay } from '@/composables/archiveDays'

const DAYS: ArchiveDay[] = [
  { date: '2026-07-19', number: 4, status: 'won', guessCount: 3 },
  { date: '2026-07-18', number: 3, status: 'lost', guessCount: 8 },
  { date: '2026-07-17', number: 2, status: 'playing', guessCount: 2 },
  { date: '2026-07-16', number: 1, status: 'new', guessCount: 0 },
]

function mountList(props: { days?: ArchiveDay[]; disabled?: boolean } = {}) {
  return mount(ArchiveList, { props: { days: DAYS, ...props }, global: { plugins: [i18n] } })
}

/** [number, date, result] of each row, in DOM order. */
function rows(wrapper: VueWrapper): string[][] {
  return wrapper
    .findAll('.archive-row')
    .map((r) => [r.find('.archive-num').text(), r.find('.archive-date').text(), r.find('.archive-status').text()])
}

describe('ArchiveList', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders one row per day in the given order with number, date and result (fr)', () => {
    const wrapper = mountList()
    expect(wrapper.find('.archive-title').text()).toBe('// ARCHIVE')
    expect(rows(wrapper)).toEqual([
      ['#4', '19 juil. 2026', 'Trouvé en 3/8'],
      ['#3', '18 juil. 2026', 'Perdu'],
      ['#2', '17 juil. 2026', 'En cours 2/8'],
      ['#1', '16 juil. 2026', 'À jouer'],
    ])
  })

  it('uses the English labels and date format in en', () => {
    setLocale('en')
    expect(rows(mountList())).toEqual([
      ['#4', 'Jul 19, 2026', 'Solved in 3/8'],
      ['#3', 'Jul 18, 2026', 'Lost'],
      ['#2', 'Jul 17, 2026', 'In progress 2/8'],
      ['#1', 'Jul 16, 2026', 'To play'],
    ])
  })

  it('tags each row with its status class', () => {
    const classes = mountList().findAll('.archive-row').map((r) => r.classes())
    expect(classes[0]).toContain('won')
    expect(classes[1]).toContain('lost')
    expect(classes[2]).toContain('playing')
    expect(classes[3]).toContain('new')
  })

  it('emits open with the date of the clicked row', async () => {
    const wrapper = mountList()
    await wrapper.findAll('.archive-row')[2]!.trigger('click')
    expect(wrapper.emitted('open')).toEqual([['2026-07-17']])
  })

  it('every row is a type="button" button, disabled with `disabled`', async () => {
    const wrapper = mountList({ disabled: true })
    const buttons = wrapper.findAll('.archive-row')
    for (const b of buttons) {
      expect(b.element.tagName).toBe('BUTTON')
      expect(b.attributes('type')).toBe('button')
      expect(b.attributes('disabled')).toBeDefined()
    }
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('shows a dedicated message when there is no past day yet', () => {
    const wrapper = mountList({ days: [] })
    expect(wrapper.findAll('.archive-row')).toHaveLength(0)
    expect(wrapper.find('.archive-empty').text()).toBe("Aucun défi passé pour l'instant : revenez demain.")
  })
})
