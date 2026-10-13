<script setup lang="ts">
/**
 * Archive list (spec archive §4.3): one row per past daily puzzle of the
 * category, newest first, with the player's result read from local storage.
 * Every row opens its day; a finished day opens frozen (no replay).
 *
 * Dates are `yyyy-MM-dd` calendar days, formatted in UTC so that no
 * timezone shifts them to the previous or next day.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ArchiveDay } from '@/composables/archiveDays'

defineProps<{ days: ArchiveDay[]; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'open', date: string): void }>()
const { t, locale } = useI18n()

/** Mirror of `useGame.MAX_GUESSES`, kept local like in `WinPanel` (pure view). */
const MAX_GUESSES = 8

/** Built once per locale, not once per row per render. */
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
)

function formatDate(date: string): string {
  return dateFormat.value.format(new Date(`${date}T00:00:00Z`))
}

function statusLabel(day: ArchiveDay): string {
  switch (day.status) {
    case 'won':
      return t('archive.won', { n: day.guessCount, max: MAX_GUESSES })
    case 'lost':
      return t('archive.lost')
    case 'playing':
      return t('archive.playing', { n: day.guessCount, max: MAX_GUESSES })
    default:
      return t('archive.new')
  }
}
</script>

<template>
  <section class="archive">
    <div class="archive-title">{{ t('archive.title') }}</div>
    <p v-if="days.length === 0" class="archive-empty">{{ t('archive.empty') }}</p>
    <ul v-else class="archive-list">
      <li v-for="day in days" :key="day.date">
        <button
          type="button"
          class="archive-row"
          :class="day.status"
          :disabled="disabled"
          @click="emit('open', day.date)"
        >
          <span class="archive-num">#{{ day.number }}</span>
          <span class="archive-date">{{ formatDate(day.date) }}</span>
          <span class="archive-status">{{ statusLabel(day) }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
