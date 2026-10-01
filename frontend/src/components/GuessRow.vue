<script setup lang="ts">
/**
 * One line of the board (REQ-008, CT-05): the localized name, then one
 * feedback cell per column — weapons: rarity, season, slot, type, element,
 * game; armor: rarity, season, class, slot (= the piece type), game.
 * The season cell adds ▲ when the target is more recent and ▼ when it is
 * older; a season hit has no arrow (CT-04: `dir` 0 ⇔ hit).
 * The latest row flips its feedback cells in sequence, 110 ms per column
 * (REQ-012, prototype); older rows and finished boards render static cells.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, GuessResult, MatchKind } from '@/lib/api'
import ElementBadge from './ElementBadge.vue'

const props = defineProps<{ result: GuessResult; category: Category; isLatest: boolean }>()
const { locale } = useI18n()

/** Value for the current locale, em dash when the API sent none. */
const L = (en: string | null, fr: string | null) => (locale.value === 'fr' ? fr : en) ?? '—'

/** Delay between two consecutive cell flips of the latest row. */
const FLIP_STEP_MS = 110

interface Cell {
  key: string
  kind: MatchKind
  text?: string
  /** Element column only: the API element key, rendered by `ElementBadge`. */
  element?: string | null
  arrow?: string
}

const cells = computed<Cell[]>(() => {
  const g = props.result.guess
  const f = props.result.feedback
  const rarity: Cell = { key: 'rarity', kind: f.rarity, text: L(g.rarityEn, g.rarityFr) }
  const season: Cell = {
    key: 'season',
    kind: f.season.kind,
    text: L(g.seasonEn, g.seasonFr),
    arrow: f.season.kind === 'hit' || f.season.dir === 0 ? '' : f.season.dir > 0 ? '▲' : '▼',
  }
  const game: Cell = { key: 'game', kind: f.game, text: g.game }
  return props.category === 'weapon'
    ? [
        rarity,
        season,
        { key: 'slot', kind: f.slot, text: L(g.slotEn, g.slotFr) },
        { key: 'type', kind: f.type ?? 'miss', text: L(g.typeEn, g.typeFr) },
        { key: 'element', kind: f.element ?? 'miss', element: g.element },
        game,
      ]
    : [
        rarity,
        season,
        { key: 'class', kind: f.class ?? 'miss', text: L(g.classEn, g.classFr) },
        { key: 'slot', kind: f.slot, text: L(g.typeEn, g.typeFr) },
        game,
      ]
})
</script>

<template>
  <div class="guess-row" :class="{ armor: category === 'armor' }">
    <div class="cell name-cell">
      <div class="cell-inner">{{ L(result.guess.nameEn, result.guess.nameFr) }}</div>
    </div>
    <div
      v-for="(c, i) in cells"
      :key="c.key"
      class="cell"
      :class="[c.kind, { reveal: isLatest }]"
      :style="isLatest ? { animationDelay: `${i * FLIP_STEP_MS}ms` } : undefined"
    >
      <div class="cell-inner">
        <ElementBadge
          v-if="c.key === 'element'"
          :element="c.element ?? null"
          :label="L(result.guess.elementEn, result.guess.elementFr)"
        />
        <template v-else>{{ c.text }}<span v-if="c.arrow" class="arrow">{{ c.arrow }}</span></template>
      </div>
    </div>
  </div>
</template>
