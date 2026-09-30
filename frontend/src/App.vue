<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'

const { t } = useI18n()
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">◈</span>
        <span class="brand-name">DESTIDLE</span>
        <span class="brand-sub">{{ t('brand.sub') }}</span>
      </div>
      <div class="switches">
        <button class="btn" type="button" @click="setLocale('fr')">FR</button>
        <button class="btn" type="button" @click="setLocale('en')">EN</button>
      </div>
    </header>
  </div>
</template>
