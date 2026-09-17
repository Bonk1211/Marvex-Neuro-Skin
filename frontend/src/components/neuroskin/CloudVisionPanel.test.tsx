import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CloudVisionPanel } from './CloudVisionPanel'
import { detectClouds, type CloudResult } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({ detectClouds: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('loops the feed, schedules non-overlapping scans, and expires brain observations', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-10T04:00:00Z'))
  const started = Date.now()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - started)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2)
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
    1920
  )
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(
    1080
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/jpeg;base64,frame'
  )
  const result: CloudResult = {
    width: 960,
    height: 540,
    cloud_cover: 0.6,
    detections: [
      {
        confidence: 0.9,
      },
    ],
  }
  let finish!: (value: CloudResult) => void
  vi.mocked(detectClouds).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const onObservation = vi.fn().mockResolvedValue('Brain updated')
  const onSkyChange = vi.fn()
  const { container, unmount } = render(
    <CloudVisionPanel onObservation={onObservation} onSkyChange={onSkyChange} />
  )
  const video = screen.getByLabelText('Sky video feed')
  expect(video).toHaveAttribute('src', '/sky-camera.mp4')
  expect(video).toHaveAttribute('autoplay')
  expect(video).toHaveAttribute('loop')
  expect(video).not.toHaveAttribute('controls')
  fireEvent.loadedMetadata(video)
  expect(video).toHaveProperty('playbackRate', 0.2)
  expect(container.querySelector('input[type=file]')).toBeNull()
  expect(screen.getByText(/10\/09\/2026, 12:00:00 MYT/)).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16000)
  })
  expect(detectClouds).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish(result)
  })
  vi.mocked(detectClouds).mockRejectedValue(new Error('Vision offline'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(onObservation).toHaveBeenCalledWith({
    captured_at: '2026-09-10T04:00:00.000Z',
    cloud_cover: 0.6,
    cloud_mask: undefined,
  })
  expect(onSkyChange).toHaveBeenCalledWith(
    expect.objectContaining({ cloud_cover: 0.6 })
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(onObservation).toHaveBeenLastCalledWith(null)
  expect(onSkyChange).toHaveBeenLastCalledWith(null)
  expect(screen.getByRole('alert')).toHaveTextContent('Vision offline')
  const failedCalls = vi.mocked(detectClouds).mock.calls.length
  vi.mocked(detectClouds).mockResolvedValue(result)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16000)
  })
  expect(vi.mocked(detectClouds).mock.calls.length).toBeGreaterThan(failedCalls)
  expect(onObservation.mock.calls.at(-1)?.[0]).toMatchObject({
    cloud_cover: 0.6,
  })
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000)
  })
  expect(onObservation).toHaveBeenLastCalledWith(null)
  expect(onSkyChange).toHaveBeenLastCalledWith(null)
  expect(screen.getByText(/weather fallback/)).toBeInTheDocument()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
