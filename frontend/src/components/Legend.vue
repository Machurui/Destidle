<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <div class="legend">
    <div class="legend-title">{{ t('legend.title') }}</div>
    <div class="legend-row"><span class="sw hit"></span>{{ t('legend.hit') }}</div>
    <div class="legend-row"><span class="sw near"></span>{{ t('legend.near') }}</div>
    <div class="legend-row"><span class="sw miss"></span>{{ t('legend.miss') }}</div>
    <div class="legend-row"><span class="ar">▲</span>{{ t('legend.later') }}</div>
    <div class="legend-row"><span class="ar">▼</span>{{ t('legend.earlier') }}</div>
  </div>
</template>
