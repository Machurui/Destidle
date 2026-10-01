<script setup lang="ts">
/** Stub (TASK-016 replaces it): contract only, renders the wrapper. */
import type { Category, GuessResult } from '@/lib/api'

defineProps<{ result: GuessResult; category: Category; isLatest: boolean }>()
</script>

<template>
  <div class="guess-row" />
</template>
