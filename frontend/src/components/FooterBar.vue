<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <footer class="footer">
    <span>{{ t('footer.data') }}</span>
    <span>{{ t('footer.built') }}</span>
  </footer>
</template>
