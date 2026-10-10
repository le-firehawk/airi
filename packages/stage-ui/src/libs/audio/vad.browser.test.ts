import type { BaseVAD } from './vad'

import { afterEach, describe, expect, it, vi } from 'vitest'

import vadAudioWorkletUrl from '../../workers/vad/process.worklet?worker&url'

import { createVADStates } from './vad'

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
  vi.restoreAllMocks()
})

function createVADMock(): BaseVAD {
  return {
    initialize: vi.fn(async () => {}),
    processAudio: vi.fn(async () => {}),
    on: vi.fn(),
    off: vi.fn(),
  }
}

function createStream() {
  const context = new AudioContext({ sampleRate: 16000 })
  const destination = context.createMediaStreamDestination()
  const oscillator = context.createOscillator()
  oscillator.connect(destination)
  oscillator.start()
  cleanups.push(async () => {
    oscillator.stop()
    for (const track of destination.stream.getTracks())
      track.stop()
    await context.close()
  })
  return destination.stream
}

describe('createVADStates', () => {
  it('does not stop the caller-owned microphone stream when disposing VAD nodes', async () => {
    const stream = createStream()
    const track = stream.getAudioTracks()[0]
    const stop = vi.spyOn(track, 'stop')
    const manager = createVADStates(createVADMock(), vadAudioWorkletUrl)
    cleanups.push(() => manager.dispose())
    await manager.initialize()
    await manager.start(stream)
    manager.dispose()

    expect(stop).not.toHaveBeenCalled()
    expect(track.readyState).toBe('live')
  })

  it('disconnects the previous microphone source before starting a new graph', async () => {
    const stream = createStream()
    const createSource = vi.spyOn(AudioContext.prototype, 'createMediaStreamSource')
    const manager = createVADStates(createVADMock(), vadAudioWorkletUrl)
    cleanups.push(() => manager.dispose())
    await manager.initialize()
    await manager.start(stream)
    const firstResult = createSource.mock.results[0]
    if (firstResult.type !== 'return')
      throw new Error('The first audio source was not created')
    const firstSource = firstResult.value
    const firstDisconnect = vi.spyOn(firstSource, 'disconnect')
    await manager.start(stream)
    const secondResult = createSource.mock.results[1]
    if (secondResult.type !== 'return')
      throw new Error('The second audio source was not created')
    const secondSource = secondResult.value

    expect(createSource).toHaveBeenCalledTimes(2)
    expect(firstDisconnect).toHaveBeenCalledTimes(1)
    expect(secondSource).not.toBe(firstSource)
    expect(secondSource.mediaStream).toBe(stream)
  })
})
