<script setup lang="ts">
/**
 * Pixelated splash + 10-tick signal bar (REQ-010, CT-05). `level` is the
 * pixelation level 0..9 (9 = sharp): tick `i` lights up when `i - 1 <= level`,
 * so level 0 shows one tick and level 9 all ten; the frame glows at level 9.
 * Upscaling (`image-rendering: pixelated`) comes from `.splash-canvas` in main.css.
 */
defineProps<{ src: string | null; level: number }>()
</script>

<template>
  <div class="splash-stage">
    <div class="splash-frame" :class="{ revealed: level >= 9 }" style="width: 360px; height: 360px">
      <img v-if="src" :src="src" class="splash-canvas" alt="" draggable="false" />
      <div class="splash-corners">
        <span class="cnr tl"></span><span class="cnr tr"></span>
        <span class="cnr bl"></span><span class="cnr br"></span>
      </div>
      <div class="splash-overlay">
        <span class="splash-tag">SIGNAL</span>
        <span class="splash-bar">
          <span v-for="i in 10" :key="i" class="bar-tick" :class="{ on: i - 1 <= level }"></span>
        </span>
      </div>
    </div>
  </div>
</template>
