<script setup lang="ts">
/**
 * Exotic name autocomplete (REQ-014, contract CT-05).
 *
 * The query and both item names (FR and EN) go through `norm`, so the match is
 * accent- and case-insensitive whichever language is displayed; items already
 * guessed (`usedIds`) are hidden, the list is capped at 8 rows in the original
 * order, and the active row goes back to the first one on every query change;
 * when the list shrinks without a keystroke (`usedIds` / `items` change) the
 * active row is clamped to its last row.
 * Keyboard: ArrowDown/ArrowUp move the active row (clamped) and scroll the list
 * (never the page) just enough to show it, as does a query change; Enter picks it
 * while the list is shown (after Escape it reopens the list instead of picking
 * an item the user no longer sees), Escape closes the list. The list opens on
 * input or focus and closes on blur, Escape or pick. The dropdown swallows
 * `mousedown` so clicking a row (or the scrollbar) never blurs the input. A
 * pick emits the item id and clears the query. Plain ARIA combobox/listbox
 * wiring, ids from `useId()`.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, ItemSummary } from '@/lib/api'
import { norm } from '@/lib/normalize'

const props = withDefaults(
  defineProps<{ items: ItemSummary[]; usedIds: Set<number>; category?: Category }>(),
  { category: 'weapon' },
)
const emit = defineEmits<{ (e: 'pick', id: number): void }>()
const { t, locale } = useI18n()

/** Rows shown at most (REQ-014). */
const MAX_RESULTS = 8

const q = ref('')
const open = ref(false)
const activeIdx = ref(0)
const listId = useId()
const listEl = ref<HTMLElement | null>(null)

const matches = computed<ItemSummary[]>(() => {
  const nq = norm(q.value)
  if (!nq) return []
  const out: ItemSummary[] = []
  for (const i of props.items) {
    if (props.usedIds.has(i.id)) continue
    if (norm(i.nameEn).includes(nq) || norm(i.nameFr).includes(nq)) {
      out.push(i)
      if (out.length === MAX_RESULTS) break
    }
  }
  return out
})
watch(
  q,
  () => {
    activeIdx.value = 0
    nextTick(revealActive)
  },
  { flush: 'sync' },
)
/** Keeps a row highlighted, and Enter on a visible item, when the list shrinks. */
watch(
  () => matches.value.length,
  (n) => {
    if (activeIdx.value >= n) activeIdx.value = Math.max(0, n - 1)
  },
  { flush: 'sync' },
)

/** `noUncheckedIndexedAccess`: undefined when the list is empty. */
const activeItem = computed(() => matches.value[activeIdx.value])
const expanded = computed(() => open.value && matches.value.length > 0)
const optionId = (id: number) => `${listId}-opt-${id}`
const activeDescendant = computed(() =>
  expanded.value && activeItem.value ? optionId(activeItem.value.id) : undefined,
)

const placeholder = computed(() =>
  t(props.category === 'armor' ? 'search.placeholderArmor' : 'search.placeholderWeapon'),
)
const name = (i: ItemSummary) => (locale.value === 'fr' ? i.nameFr : i.nameEn)
const type = (i: ItemSummary) => (locale.value === 'fr' ? i.typeFr : i.typeEn)
const meta = (i: ItemSummary) => `${i.game} · ${type(i)}`

function onInput(e: Event) {
  q.value = (e.target as HTMLInputElement).value
  open.value = true
}

function move(delta: number) {
  const last = matches.value.length - 1
  if (last < 0) return
  activeIdx.value = Math.min(last, Math.max(0, activeIdx.value + delta))
  nextTick(revealActive)
}

/** Scrolls the list (offsetParent of its rows) just enough to show the active row. */
function revealActive() {
  const list = listEl.value
  const row = list?.children[activeIdx.value] as HTMLElement | undefined
  if (!list || !row) return
  const top = row.offsetTop
  const bottom = top + row.offsetHeight
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
}

function submit(i: ItemSummary | undefined) {
  if (!i) return
  emit('pick', i.id)
  q.value = ''
  open.value = false
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      move(-1)
      break
    case 'Enter':
      e.preventDefault()
      if (!expanded.value) {
        // Closed by Escape: show the list again, never pick an unseen item.
        open.value = true
        break
      }
      submit(activeItem.value)
      break
    case 'Escape':
      open.value = false
      break
  }
}
</script>

<template>
  <div class="search-wrap">
    <div class="search-box">
      <span class="search-glyph">▸</span>
      <input
        type="text"
        autocomplete="off"
        autofocus
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="listId"
        :aria-activedescendant="activeDescendant"
        :value="q"
        :placeholder="placeholder"
        @input="onInput"
        @focus="open = true"
        @blur="open = false"
        @keydown="onKey"
      />
      <span class="search-hint">{{ t('search.enter') }}</span>
    </div>
    <div v-if="expanded" :id="listId" ref="listEl" class="dropdown" role="listbox" @mousedown.prevent>
      <div
        v-for="(m, i) in matches"
        :id="optionId(m.id)"
        :key="m.id"
        class="dd-item"
        :class="{ active: i === activeIdx }"
        role="option"
        :aria-selected="i === activeIdx ? 'true' : 'false'"
        @mouseenter="activeIdx = i"
        @click="submit(m)"
      >
        <span class="dd-left">
          <img v-if="m.iconUrl" class="dd-icon" :src="m.iconUrl" alt="" loading="lazy" />
          <span class="dd-name">{{ name(m) }}</span>
        </span>
        <span class="dd-meta">{{ meta(m) }}</span>
      </div>
    </div>
  </div>
</template>
