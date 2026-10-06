<script setup lang="ts">
/**
 * Application shell (REQ-010 / REQ-012 / REQ-015): one screen driven by a
 * single `useGame()` instance, composed of the prototype's blocks in order
 * (top bar, error banner, intel, splash, search, board, legend, footer).
 * Once the game is over, the win/lose panel takes the search box's place,
 * above the board. No router, no store: `g` holds the whole state.
 *
 * DEC-010: the category/mode switches are disabled only while a guess is
 * being submitted; the "new game" buttons of the panels are disabled while
 * a guess or a puzzle load is in flight (`busy`), which also prevents a
 * double `newFree()`.
 *
 * The error banner is NOT exclusive of the game content: the composable
 * keeps the current board displayed while the same context reloads
 * (`retry()`), and a restored lost board whose reveal failed must stay
 * visible under the banner so that RETRY can reveal it. Only when the board
 * is `null` (first load, failed context switch) does the screen reduce to
 * the banner or the loading placeholder.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGame } from '@/composables/useGame'
import TopBar from '@/components/TopBar.vue'
import IntelBar from '@/components/IntelBar.vue'
import SplashFrame from '@/components/SplashFrame.vue'
import SearchBox from '@/components/SearchBox.vue'
import GuessBoard from '@/components/GuessBoard.vue'
import WinPanel from '@/components/WinPanel.vue'
import LosePanel from '@/components/LosePanel.vue'
import Legend from '@/components/Legend.vue'
import FooterBar from '@/components/FooterBar.vue'

const g = useGame()
const { t } = useI18n()
onMounted(g.init)

/** A request is in flight: freezes the panels' "new game" buttons. */
const busy = computed(() => g.submitting.value || g.loading.value)
/**
 * Target of a won board = the last (correct) guess; `null` while there is
 * none. Index access rather than `.at(-1)`: the vitest project's `lib` does
 * not expose ES2022 and `vue-tsc --build` checks this file there too.
 */
const wonTarget = computed(() => g.guesses.value[g.guesses.value.length - 1]?.guess ?? null)
</script>

<template>
  <div class="app">
    <TopBar
      :category="g.category.value"
      :mode="g.mode.value"
      :disabled="g.submitting.value"
      @update:category="g.setCategory"
      @update:mode="g.setMode"
    />

    <div v-if="g.error.value" class="error-banner">
      <span>{{
        g.error.value.status === 0
          ? t('errors.network')
          : t('errors.http', { status: g.error.value.status })
      }}</span>
      <button type="button" class="btn" @click="g.retry()">{{ t('errors.retry') }}</button>
    </div>

    <template v-if="g.board.value">
      <IntelBar
        :category="g.category.value"
        :mode="g.mode.value"
        :guess-count="g.guesses.value.length"
        :max="g.MAX_GUESSES"
        :pool-size="g.poolSize.value"
        :daily-number="g.daily.value?.number"
        :streak="g.streak.value"
      />

      <SplashFrame :src="g.splashSrc.value" :level="g.splashLevel.value" />

      <SearchBox
        v-if="g.status.value === 'playing' && !g.loading.value"
        :items="g.items.value"
        :used-ids="g.usedIds.value"
        :category="g.category.value"
        @pick="g.submitGuess"
      />

      <!-- Game over: the answer takes the search box's place, above the board. -->
      <WinPanel
        v-if="g.status.value === 'won' && wonTarget"
        :target="wonTarget"
        :guess-count="g.guesses.value.length"
        :mode="g.mode.value"
        :category="g.category.value"
        :daily-number="g.daily.value?.number"
        :busy="busy"
        @new-game="g.newFree"
      />
      <LosePanel
        v-if="g.status.value === 'lost' && g.board.value.revealed"
        :target="g.board.value.revealed"
        :mode="g.mode.value"
        :busy="busy"
        @new-game="g.newFree"
      />

      <GuessBoard
        v-if="g.guesses.value.length > 0"
        :category="g.category.value"
        :guesses="g.guesses.value"
        :done="g.status.value !== 'playing'"
      />

      <Legend v-if="g.status.value === 'playing' && g.guesses.value.length === 0" />
    </template>
    <div v-else-if="g.loading.value" class="loading">{{ t('loading') }}</div>

    <FooterBar />
  </div>
</template>
