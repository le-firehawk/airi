<script setup lang="ts">
import { HearingConfigDialog } from '@proj-airi/stage-ui/components'
import { useAudioAnalyzer, useAudioContextFromStream } from '@proj-airi/stage-ui/composables'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, watch } from 'vue'

const show = defineModel('show', { type: Boolean, default: false })

const hearingStore = useHearingStore()
const settingsAudioDeviceStore = useSettingsAudioDevice()
const { autoSendEnabled } = storeToRefs(hearingStore)
const { enabled, stream } = storeToRefs(settingsAudioDeviceStore)

const { audioContext, initialize, dispose, pause } = useAudioContextFromStream(stream)
const { volumeLevel, startAnalyzer, stopAnalyzer } = useAudioAnalyzer()

// useSettingsAudioDevice owns the microphone lifecycle through persisted enabled state.
// Calling startStream or stopStream here recreated streams while transcription still used the old
// session, leaving VAD active without transcripts.
// This component only observes the current stream for analyzer display.
watch([enabled, stream], ([isEnabled, currentStream]) => {
  if (isEnabled && currentStream) {
    initialize().then(() => {
      if (audioContext.value)
        return startAnalyzer(audioContext.value)
    })
  }
  else {
    stopAnalyzer()
    pause()
  }
}, { immediate: true })

onMounted(async () => {
  if (audioContext.value) {
    await startAnalyzer(audioContext.value)
  }
})

onUnmounted(async () => {
  await stopAnalyzer()
  await dispose()
})
</script>

<template>
  <HearingConfigDialog
    v-model:show="show"
    v-model:auto-send="autoSendEnabled"
    :volume-level="volumeLevel"
  >
    <slot />
  </HearingConfigDialog>
</template>
