<script setup lang="ts">
/**
 * Briefing line + counters (CT-05, spec §8). The daily number and the streak
 * are daily-only stats: the puzzle number shows when it is known, the streak
 * never shows in free mode.
 */
import { useI18n } from 'vue-i18n'
import type { Category, Mode } from '@/lib/api'

defineProps<{
  category: Category
  mode: Mode
  guessCount: number
  max: number
  poolSize: number
  dailyNumber?: number
  streak: number
}>()
const { t } = useI18n()
</script>

<template>
  <section class="intel">
    <div class="intel-line">
      <span class="intel-tag">{{ t('intel.tag') }}</span>
      <span class="intel-text">{{ category === 'weapon' ? t('intel.briefingWeapon') : t('intel.briefingArmor') }}</span>
    </div>
    <div class="intel-stats">
      <div v-if="mode === 'daily' && dailyNumber !== undefined" class="stat">
        <span class="stat-k">{{ t('intel.day') }}</span><span class="stat-v">#{{ dailyNumber }}</span>
      </div>
      <div class="stat"><span class="stat-k">{{ t('intel.guesses') }}</span><span class="stat-v">{{ guessCount }} / {{ max }}</span></div>
      <div class="stat"><span class="stat-k">{{ t('intel.pool') }}</span><span class="stat-v">{{ poolSize }}</span></div>
      <div class="stat"><span class="stat-k">{{ t('intel.mode') }}</span><span class="stat-v">{{ t(`modes.${mode}`) }}</span></div>
      <div v-if="mode === 'daily'" class="stat"><span class="stat-k">{{ t('intel.streak') }}</span><span class="stat-v">{{ streak }}</span></div>
    </div>
  </section>
</template>
