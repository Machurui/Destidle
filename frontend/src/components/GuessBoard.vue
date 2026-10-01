<script setup lang="ts">
/** Stub (TASK-016 replaces it): contract only, renders the wrapper. */
import type { Category, GuessResult } from '@/lib/api'

defineProps<{ category: Category; guesses: GuessResult[]; done: boolean }>()
</script>

<template>
  <div class="board" />
</template>
