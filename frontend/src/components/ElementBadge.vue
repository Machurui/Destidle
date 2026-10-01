<script setup lang="ts">
/**
 * Element glyph + localized name (CT-05). Keys are the English element names
 * sent by the API (`ItemDisplay.element`); unknown elements fall back to `·`
 * and a neutral grey, a null element renders an em dash.
 */
defineProps<{ element: string | null; label: string | null }>()
const GLYPH: Record<string, string> = { Kinetic: '◇', Solar: '☼', Arc: '✦', Void: '◯', Stasis: '❅', Strand: '≋' }
const COLOR: Record<string, string> = { Kinetic: '#c9c4b8', Solar: '#ffb347', Arc: '#7ad9ff', Void: '#c79bff', Stasis: '#7fc8ff', Strand: '#76eab0' }
</script>

<template>
  <span v-if="element" class="el-badge" :style="{ color: COLOR[element] ?? '#bbb' }">
    <span class="el-glyph">{{ GLYPH[element] ?? '·' }}</span>
    <span class="el-name">{{ label }}</span>
  </span>
  <span v-else>—</span>
</template>
