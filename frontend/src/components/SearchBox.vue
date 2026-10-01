<script setup lang="ts">
/** Stub (TASK-016 replaces it): contract only, renders the wrapper. */
import type { Category, ItemSummary } from '@/lib/api'

defineProps<{ items: ItemSummary[]; usedIds: Set<number>; category?: Category }>()
defineEmits<{ (e: 'pick', id: number): void }>()
</script>

<template>
  <div class="search-wrap" />
</template>
