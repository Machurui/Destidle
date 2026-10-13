<script setup lang="ts">
/**
 * Victory panel (REQ-012 / REQ-016, CT-05): "// TARGET ACQUIRED", the found
 * target with its meta line, the ▰▱ result blocks and the share button.
 * The "new game" button is the only user entry point of `newFree()` (review
 * reservation c) and exists in free mode only; in archive mode a "← ARCHIVE"
 * button (`back`) returns to the list of days. `busy` disables both while a
 * request is in flight (review reservation d).
 *
 * Share text (spec §8, REQ-016): the `DESTIDLE #N — CAT` header for a
 * dated puzzle (daily or archive day), the free-play one otherwise, the localized "solved in X guesses" line and the blocks —
 * never the target name, which would spoil the daily for whoever reads it.
 *
 * SEC-F8: `target.lightGgUrl` may come back from localStorage unchanged, so
 * the link is only rendered for an absolute `https://www.light.gg/` URL.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, ItemDisplay, Mode } from '@/lib/api'
import ElementBadge from './ElementBadge.vue'

const props = defineProps<{
  target: ItemDisplay
  guessCount: number
  mode: Mode
  category: Category
  dailyNumber?: number
  busy?: boolean
}>()
const emit = defineEmits<{ (e: 'new-game'): void; (e: 'back'): void }>()
const { t, locale } = useI18n()

/**
 * Mirror of `useGame.MAX_GUESSES` (8 guesses per puzzle, spec §7), kept
 * local so this panel stays a pure view with no composable dependency.
 */
const MAX_GUESSES = 8
/** How long the share button reads "copied" after a successful copy. */
const COPIED_MS = 2000

const L = (en: string | null, fr: string | null) => (locale.value === 'fr' ? fr : en) ?? ''

const blocks = computed(
  () => '▰'.repeat(props.guessCount) + '▱'.repeat(Math.max(0, MAX_GUESSES - props.guessCount)),
)
const solvedLine = computed(() => t('win.solved', { n: props.guessCount }, props.guessCount))
const shareText = computed(() => {
  const cat = t(`categories.${props.category}`)
  const head =
    props.mode !== 'free' && props.dailyNumber !== undefined
      ? t('share.daily', { n: props.dailyNumber, cat })
      : t('share.free', { cat })
  return `${head}\n${solvedLine.value}\n${blocks.value}`
})
const lightGgUrl = computed(() => safeLightGgUrl(props.target.lightGgUrl))

/** SEC-F8: only an absolute https URL on www.light.gg is trusted (case-sensitive). */
function safeLightGgUrl(url: string | null): string | null {
  return typeof url === 'string' && url.startsWith('https://www.light.gg/') ? url : null
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

/** Copies the share text; `copied` only turns on when the write succeeded. */
async function copy() {
  try {
    // `navigator.clipboard` is undefined in insecure contexts and in jsdom.
    const clipboard = navigator.clipboard
    if (!clipboard) return
    await clipboard.writeText(shareText.value)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = undefined
    }, COPIED_MS)
  } catch {
    /* clipboard unavailable or denied: silent, the label stays "copy" */
  }
}

onBeforeUnmount(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="win-panel">
    <div class="win-title">{{ t('win.title') }}</div>
    <div class="win-target">{{ L(target.nameEn, target.nameFr) }}</div>
    <div class="win-meta">
      <span>{{ target.game }}</span><span>·</span>
      <span>{{ L(target.typeEn, target.typeFr) }}</span>
      <template v-if="target.element">
        <span>·</span><ElementBadge :element="target.element" :label="L(target.elementEn, target.elementFr)" />
      </template>
      <template v-if="target.classEn">
        <span>·</span><span>{{ L(target.classEn, target.classFr) }}</span>
      </template>
      <span>·</span><span>{{ L(target.seasonEn, target.seasonFr) }}</span>
      <template v-if="lightGgUrl">
        <span>·</span>
        <a
          :href="lightGgUrl"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('win.more')"
          style="color: var(--color-accent)"
        >light.gg ↗</a>
      </template>
    </div>
    <div class="win-blocks">{{ blocks }}</div>
    <div class="win-line">{{ solvedLine }}</div>
    <div class="win-actions">
      <button type="button" class="btn" @click="copy">{{ copied ? t('win.copied') : t('win.copy') }}</button>
      <button
        v-if="mode === 'free'"
        type="button"
        class="btn primary"
        :disabled="busy"
        @click="emit('new-game')"
      >
        {{ t('win.new') }}
      </button>
      <button
        v-else-if="mode === 'archive'"
        type="button"
        class="btn primary"
        :disabled="busy"
        @click="emit('back')"
      >
        {{ t('archive.back') }}
      </button>
    </div>
  </div>
</template>
