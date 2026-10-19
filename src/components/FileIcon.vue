<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { fileIconUrl, folderIconUrl, loadFileIcons } from '@/lib/fileIcons'

const props = defineProps<{ path: string; folder?: boolean; open?: boolean; size?: number }>()

onMounted(loadFileIcons)

const src = computed(() => (props.folder ? folderIconUrl(props.path, !!props.open) : fileIconUrl(props.path)))
const px = computed(() => `${props.size ?? 14}px`)
</script>

<template>
  <!-- Until the icon set loads, an empty box of the same size keeps rows from shifting. -->
  <img v-if="src" class="file-icon" :src="src" alt="" draggable="false" />
  <span v-else class="file-icon" />
</template>

<style scoped>
.file-icon {
  display: inline-block;
  flex: none;
  width: v-bind(px);
  height: v-bind(px);
}
</style>
