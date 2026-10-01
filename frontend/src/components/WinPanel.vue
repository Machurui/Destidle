<script setup lang="ts">
/**
 * Stub (TASK-016 replaces it). The "new game" button is the only user entry
 * point of `newFree()` (review reservation c); `busy` disables it while a
 * request is in flight (review reservation d).
 */
import { useI18n } from 'vue-i18n'
import type { Category, ItemDisplay, Mode } from '@/lib/api'

defineProps<{
  target: ItemDisplay
  guessCount: number
  mode: Mode
  category: Category
  dailyNumber?: number
  busy?: boolean
}>()
const emit = defineEmits<{ (e: 'new-game'): void }>()
const { t } = useI18n()
</script>

<template>
  <div class="win-panel">
    <div class="win-title">{{ t('win.title') }}</div>
    <div class="win-actions">
      <button
        v-if="mode !== 'daily'"
        type="button"
        class="btn primary"
        :disabled="busy"
        @click="emit('new-game')"
      >
        {{ t('win.new') }}
      </button>
    </div>
  </div>
</template>
