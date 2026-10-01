<script setup lang="ts">
/**
 * Stub (TASK-016 replaces it). The "retry" button is the only user entry
 * point of `newFree()` (review reservation c); `busy` disables it while a
 * request is in flight (review reservation d).
 */
import { useI18n } from 'vue-i18n'
import type { ItemDisplay, Mode } from '@/lib/api'

defineProps<{ target: ItemDisplay; mode: Mode; busy?: boolean }>()
const emit = defineEmits<{ (e: 'new-game'): void }>()
const { t } = useI18n()
</script>

<template>
  <div class="win-panel loss">
    <div class="win-title danger">{{ t('lose.title') }}</div>
    <div class="win-actions">
      <button
        v-if="mode !== 'daily'"
        type="button"
        class="btn primary"
        :disabled="busy"
        @click="emit('new-game')"
      >
        {{ t('lose.retry') }}
      </button>
    </div>
  </div>
</template>
