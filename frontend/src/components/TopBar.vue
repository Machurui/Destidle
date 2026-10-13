<script setup lang="ts">
/**
 * Top bar (CT-05): brand + three switches (category, mode, locale).
 *
 * The brand is the Orbite logo: the tab icon (public/favicon.svg) followed by the wordmark.
 *
 * `disabled` freezes the category/mode switches while a request is in flight
 * (review reservation d). The locale switch is never disabled: changing the
 * language has no effect on the game state. Clicking the already-active value
 * still emits; the composable ignores no-op changes.
 */
import { useI18n } from 'vue-i18n'
import type { Category, Mode } from '@/lib/api'
import { setLocale } from '@/i18n'

withDefaults(defineProps<{ category: Category; mode: Mode; disabled?: boolean }>(), {
  disabled: false,
})
const emit = defineEmits<{
  (e: 'update:category', v: Category): void
  (e: 'update:mode', v: Mode): void
}>()
const { t, locale } = useI18n()
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <img class="brand-mark" src="/favicon.svg" alt="" width="36" height="36" />
      <span class="brand-name">destidle</span>
      <span class="brand-sub">{{ t('brand.sub') }}</span>
    </div>
    <div class="switches">
      <div class="mode-switch">
        <button
          type="button"
          :class="{ on: category === 'weapon' }"
          :aria-pressed="category === 'weapon'"
          :disabled="disabled"
          @click="emit('update:category', 'weapon')"
        >
          {{ t('categories.weapon') }}
        </button>
        <button
          type="button"
          :class="{ on: category === 'armor' }"
          :aria-pressed="category === 'armor'"
          :disabled="disabled"
          @click="emit('update:category', 'armor')"
        >
          {{ t('categories.armor') }}
        </button>
      </div>
      <div class="mode-switch">
        <button
          type="button"
          :class="{ on: mode === 'daily' }"
          :aria-pressed="mode === 'daily'"
          :disabled="disabled"
          @click="emit('update:mode', 'daily')"
        >
          {{ t('modes.daily') }}
        </button>
        <button
          type="button"
          :class="{ on: mode === 'free' }"
          :aria-pressed="mode === 'free'"
          :disabled="disabled"
          @click="emit('update:mode', 'free')"
        >
          {{ t('modes.free') }}
        </button>
        <button
          type="button"
          :class="{ on: mode === 'archive' }"
          :aria-pressed="mode === 'archive'"
          :disabled="disabled"
          @click="emit('update:mode', 'archive')"
        >
          {{ t('modes.archive') }}
        </button>
      </div>
      <div class="mode-switch">
        <button
          type="button"
          :class="{ on: locale === 'fr' }"
          :aria-pressed="locale === 'fr'"
          @click="setLocale('fr')"
        >
          FR
        </button>
        <button
          type="button"
          :class="{ on: locale === 'en' }"
          :aria-pressed="locale === 'en'"
          @click="setLocale('en')"
        >
          EN
        </button>
      </div>
    </div>
  </header>
</template>
