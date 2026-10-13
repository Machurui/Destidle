<script setup lang="ts">
/**
 * Defeat panel (REQ-012, CT-05): "// TARGET ESCAPED" and the revealed
 * target with its meta line. No share text in defeat (out of the Task 16
 * scope). The "retry" button is the only user entry point of `newFree()`
 * (review reservation c) and exists in free mode only; in archive mode a
 * "← ARCHIVE" button (`back`) returns to the list of days. `busy` disables
 * both while a request is in flight (review reservation d).
 *
 * SEC-F8: `target.lightGgUrl` may come back from localStorage unchanged, so
 * the link is only rendered for an absolute `https://www.light.gg/` URL.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ItemDisplay, Mode } from '@/lib/api'
import ElementBadge from './ElementBadge.vue'

const props = defineProps<{ target: ItemDisplay; mode: Mode; busy?: boolean }>()
const emit = defineEmits<{ (e: 'new-game'): void; (e: 'back'): void }>()
const { t, locale } = useI18n()

const L = (en: string | null, fr: string | null) => (locale.value === 'fr' ? fr : en) ?? ''

const lightGgUrl = computed(() => safeLightGgUrl(props.target.lightGgUrl))

/** SEC-F8: only an absolute https URL on www.light.gg is trusted (case-sensitive). */
function safeLightGgUrl(url: string | null): string | null {
  return typeof url === 'string' && url.startsWith('https://www.light.gg/') ? url : null
}
</script>

<template>
  <div class="win-panel loss">
    <div class="win-title danger">{{ t('lose.title') }}</div>
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
    <div class="win-actions">
      <button
        v-if="mode === 'free'"
        type="button"
        class="btn primary"
        :disabled="busy"
        @click="emit('new-game')"
      >
        {{ t('lose.retry') }}
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
