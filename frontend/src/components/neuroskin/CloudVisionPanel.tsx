'use client'

import { useEffect, useRef, useState } from 'react'
import { detectClouds, type CloudResult } from '@/lib/api-client'

export type SkyObservation = {
  captured_at: string
  cloud_cover: number
  cloud_mask?: number[][] | null
}
type Sample = { image: string; capturedAt: number; result: CloudResult }

export function CloudVisionPanel({
  onObservation,
  onSkyChange,
  onAgeChange,
}: {
  onObservation?: (observation: SkyObservation | null) => Promise<string | null>
  onSkyChange?: (observation: SkyObservation | null) => void
  onAgeChange?: (age: number | null) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const observer = useRef(onObservation)
  const skyObserver = useRef(onSkyChange)
  const displayed = useRef('fallback')
  const [intervalSeconds, setIntervalSeconds] = useState(15)
  const [now, setNow] = useState<Date | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sample, setSample] = useState<Sample | null>(null)
  const [brainStatus, setBrainStatus] = useState(
    'Brain using light sensors + weather'
  )
  const latest = useRef<Sample | null>(null)
  const valid = useRef(false)
  const delivered = useRef('fallback')
  const brainPending = useRef(false)

  useEffect(() => {
    observer.current = onObservation
    skyObserver.current = onSkyChange
  }, [onObservation, onSkyChange])

  useEffect(() => {
    let stopped = false
    let pending: AbortController | null = null
    let nextDetection = 0

    async function analyze() {
      const player = video.current
      if (!player || player.readyState < 2 || player.paused || pending) return
      const controller = new AbortController()
      pending = controller
      nextDetection = performance.now() + intervalSeconds * 1000
      setBusy(true)
      const timeout = setTimeout(() => controller.abort(), 30000)
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(
          1,
          960 / Math.max(player.videoWidth, player.videoHeight)
        )
        canvas.width = Math.round(player.videoWidth * scale)
        canvas.height = Math.round(player.videoHeight * scale)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Cannot capture the sky feed.')
        context.drawImage(player, 0, 0, canvas.width, canvas.height)
        const image = canvas.toDataURL('image/jpeg', 0.8)
        const capturedAt = Date.now()
        const result = await detectClouds(
          image.split(',')[1],
          canvas.width,
          canvas.height,
          controller.signal
        )
        if (stopped || controller.signal.aborted) return
        latest.current = { image, capturedAt, result }
        valid.current = true
        setSample(latest.current)
        setError('')
      } catch (cause) {
        if (stopped) return
        valid.current = false
        setError(
          controller.signal.aborted
            ? 'Detection timed out; retrying on schedule.'
            : cause instanceof Error
              ? cause.message
              : 'Cloud detection unavailable.'
        )
      } finally {
        clearTimeout(timeout)
        pending = null
        if (!stopped) setBusy(false)
      }
    }

    async function updateBrain() {
      const reading = latest.current
      const fresh =
        valid.current && reading && Date.now() - reading.capturedAt <= 60000
      const observation =
        fresh && reading.result.cloud_cover !== null
          ? {
              captured_at: new Date(reading.capturedAt).toISOString(),
              cloud_cover: reading.result.cloud_cover,
              cloud_mask: reading.result.cloud_mask,
            }
          : null
      const key = observation?.captured_at ?? 'fallback'
      if (key !== displayed.current) {
        skyObserver.current?.(observation)
        displayed.current = key
      }
      if (
        !observer.current ||
        brainPending.current ||
        key === delivered.current
      )
        return
      brainPending.current = true
      try {
        const status = await observer.current(observation)
        if (status) {
          delivered.current = key
          if (!stopped) setBrainStatus(status)
        }
      } catch {
        if (!stopped) setBrainStatus('Brain update failed; retrying')
      } finally {
        brainPending.current = false
      }
    }

    const tick = () => {
      setNow(new Date())
      if (performance.now() >= nextDetection) void analyze()
      void updateBrain()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      stopped = true
      clearInterval(timer)
      pending?.abort()
    }
  }, [intervalSeconds])

  const age =
    sample && now
      ? Math.max(0, (now.getTime() - sample.capturedAt) / 1000)
      : null
  const fresh = age !== null && age <= 60 && !error
  useEffect(() => {
    onAgeChange?.(age)
  }, [age, onAgeChange])
  const timestamp =
    now?.toLocaleString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour12: false,
    }) ?? 'Connecting…'

  return (
    <section className='console-card' aria-label='AI cloud vision'>
      <div className='flex items-center justify-between gap-3'>
        <p className='console-card-title'>Live AI cloud detection</p>
        <label className='flex items-center gap-2 text-xs'>
          Scan interval
          <select
            className='rounded border bg-background p-1'
            value={intervalSeconds}
            onChange={(event) => setIntervalSeconds(Number(event.target.value))}
          >
            {[5, 15, 30, 60].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className='relative mt-3 overflow-hidden rounded-lg bg-black font-mono text-white'>
        {/* Silent sky input; muted autoplay keeps the CCTV view continuous. */}
        <video
          ref={video}
          src='/sky-camera.mp4'
          autoPlay
          muted
          loop
          playsInline
          onLoadedMetadata={(event) => {
            event.currentTarget.defaultPlaybackRate = 0.2
            event.currentTarget.playbackRate = 0.2
          }}
          aria-label='Sky video feed'
          className='block w-full'
          onError={() => {
            valid.current = false
            setError('Sky feed unavailable.')
          }}
        />
        <div className='pointer-events-none absolute inset-x-0 top-0 flex justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 text-[10px] sm:text-xs'>
          <span>CAM 01 · SKY MONITOR</span>
          <span className='tabular-nums'>{timestamp} MYT</span>
        </div>
        <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 text-[10px] sm:text-xs'>
          <span className='flex items-center gap-2'>
            <span className='h-2 w-2 rounded-full bg-red-500' />
            AI VISION
          </span>
          <span>
            {busy ? 'ANALYZING' : fresh ? 'MONITORING' : 'AWAITING VISION'} ·{' '}
            {intervalSeconds}s SCAN
          </span>
        </div>
      </div>
      <p className='mt-3 text-xs' aria-live='polite'>
        {fresh && sample?.result.cloud_cover != null
          ? `Cloud area ${(sample.result.cloud_cover * 100).toFixed(0)}% · demo sky estimate`
          : 'Vision uncertain or unavailable · weather fallback'}
        {age !== null && ` · sample ${Math.floor(age)}s ago`}
      </p>
      <p className='mt-1 text-xs text-muted-foreground'>{brainStatus}</p>
      {error && (
        <p role='alert' className='mt-2 text-xs text-red-500'>
          {error}
        </p>
      )}
      {sample && (
        <details className='mt-3 text-xs'>
          <summary className='cursor-pointer'>
            Latest AI scan · {sample.result.detections.length} cloud regions
          </summary>
          <svg
            viewBox={`0 0 ${sample.result.width} ${sample.result.height}`}
            role='img'
            aria-label='Analyzed video frame with detected cloud masks'
            className='mt-2 w-full rounded-lg'
          >
            <image
              href={sample.result.annotated_image ?? sample.image}
              width={sample.result.width}
              height={sample.result.height}
            />
          </svg>
        </details>
      )}
    </section>
  )
}
