<script setup lang="ts">
import type { MotionStageFitResult } from '@proj-airi/stage-ui-three/motions'

import type { StageWindowSizeState } from '../../../../shared/eventa/stage-window'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, FieldInput, OverlayButton } from '@proj-airi/ui'
import { useEventListener, useTimeoutFn } from '@vueuse/core'
import { computed, nextTick, onScopeDispose, ref, shallowRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'

import { stageWindowGetSize, stageWindowSetSize } from '../../../../shared/eventa/stage-window'
import { stageOpaqueAttribute } from '../../../composables/use-stage-painted-mask'

const props = defineProps<{
  buttonStyle: string
  iconClass: string
  show: boolean
  /** Present only while the current VRM can accept an explicit camera-fit request. */
  fitMotionStage?: () => MotionStageFitResult
}>()
const emit = defineEmits<{ 'update:show': [show: boolean] }>()
const { t } = useI18n()
const getSize = useElectronEventaInvoke(stageWindowGetSize)
const setSize = useElectronEventaInvoke(stageWindowSetSize)
const state = shallowRef<StageWindowSizeState>()
const width = ref<number>()
const height = ref<number>()
const error = ref(false)
const limited = ref(false)
const fitting = ref(false)
const fitStatus = ref<MotionStageFitResult | 'failed'>()
const headingId = useId()
const opener = ref<InstanceType<typeof ControlButton>>()
const panel = ref<HTMLElement>()
let revision = 0
let readSequence = 0
let pendingSize: { width: number, height: number } | undefined
let applying = false
let applyingRevision = -1
let disposed = false
let heldPointer: { element: HTMLElement, id: number, x: number, y: number, width: number, height: number, zoom: number } | undefined

const validSize = computed(() => Number.isFinite(width.value) && Number.isFinite(height.value) && width.value! > 0 && height.value! > 0)

async function refreshSize() {
  if (!props.show || disposed)
    return false
  const requestRevision = revision
  const requestSequence = ++readSequence
  try {
    const next = await getSize()
    if (disposed || !props.show || requestRevision !== revision || requestSequence !== readSequence)
      return false
    state.value = next
    if (!heldPointer && (!applying || applyingRevision !== revision)) {
      width.value = next.width
      height.value = next.height
    }
    return true
  }
  catch {
    if (!disposed && props.show && requestRevision === revision && requestSequence === readSequence)
      error.value = true
    return false
  }
}

// Native Wayland resizing is asynchronous and some compositors reject it. Compare the actual accepted size after settlement.
let requestedSize: { width: number, height: number } | undefined
const { start: checkAcceptedSize, stop: stopSizeCheck } = useTimeoutFn(async () => {
  const expected = requestedSize
  const requestRevision = revision
  const refreshed = await refreshSize()
  if (refreshed && expected && expected === requestedSize && requestRevision === revision && state.value && props.show)
    limited.value = Math.abs(state.value.width - expected.width) > 1 || Math.abs(state.value.height - expected.height) > 1
}, 500, { immediate: false })

async function applyPendingSize() {
  if (applying)
    return
  applying = true
  let lastRevision = revision
  try {
    while (pendingSize) {
      if (disposed || !props.show)
        break
      const size = pendingSize
      const requestRevision = revision
      lastRevision = requestRevision
      applyingRevision = requestRevision
      pendingSize = undefined
      try {
        await setSize(size)
      }
      catch {
        // A closed panel cannot discard a resize queued by a later panel session.
        if (!disposed && props.show && requestRevision === revision)
          error.value = true
      }
    }
  }
  finally {
    applying = false
    if (!disposed && props.show && lastRevision === revision)
      checkAcceptedSize()
  }
}

function resizeTo(nextWidth: number, nextHeight: number) {
  if (!state.value || !Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0)
    return
  const next = {
    width: Math.round(Math.min(state.value.maxWidth, Math.max(state.value.minWidth, nextWidth))),
    height: Math.round(Math.min(state.value.maxHeight, Math.max(state.value.minHeight, nextHeight))),
  }
  width.value = next.width
  height.value = next.height
  error.value = false
  limited.value = false
  requestedSize = next
  pendingSize = next
  void applyPendingSize()
}

// A double click must not fit the same camera twice before the new view settles.
const { start: startFitCooldown, stop: stopFitCooldown } = useTimeoutFn(() => {
  fitting.value = false
}, 300, { immediate: false })

function fitModelForMotion() {
  const fit = props.fitMotionStage
  if (!props.show || !fit || fitting.value)
    return
  const requestRevision = revision
  fitting.value = true
  fitStatus.value = undefined
  try {
    const result = fit()
    if (props.show && requestRevision === revision && props.fitMotionStage === fit)
      fitStatus.value = result
  }
  catch {
    if (props.show && requestRevision === revision && props.fitMotionStage === fit)
      fitStatus.value = 'failed'
  }
  finally {
    if (props.show && requestRevision === revision && props.fitMotionStage === fit)
      startFitCooldown()
  }
}

watch(() => props.fitMotionStage, () => {
  stopFitCooldown()
  fitting.value = false
  fitStatus.value = undefined
}, { flush: 'sync' })

function releasePointer() {
  const held = heldPointer
  heldPointer = undefined
  if (held?.element.hasPointerCapture(held.id))
    held.element.releasePointerCapture(held.id)
}

function startResize(event: PointerEvent) {
  if (event.button !== 0 || !state.value)
    return
  event.preventDefault()
  releasePointer()
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  heldPointer = {
    element,
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: state.value.width,
    height: state.value.height,
    zoom: state.value.zoomFactor,
  }
}

function moveResize(event: PointerEvent) {
  if (!heldPointer || heldPointer.id !== event.pointerId)
    return
  if (event.buttons === 0) {
    releasePointer()
    return
  }
  // Client distances remain available on Wayland. Page zoom converts CSS pixels to DIP, without applying display scale twice.
  resizeTo(
    heldPointer.width + (event.clientX - heldPointer.x) * heldPointer.zoom,
    heldPointer.height + (event.clientY - heldPointer.y) * heldPointer.zoom,
  )
}

function resizeByKeyboard(event: KeyboardEvent) {
  const step = event.shiftKey ? 64 : 16
  const x = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
  const y = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
  if ((!x && !y) || !state.value)
    return
  event.preventDefault()
  resizeTo((width.value ?? state.value.width) + x, (height.value ?? state.value.height) + y)
}

function close() {
  emit('update:show', false)
  void nextTick(() => {
    if (!props.show)
      (opener.value?.$el as HTMLElement | undefined)?.focus()
  })
}

watch(() => props.show, async (show) => {
  revision += 1
  const focusRevision = revision
  releasePointer()
  pendingSize = undefined
  requestedSize = undefined
  stopSizeCheck()
  stopFitCooldown()
  fitting.value = false
  fitStatus.value = undefined
  error.value = false
  limited.value = false
  if (show) {
    state.value = undefined
    width.value = undefined
    height.value = undefined
    const refreshed = await refreshSize()
    await nextTick()
    if (refreshed && props.show && focusRevision === revision)
      panel.value?.focus()
  }
}, { immediate: true })
useEventListener(window, 'resize', refreshSize)
useEventListener(window, 'blur', releasePointer)
useEventListener(window, 'keydown', (event) => {
  if (props.show && event.key === 'Escape') {
    event.preventDefault()
    close()
  }
})
onScopeDispose(() => {
  disposed = true
  revision += 1
  pendingSize = undefined
  releasePointer()
  stopSizeCheck()
  stopFitCooldown()
})
</script>

<template>
  <ControlButtonTooltip side="inward" as-child>
    <ControlButton
      ref="opener"
      :button-style="props.buttonStyle"
      :aria-label="t('tamagotchi.stage.stage-size.title')"
      :aria-expanded="props.show"
      @click="emit('update:show', !props.show)"
    >
      <div :class="[props.iconClass, 'i-ph:arrows-out-simple', 'text-neutral-800 dark:text-neutral-300']" />
    </ControlButton>
    <template #tooltip>
      {{ t('tamagotchi.stage.stage-size.title') }}
    </template>
  </ControlButtonTooltip>
  <Teleport to="body">
    <template v-if="props.show">
      <div :class="['pointer-events-none fixed inset-1 z-50 rounded-xl border-2 border-dashed border-primary-500/80']" />
      <section
        ref="panel"
        role="dialog"
        tabindex="-1"
        :aria-labelledby="headingId"
        :[stageOpaqueAttribute]="true"
        :class="[
          'fixed bottom-14 left-3 z-50 w-76 max-w-[calc(100vw-24px)] max-h-[calc(100vh-72px)] overflow-auto rounded-xl p-3',
          'flex flex-col gap-3 shadow-lg outline-none',
          'bg-white/95 text-neutral-900 dark:bg-neutral-900/95 dark:text-neutral-100',
        ]"
      >
        <div :class="['flex items-center justify-between gap-2']">
          <h2 :id="headingId" :class="['text-sm font-semibold']">
            {{ t('tamagotchi.stage.stage-size.title') }}
          </h2>
          <Button size="sm" :aria-label="t('tamagotchi.stage.stage-size.done')" @click="close">
            {{ t('tamagotchi.stage.stage-size.done') }}
          </Button>
        </div>
        <p :class="['text-xs text-neutral-600 dark:text-neutral-300']">
          {{ t('tamagotchi.stage.stage-size.description') }}
        </p>
        <p v-if="state" :class="['text-xs tabular-nums']" aria-live="polite">
          {{ t('tamagotchi.stage.stage-size.current', { width: state.width, height: state.height }) }}
        </p>
        <div :class="['grid grid-cols-2 gap-2']">
          <FieldInput v-model="width" type="number" :disabled="!state" :label="t('tamagotchi.stage.stage-size.width')" />
          <FieldInput v-model="height" type="number" :disabled="!state" :label="t('tamagotchi.stage.stage-size.height')" />
        </div>
        <div :class="['flex flex-wrap gap-2']">
          <Button size="sm" :disabled="!state || !validSize" @click="resizeTo(width!, height!)">
            {{ t('tamagotchi.stage.stage-size.apply') }}
          </Button>
          <Button size="sm" :disabled="!state" @click="resizeTo(960, 720)">
            {{ t('tamagotchi.stage.stage-size.wide') }}
          </Button>
          <Button size="sm" :disabled="!state" @click="resizeTo(450, 600)">
            {{ t('tamagotchi.stage.stage-size.reset') }}
          </Button>
        </div>
        <div :class="['flex flex-col gap-2']">
          <Button size="sm" :disabled="!props.fitMotionStage || fitting" @click="fitModelForMotion">
            {{ t('tamagotchi.stage.stage-size.fit') }}
          </Button>
          <p :class="['text-xs text-neutral-600 dark:text-neutral-300']">
            {{ t('tamagotchi.stage.stage-size.fit-description') }}
          </p>
          <p v-if="!props.fitMotionStage" :class="['text-xs text-neutral-600 dark:text-neutral-300']">
            {{ t('tamagotchi.stage.stage-size.fit-not-ready') }}
          </p>
          <p v-if="fitStatus" role="status" :class="['text-xs text-neutral-600 dark:text-neutral-300']">
            {{ t(`tamagotchi.stage.stage-size.fit-result.${fitStatus}`) }}
          </p>
        </div>
        <p v-if="state?.wayland || limited" :class="['text-xs text-neutral-600 dark:text-neutral-300']">
          {{ t('tamagotchi.stage.stage-size.native-hint') }}
        </p>
        <p v-if="error" role="alert" :class="['text-xs text-red-600 dark:text-red-300']">
          {{ t('tamagotchi.stage.stage-size.error') }}
        </p>
      </section>
      <OverlayButton
        :[stageOpaqueAttribute]="true"
        :aria-label="t('tamagotchi.stage.stage-size.grip')"
        :title="t('tamagotchi.stage.stage-size.grip')"
        :disabled="!state"
        :class="['fixed bottom-3 right-3 z-50 size-9 touch-none cursor-nwse-resize select-none p-2!']"
        @pointerdown="startResize"
        @pointermove="moveResize"
        @pointerup="releasePointer"
        @pointercancel="releasePointer"
        @lostpointercapture="releasePointer"
        @keydown="resizeByKeyboard"
      >
        <div :class="['i-lucide:move-diagonal-2 size-5']" />
      </OverlayButton>
    </template>
  </Teleport>
</template>
