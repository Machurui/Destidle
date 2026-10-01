<script setup lang="ts">
/**
 * Element glyph + localized name (CT-05). Keys are the English element names
 * sent by the API (`ItemDisplay.element`); unknown elements fall back to `·`
 * and a neutral grey, a null element renders an em dash.
 *
 * SEC-F11: the tables are plain objects, so a bare `GLYPH[element]` would also
 * resolve inherited keys (`constructor`, `__proto__`, `toString`…) and render
 * `function Object() …` or `[object Object]`. `glyph` / `color` only honour
 * own properties. `Object.prototype.hasOwnProperty` is used rather than
 * `Object.hasOwn` (ES2022) because the vitest tsconfig lib does not include it.
 */
defineProps<{ element: string | null; label: string | null }>()

const GLYPH: Readonly<Record<string, string>> = { Kinetic: '◇', Solar: '☼', Arc: '✦', Void: '◯', Stasis: '❅', Strand: '≋' }
const COLOR: Readonly<Record<string, string>> = { Kinetic: '#c9c4b8', Solar: '#ffb347', Arc: '#7ad9ff', Void: '#c79bff', Stasis: '#7fc8ff', Strand: '#76eab0' }

/** Own-property lookup: inherited keys fall back exactly like unknown ones. */
function own(table: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return Object.prototype.hasOwnProperty.call(table, key) ? (table[key] ?? fallback) : fallback
}
const glyph = (element: string) => own(GLYPH, element, '·')
const color = (element: string) => own(COLOR, element, '#bbb')
</script>

<template>
  <span v-if="element" class="el-badge" :style="{ color: color(element) }">
    <span class="el-glyph">{{ glyph(element) }}</span>
    <span class="el-name">{{ label }}</span>
  </span>
  <span v-else>—</span>
</template>
