import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import GuessBoard from '../GuessBoard.vue'
import GuessRow from '../GuessRow.vue'
import { i18n, setLocale } from '../../i18n'
import type { Category, Feedback, GuessResult, ItemDisplay } from '../../lib/api'

// ---------------------------------------------------------------- fixtures

const weapon: ItemDisplay = {
  id: 1,
  nameEn: 'Sunshot',
  nameFr: 'Soleil de plomb',
  game: 'D2',
  rarityEn: 'Exotic',
  rarityFr: 'Exotique',
  seasonEn: 'Season 1',
  seasonFr: 'Saison 1',
  slotEn: 'Energy',
  slotFr: 'Énergétique',
  typeEn: 'Hand Cannon',
  typeFr: 'Revolver',
  element: 'Solar',
  elementEn: 'Solar',
  elementFr: 'Solaire',
  classEn: null,
  classFr: null,
  lightGgUrl: null,
}

const armor: ItemDisplay = {
  id: 7,
  nameEn: 'Celestial Nighthawk',
  nameFr: 'Faucon céleste',
  game: 'D2',
  rarityEn: 'Exotic',
  rarityFr: 'Exotique',
  seasonEn: 'Season 2',
  seasonFr: 'Saison 2',
  slotEn: null,
  slotFr: null,
  typeEn: 'Helmet',
  typeFr: 'Casque',
  element: null,
  elementEn: null,
  elementFr: null,
  classEn: 'Hunter',
  classFr: 'Chasseur',
  lightGgUrl: null,
}

/** Everything matches (CT-04: dir 0 ⇔ season hit). */
const ALL_HIT: Feedback = {
  rarity: 'hit',
  season: { kind: 'hit', dir: 0 },
  slot: 'hit',
  type: 'hit',
  element: 'hit',
  class: null,
  game: 'hit',
}

function result(guess: ItemDisplay, feedback: Partial<Feedback> = {}, correct = false): GuessResult {
  return { correct, guess, feedback: { ...ALL_HIT, ...feedback } }
}

function named(id: number, nameEn: string, nameFr: string): ItemDisplay {
  return { ...weapon, id, nameEn, nameFr }
}

const global = { plugins: [i18n] }

function mountBoard(props: { category: Category; guesses: GuessResult[]; done?: boolean }) {
  return mount(GuessBoard, { props: { done: false, ...props }, global })
}

// ----------------------------------------------------------------- helpers

const headers = (w: VueWrapper) => w.findAll('.header-row .cell .cell-inner').map((c) => c.text())
const rows = (w: VueWrapper) => w.findAll('.guess-row:not(.header-row)')
/** Feedback cells of a row (everything but the name cell), in column order. */
const cells = (row: DOMWrapper<Element>) => row.findAll('.cell:not(.name-cell)')
const kinds = (row: DOMWrapper<Element>) =>
  cells(row).map((c) => (['hit', 'near', 'miss'] as const).find((k) => c.classes(k)) ?? 'none')
const delays = (row: DOMWrapper<Element>) =>
  cells(row).map((c) => (c.element as HTMLElement).style.animationDelay)

describe('GuessBoard', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  describe('header row (REQ-008, spec §7)', () => {
    it('renders the 7 weapon headers in order, localized', async () => {
      const w = mountBoard({ category: 'weapon', guesses: [] })
      expect(w.classes()).toContain('board')
      const header = w.find('.guess-row.header-row')
      expect(header.exists()).toBe(true)
      expect(header.classes()).not.toContain('armor')
      expect(headers(w)).toEqual(['Arme', 'Rareté', 'Saison', 'Slot', 'Type', 'Élément', 'Jeu'])

      setLocale('en')
      await nextTick()
      expect(headers(w)).toEqual(['Weapon', 'Rarity', 'Season', 'Slot', 'Type', 'Element', 'Game'])
    })

    it('renders the 6 armor headers and flags the rows with the armor class', async () => {
      const w = mountBoard({ category: 'armor', guesses: [result(armor)] })
      expect(w.find('.guess-row.header-row').classes()).toContain('armor')
      expect(headers(w)).toEqual(['Armure', 'Rareté', 'Saison', 'Classe', 'Slot', 'Jeu'])
      expect(rows(w)).toHaveLength(1)
      expect(rows(w)[0]!.classes()).toContain('armor')
      expect(cells(rows(w)[0]!)).toHaveLength(5)

      setLocale('en')
      await nextTick()
      expect(headers(w)).toEqual(['Armor', 'Rarity', 'Season', 'Class', 'Slot', 'Game'])
    })
  })

  describe('row order and flip animation (REQ-012, DEC-013)', () => {
    const four = [
      result(named(1, 'First', 'Premier')),
      result(named(2, 'Second', 'Deuxième')),
      result(named(3, 'Third', 'Troisième')),
      result(named(4, 'Fourth', 'Quatrième')),
    ]
    const three = four.slice(0, 3)
    const FLIP_DELAYS = ['0ms', '110ms', '220ms', '330ms', '440ms', '550ms']
    const isStatic = (row: DOMWrapper<Element>) =>
      cells(row).every((c) => !c.classes('reveal')) && delays(row).every((d) => d === '')

    it('shows the latest guess first', () => {
      const w = mountBoard({ category: 'weapon', guesses: three })
      const names = rows(w).map((r) => r.find('.cell.name-cell .cell-inner').text())
      expect(names).toEqual(['Troisième', 'Deuxième', 'Premier'])
    })

    it('flips only the feedback cells of a row added after mount, 110 ms per column', async () => {
      const w = mountBoard({ category: 'weapon', guesses: three.slice(0, 2) })
      expect(w.findAll('.cell.reveal')).toHaveLength(0)
      await w.setProps({ guesses: three })
      const [latest, previous] = rows(w)
      expect(latest!.find('.cell.name-cell').classes()).not.toContain('reveal')
      expect(cells(latest!).every((c) => c.classes('reveal'))).toBe(true)
      expect(delays(latest!)).toEqual(FLIP_DELAYS)
      expect(isStatic(previous!)).toBe(true)
      expect(w.findAll('.cell.reveal')).toHaveLength(6)
    })

    it('moves the flip to each new row and leaves the previous one static', async () => {
      const w = mountBoard({ category: 'weapon', guesses: three.slice(0, 2) })
      await w.setProps({ guesses: three })
      await w.setProps({ guesses: four })
      const [latest, previous] = rows(w)
      expect(latest!.find('.cell.name-cell .cell-inner').text()).toBe('Quatrième')
      expect(delays(latest!)).toEqual(FLIP_DELAYS)
      expect(isStatic(previous!)).toBe(true)
      expect(w.findAll('.cell.reveal')).toHaveLength(6)
    })

    it('flips the last row added even when it ends the game (done on its first render)', async () => {
      const w = mountBoard({ category: 'weapon', guesses: three.slice(0, 2) })
      // useGame commits the final guess and the won/lost status in one mutation.
      const final = [...three.slice(0, 2), result(named(3, 'Third', 'Troisième'), {}, true)]
      await w.setProps({ guesses: final, done: true })
      const [latest, previous] = rows(w)
      expect(cells(latest!).every((c) => c.classes('reveal'))).toBe(true)
      expect(delays(latest!)).toEqual(FLIP_DELAYS)
      expect(isStatic(previous!)).toBe(true)
      expect(w.findAll('.cell.reveal')).toHaveLength(6)
    })

    it.each([false, true])('does not flip a restored board (done: %s)', (done) => {
      const w = mountBoard({ category: 'weapon', guesses: three, done })
      expect(w.findAll('.cell.reveal')).toHaveLength(0)
      expect(rows(w).every(isStatic)).toBe(true)
    })

    it.each([false, true])('flips the row of a board mounted on its first guess (done: %s)', (done) => {
      // App.vue mounts the board on the first guess; done = won in one guess.
      const w = mountBoard({ category: 'weapon', guesses: three.slice(0, 1), done })
      expect(delays(rows(w)[0]!)).toEqual(FLIP_DELAYS)
      expect(w.findAll('.cell.reveal')).toHaveLength(6)
    })

    it('gives each board mounted behind App.vue’s v-if its own baseline (new game, tab switch)', async () => {
      // Same condition as App.vue: the board only exists once it holds a guess.
      const Host = defineComponent({
        props: { guesses: { type: Array as PropType<GuessResult[]>, required: true } },
        setup: (p) => () =>
          p.guesses.length > 0 ? h(GuessBoard, { category: 'weapon', guesses: p.guesses, done: false }) : null,
      })
      const w = mount(Host, { props: { guesses: [] as GuessResult[] }, global })
      await w.setProps({ guesses: three.slice(0, 1) }) // first guess of a game
      expect(w.findAll('.cell.reveal')).toHaveLength(6)
      await w.setProps({ guesses: [] }) // newFree() / tab switch: board unmounted
      expect(w.find('.board').exists()).toBe(false)
      await w.setProps({ guesses: three }) // restored board of the new context
      expect(w.findAll('.cell.reveal')).toHaveLength(0)
      await w.setProps({ guesses: four }) // next guess on it
      expect(delays(rows(w)[0]!)).toEqual(FLIP_DELAYS)
      expect(w.findAll('.cell.reveal')).toHaveLength(6)
    })

    it('keeps a stable key per guess so a new guess does not remount the older rows', async () => {
      const w = mountBoard({ category: 'weapon', guesses: three.slice(0, 2) })
      const firstRowEl = rows(w)[1]!.element
      await w.setProps({ guesses: three })
      expect(rows(w)).toHaveLength(3)
      expect(rows(w)[2]!.element).toBe(firstRowEl)
    })
  })

  describe('weapon cells (REQ-008)', () => {
    it('maps every column to its match kind and shows ▲ when the target is more recent', () => {
      const w = mountBoard({
        category: 'weapon',
        guesses: [
          result(weapon, {
            rarity: 'hit',
            season: { kind: 'near', dir: 1 },
            slot: 'miss',
            type: 'hit',
            element: 'miss',
            class: null,
            game: 'hit',
          }),
        ],
      })
      const row = rows(w)[0]!
      expect(cells(row)).toHaveLength(6)
      expect(kinds(row)).toEqual(['hit', 'near', 'miss', 'hit', 'miss', 'hit'])
      const season = cells(row)[1]!
      expect(season.find('.arrow').text()).toBe('▲')
      expect(season.text()).toContain('Saison 1')
      expect(cells(row)[0]!.text()).toBe('Exotique')
      expect(cells(row)[2]!.text()).toBe('Énergétique')
      expect(cells(row)[3]!.text()).toBe('Revolver')
      expect(cells(row)[5]!.text()).toBe('D2')
    })

    it('shows ▼ when the target is older and no arrow on a season hit', () => {
      const older = mountBoard({
        category: 'weapon',
        guesses: [result(weapon, { season: { kind: 'miss', dir: -1 } })],
      })
      expect(cells(rows(older)[0]!)[1]!.find('.arrow').text()).toBe('▼')

      const hit = mountBoard({ category: 'weapon', guesses: [result(weapon)] })
      const season = cells(rows(hit)[0]!)[1]!
      expect(season.classes()).toContain('hit')
      expect(season.find('.arrow').exists()).toBe(false)
      expect(season.text()).toBe('Saison 1')
    })

    it('renders the element badge with the localized name', async () => {
      const w = mountBoard({ category: 'weapon', guesses: [result(weapon)] })
      const element = cells(rows(w)[0]!)[4]!
      expect(element.find('.el-badge .el-glyph').text()).toBe('☼')
      expect(element.find('.el-badge .el-name').text()).toBe('Solaire')

      setLocale('en')
      await nextTick()
      expect(element.find('.el-badge .el-name').text()).toBe('Solar')
    })

    it('renders an em dash for a missing element and missing slot', () => {
      const w = mountBoard({
        category: 'weapon',
        guesses: [
          result(
            { ...weapon, element: null, elementEn: null, elementFr: null, slotEn: null, slotFr: null },
            { element: null, slot: 'miss' },
          ),
        ],
      })
      const row = rows(w)[0]!
      expect(cells(row)[2]!.text()).toBe('—')
      expect(cells(row)[4]!.text()).toBe('—')
      expect(cells(row)[4]!.find('.el-badge').exists()).toBe(false)
      expect(kinds(row)[4]).toBe('miss')
    })
  })

  describe('armor cells (REQ-008)', () => {
    it('shows class and slot (= piece type) with their match kinds', () => {
      const w = mountBoard({
        category: 'armor',
        guesses: [
          result(armor, {
            rarity: 'miss',
            season: { kind: 'near', dir: -1 },
            slot: 'hit',
            type: null,
            element: null,
            class: 'near',
            game: 'miss',
          }),
        ],
      })
      const row = rows(w)[0]!
      expect(kinds(row)).toEqual(['miss', 'near', 'near', 'hit', 'miss'])
      expect(cells(row)[0]!.text()).toBe('Exotique')
      expect(cells(row)[1]!.find('.arrow').text()).toBe('▼')
      expect(cells(row)[2]!.text()).toBe('Chasseur')
      expect(cells(row)[3]!.text()).toBe('Casque')
      expect(cells(row)[4]!.text()).toBe('D2')
      expect(row.find('.el-badge').exists()).toBe(false)
    })

    it('falls back to miss when the API sends no class feedback', () => {
      const w = mountBoard({ category: 'armor', guesses: [result(armor, { class: null })] })
      expect(kinds(rows(w)[0]!)[2]).toBe('miss')
    })
  })

  describe('localization', () => {
    it('switches names and values to English with the locale', async () => {
      const w = mountBoard({ category: 'armor', guesses: [result(armor)] })
      const row = rows(w)[0]!
      expect(row.find('.name-cell .cell-inner').text()).toBe('Faucon céleste')

      setLocale('en')
      await nextTick()
      expect(row.find('.name-cell .cell-inner').text()).toBe('Celestial Nighthawk')
      expect(cells(row).map((c) => c.text())).toEqual(['Exotic', 'Season 2', 'Hunter', 'Helmet', 'D2'])
    })
  })
})

describe('GuessRow', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('reveals its feedback cells only when it is the latest row', async () => {
    const w = mount(GuessRow, {
      props: { result: result(weapon), category: 'weapon', isLatest: true },
      global,
    })
    expect(w.classes()).toContain('guess-row')
    expect(w.classes()).not.toContain('armor')
    expect(w.findAll('.cell.reveal')).toHaveLength(6)
    expect(w.find('.cell.name-cell').classes()).not.toContain('reveal')

    await w.setProps({ isLatest: false })
    expect(w.findAll('.cell.reveal')).toHaveLength(0)
  })

  it('carries the armor class for an armor guess', () => {
    const w = mount(GuessRow, {
      props: { result: result(armor), category: 'armor', isLatest: false },
      global,
    })
    expect(w.classes()).toContain('armor')
    expect(w.findAll('.cell')).toHaveLength(6)
  })
})
