import type { MotionStageFitResult } from '@proj-airi/stage-ui-three/motions'

import type { StageWindowSizeState } from '../../../../shared/eventa/stage-window'

import en from '@proj-airi/i18n/locales/en'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import ControlsIslandStageSize from './controls-island-stage-size.vue'

import { stageWindowGetSize } from '../../../../shared/eventa/stage-window'
import { controlsIslandPlacementKey } from './use-controls-island-placement'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const native = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: unknown) => event === stageWindowGetSize ? native.get : native.set,
}))

const initialState: StageWindowSizeState = {
  width: 450,
  height: 600,
  minWidth: 280,
  minHeight: 320,
  maxWidth: 1920,
  maxHeight: 1040,
  zoomFactor: 1.25,
  wayland: false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mountResize(fitAction = shallowRef<(() => MotionStageFitResult) | undefined>()) {
  const show = ref(false)
  const screen = render(defineComponent({
    setup: () => () => h(ControlsIslandStageSize, {
      'buttonStyle': 'p-2',
      'iconClass': 'size-5',
      'show': show.value,
      'fitMotionStage': fitAction.value,
      'onUpdate:show': (value: boolean) => { show.value = value },
    }),
  }), {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      provide: {
        [controlsIslandPlacementKey as symbol]: { dock: ref('top-left'), isTop: ref(true), isLeft: ref(true), motionPhase: ref('idle') },
      },
    },
  })
  return { show, screen, fitAction }
}

async function openResize() {
  await page.getByRole('button', { name: 'Resize stage', exact: true }).click()
  await expect.element(page.getByLabelText('Width', { exact: true })).toBeEnabled()
}

beforeEach(async () => {
  native.get.mockReset().mockResolvedValue({ ...initialState })
  native.set.mockReset().mockImplementation(async (size: { width: number, height: number }) => ({ ...initialState, ...size }))
  await page.viewport(450, 600)
})

describe('manual stage size controls', () => {
  it('opens an outlined sizing area and clamps a submitted size to the logical work area', async () => {
    const { show } = mountResize()
    await openResize()
    expect(show.value).toBe(true)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await page.getByLabelText('Width', { exact: true }).fill('5000')
    await page.getByLabelText('Height', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    expect(native.set).toHaveBeenCalledWith({ width: 1920, height: 320 })
    await userEvent.keyboard('{Escape}')
    expect(show.value).toBe(false)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Resize stage', exact: true })).toHaveFocus()
  })

  it('rejects blank dimensions and offers a wider real stage', async () => {
    mountResize()
    await openResize()
    await page.getByLabelText('Width', { exact: true }).fill('')
    await expect.element(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Room to move', exact: true }).click()
    expect(native.set).toHaveBeenCalledWith({ width: 960, height: 720 })
  })

  it('never fits the camera implicitly on open, resize, or close', async () => {
    const fit = vi.fn(() => 'applied' as const)
    mountResize(shallowRef(fit))
    await openResize()
    await page.getByRole('button', { name: 'Room to move', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    expect(fit).not.toHaveBeenCalled()
  })

  it('requires a ready fit owner and reports an explicit fit only once for rapid repeat clicks', async () => {
    const { fitAction } = mountResize()
    await openResize()
    const button = page.getByRole('button', { name: 'Fit model for motion', exact: true })
    await expect.element(button).toBeDisabled()
    const fit = vi.fn(() => 'applied' as const)
    fitAction.value = fit
    await nextTick()
    await expect.element(button).toBeEnabled()
    const element = button.element() as HTMLButtonElement
    element.click()
    element.click()
    await nextTick()
    expect(fit).toHaveBeenCalledTimes(1)
    await expect.element(button).toBeDisabled()
    await expect.element(page.getByRole('status')).toHaveTextContent('View fitted for motion.')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await openResize()
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  })

  it.each([
    ['not-ready', 'The VRM model is not ready.'],
    ['insufficient-room', 'The model cannot fit safely in this view.'],
  ] as const)('reports %s without claiming a successful fit', async (result, message) => {
    const fit = vi.fn(() => result)
    mountResize(shallowRef(fit))
    await openResize()
    await page.getByRole('button', { name: 'Fit model for motion', exact: true }).click()
    expect(fit).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('status')).toHaveTextContent(message)
  })

  it('clears the fit result when the ready owner changes and rejects the missing owner', async () => {
    const fit = vi.fn(() => 'applied' as const)
    const { fitAction } = mountResize(shallowRef<(() => MotionStageFitResult) | undefined>(fit))
    await openResize()
    await page.getByRole('button', { name: 'Fit model for motion', exact: true }).click()
    fitAction.value = undefined
    await nextTick()
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Fit model for motion', exact: true })).toBeDisabled()
    expect(fit).toHaveBeenCalledTimes(1)
  })

  it('discards feedback if a synchronous fit invalidates its model owner', async () => {
    const action = shallowRef<(() => MotionStageFitResult) | undefined>()
    action.value = () => {
      action.value = undefined
      return 'applied'
    }
    mountResize(action)
    await openResize()
    await page.getByRole('button', { name: 'Fit model for motion', exact: true }).click()
    await nextTick()
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Fit model for motion', exact: true })).toBeDisabled()
  })

  it('captures a real grip drag and converts client-coordinate movement through page zoom exactly once', async () => {
    mountResize()
    await openResize()
    const grip = page.getByRole('button', { name: /^Drag to resize the stage/ }).element()
    const target = document.createElement('div')
    target.style.cssText = 'position: fixed; left: 355px; top: 505px; width: 10px; height: 10px;'
    document.body.append(target)
    const movement: { start?: PointerEvent, last?: PointerEvent, captured: boolean } = { captured: false }
    const recordStart = (event: Event) => {
      if (!(event instanceof PointerEvent))
        return
      movement.start = event
      movement.captured = grip.hasPointerCapture(event.pointerId)
    }
    const recordMove = (event: Event) => {
      if (event instanceof PointerEvent && event.buttons === 1)
        movement.last = event
    }
    grip.addEventListener('pointerdown', recordStart)
    grip.addEventListener('pointermove', recordMove)
    try {
      await userEvent.dragAndDrop(grip, target)
      expect(movement.captured).toBe(true)
      expect(movement.start).toBeDefined()
      expect(movement.last).toBeDefined()
      const expected = {
        width: Math.round(initialState.width + (movement.last!.clientX - movement.start!.clientX) * initialState.zoomFactor),
        height: Math.round(initialState.height + (movement.last!.clientY - movement.start!.clientY) * initialState.zoomFactor),
      }
      await expect.poll(() => native.set.mock.calls.at(-1)?.[0]).toEqual(expected)
      expect(grip.hasPointerCapture(movement.start!.pointerId)).toBe(false)
    }
    finally {
      grip.removeEventListener('pointerdown', recordStart)
      grip.removeEventListener('pointermove', recordMove)
      target.remove()
    }
  })

  it.each(['blur', 'pointercancel'] as const)('releases a real captured grip on %s without resizing afterward', async (reason) => {
    mountResize()
    await openResize()
    const grip = page.getByRole('button', { name: /^Drag to resize the stage/ }).element()
    const target = document.createElement('div')
    target.style.cssText = 'position: fixed; left: 355px; top: 505px; width: 10px; height: 10px;'
    document.body.append(target)
    let pointerId: number | undefined
    let capturedBeforeCancel = false
    const cancel = (event: Event) => {
      if (!(event instanceof PointerEvent))
        return
      pointerId = event.pointerId
      capturedBeforeCancel = grip.hasPointerCapture(pointerId)
      if (reason === 'blur')
        window.dispatchEvent(new Event('blur'))
      else
        grip.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }))
    }
    grip.addEventListener('pointerdown', cancel)
    try {
      await userEvent.dragAndDrop(grip, target)
      expect(capturedBeforeCancel).toBe(true)
      expect(pointerId).toBeDefined()
      expect(grip.hasPointerCapture(pointerId!)).toBe(false)
      expect(native.set).not.toHaveBeenCalled()
    }
    finally {
      grip.removeEventListener('pointerdown', cancel)
      target.remove()
    }
  })

  it('coalesces keyboard resize requests while preserving the latest desired dimensions', async () => {
    const first = deferred<StageWindowSizeState>()
    native.set.mockImplementationOnce(() => first.promise)
    mountResize()
    await openResize()
    const grip = page.getByRole('button', { name: /^Drag to resize the stage/ }).element()
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(native.set).toHaveBeenCalledTimes(1)
    first.resolve({ ...initialState, width: 466 })
    await expect.poll(() => native.set.mock.calls.length).toBe(2)
    expect(native.set).toHaveBeenLastCalledWith({ width: 530, height: 616 })
  })

  it('keeps a reopened panel request when an old resize fails', async () => {
    const first = deferred<StageWindowSizeState>()
    native.set.mockImplementationOnce(() => first.promise)
    mountResize()
    await openResize()
    await page.getByRole('button', { name: 'Room to move', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await openResize()
    await page.getByLabelText('Width', { exact: true }).fill('700')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    first.reject(new Error('Old compositor request failed'))
    await expect.poll(() => native.set.mock.calls.length).toBe(2)
    expect(native.set).toHaveBeenLastCalledWith({ width: 700, height: 600 })
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores an old initial-size failure after closing and reopening', async () => {
    const first = deferred<StageWindowSizeState>()
    native.get.mockImplementationOnce(() => first.promise)
    mountResize()
    await page.getByRole('button', { name: 'Resize stage', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await openResize()
    await page.getByLabelText('Width', { exact: true }).click()
    first.reject(new Error('Old size read failed'))
    await nextTick()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(page.getByLabelText('Width', { exact: true })).toBeEnabled()
    await expect.element(page.getByLabelText('Width', { exact: true })).toHaveFocus()
  })

  it('does not restore a closed panel when its initial size arrives late', async () => {
    const first = deferred<StageWindowSizeState>()
    native.get.mockImplementationOnce(() => first.promise)
    const { show } = mountResize()
    await page.getByRole('button', { name: 'Resize stage', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    first.resolve(initialState)
    await nextTick()
    expect(show.value).toBe(false)
    expect(native.set).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows compositor guidance and keeps the panel reachable on a small viewport', async () => {
    native.get.mockResolvedValue({ ...initialState, wayland: true, maxWidth: 280, maxHeight: 320 })
    await page.viewport(280, 320)
    mountResize()
    await openResize()
    const panel = page.getByRole('dialog').element()
    const bounds = panel.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(280)
    expect(bounds.bottom).toBeLessThanOrEqual(320)
    await expect.element(page.getByText(/On KDE, press Alt\+F3/)).toBeVisible()
  })
})
