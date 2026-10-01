<script setup lang="ts">
/**
 * Feedback grid (REQ-008 / REQ-012, CT-05): a header row, then the guesses
 * from the latest (top) down to the first.
 *
 * Flip (REQ-012, DEC-013): only the top row flips, and only when it was added
 * after this board was mounted — the final winning/losing guess included.
 * `useGame` commits that guess and the final `status` in the same mutation,
 * so `done` is already true on its first render: `done` no longer gates the
 * flip (the prop stays in the CT-05 contract). Rows that were already there
 * at mount (board restored on load or on a tab switch) render static cells.
 *
 * App.vue mounts the board only once it holds a guess (`v-if="guesses.length
 * > 0"`, no `key`): a mount with a single guess is therefore taken as the
 * first guess of the game arriving live, and it flips — the trade-off is that
 * a restored one-guess board flips its row on load. A tab switch empties the
 * board (`board = null`) and `newFree()` empties the guesses, so each new
 * board is a new instance with its own `initialCount`.
 *
 * Columns (spec §7) — weapons: Weapon · Rarity · Season · Slot · Type ·
 * Element · Game; armor: Armor · Rarity · Season · Class · Slot · Game.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, GuessResult } from '@/lib/api'
import GuessRow from './GuessRow.vue'

const props = defineProps<{ category: Category; guesses: GuessResult[]; done: boolean }>()
const { t } = useI18n()

/** Header columns as `board.*` i18n keys. */
const WEAPON_COLUMNS = ['weapon', 'rarity', 'season', 'slot', 'type', 'element', 'game'] as const
const ARMOR_COLUMNS = ['armor', 'rarity', 'season', 'class', 'slot', 'game'] as const
const columns = computed<readonly string[]>(() =>
  props.category === 'weapon' ? WEAPON_COLUMNS : ARMOR_COLUMNS,
)

/**
 * Chronological index of the first row added after mount; read once, on
 * purpose not reactive. A single guess at mount counts as added (see above).
 */
const initialCount = props.guesses.length === 1 ? 0 : props.guesses.length

/**
 * Latest guess first. `index` is the chronological position (0 = first guess):
 * it is the row key, so older rows keep their DOM, and it tells the rows added
 * after mount (`index >= initialCount`) from the restored ones.
 */
const rows = computed(() => props.guesses.map((result, index) => ({ result, index })).reverse())
</script>

<template>
  <div class="board">
    <div class="guess-row header-row" :class="{ armor: category === 'armor' }">
      <div v-for="c in columns" :key="c" class="cell">
        <div class="cell-inner">{{ t(`board.${c}`) }}</div>
      </div>
    </div>
    <GuessRow
      v-for="(r, i) in rows"
      :key="r.index"
      :result="r.result"
      :category="category"
      :is-latest="i === 0 && r.index >= initialCount"
    />
  </div>
</template>
