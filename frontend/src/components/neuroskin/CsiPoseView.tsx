'use client'

import { useEffect, useRef } from 'react'

import {
  SKELETON,
  blobRadius,
  keypointHue,
  poseFor,
  type Keypoint,
} from './csiPose'
import type { CsiDetection } from './csiPosture'

/**
 * The two halves of a CSI pose model's output, drawn the way such models are published:
 * the per-keypoint confidence field on the left, and the skeleton decoded from its peaks
 * on the right.
 *
 * The left pane is the honest one. Blob size is uncertainty, so a still occupant -- the
 * hardest case for a radio, and the only one whose Ev actually matters -- renders as a
 * broad smear while a walker renders as tight dots.
 *
 * Nothing here is measured. See csiPose.ts.
 */

const MAX_FIGURES = 4
const PANE_GAP = 2

interface CsiPoseViewProps {
  detections: CsiDetection[]
  /** Which occupant the floor section is cut through, highlighted in both panes. */
  selected?: number | null
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  pose: Keypoint[],
  cx: number,
  baseY: number,
  scale: number
) {
  ctx.save()
  // Peaks overlap and add, as they do in a real heatmap channel sum.
  ctx.globalCompositeOperation = 'lighter'
  for (const point of pose) {
    const x = cx + point.x * scale
    const y = baseY - point.y * scale
    const radius = blobRadius(point.confidence) * scale
    const hue = keypointHue(point.name)
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(
      0,
      `hsla(${hue}, 95%, 58%, ${0.35 + point.confidence * 0.5})`
    )
    gradient.addColorStop(
      0.45,
      `hsla(${hue}, 95%, 50%, ${0.12 + point.confidence * 0.2})`
    )
    gradient.addColorStop(1, `hsla(${hue}, 95%, 45%, 0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Keypoint[],
  cx: number,
  baseY: number,
  scale: number
) {
  const at = (index: number) => ({
    x: cx + pose[index].x * scale,
    y: baseY - pose[index].y * scale,
    hue: keypointHue(pose[index].name),
    confidence: pose[index].confidence,
  })
  ctx.save()
  ctx.lineCap = 'round'
  for (const [a, b] of SKELETON) {
    const from = at(a)
    const to = at(b)
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
    gradient.addColorStop(
      0,
      `hsla(${from.hue}, 85%, 66%, ${0.35 + from.confidence * 0.6})`
    )
    gradient.addColorStop(
      1,
      `hsla(${to.hue}, 85%, 66%, ${0.35 + to.confidence * 0.6})`
    )
    ctx.strokeStyle = gradient
    // A bone is only ever as certain as its weaker end.
    ctx.lineWidth = Math.max(
      1,
      scale * 0.012 * Math.min(from.confidence, to.confidence) + 0.6
    )
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  for (let i = 0; i < pose.length; i++) {
    const joint = at(i)
    ctx.fillStyle = `hsla(${joint.hue}, 90%, 72%, ${0.4 + joint.confidence * 0.6})`
    ctx.beginPath()
    ctx.arc(joint.x, joint.y, Math.max(0.9, scale * 0.011), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function CsiPoseView({ detections, selected = null }: CsiPoseViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Detections refresh on the slow CSI clock; the gait runs on its own so limbs move
  // smoothly instead of stepping twice a second.
  const detectionsRef = useRef(detections)
  detectionsRef.current = detections
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const start = performance.now()
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    let frameId = 0
    const render = () => {
      frameId = requestAnimationFrame(render)
      if (!width || !height) return
      const seconds = reduceMotion ? 0 : (performance.now() - start) / 1000
      const paneWidth = (width - PANE_GAP) / 2
      const limit = Math.max(
        1,
        Math.min(MAX_FIGURES, Math.floor(paneWidth / 90))
      )
      const focused = detectionsRef.current.find(
        (entry) => entry.probeIndex === selectedRef.current
      )
      const people = (
        focused
          ? [
              focused,
              ...detectionsRef.current.filter((entry) => entry !== focused),
            ]
          : detectionsRef.current
      ).slice(0, limit)

      ctx.fillStyle = '#05080a'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.fillRect(paneWidth, 0, PANE_GAP, height)
      if (!people.length) return

      const baseY = height * 0.83
      const slot = paneWidth / people.length
      const scale = Math.min(height * 0.61, slot * 1.25)
      people.forEach((detection, i) => {
        const pose = poseFor(detection, seconds)
        const centre = slot * (i + 0.5)
        const isSelected = detection.probeIndex === selectedRef.current
        if (isSelected) {
          for (const [x0] of [[0], [paneWidth + PANE_GAP]] as const) {
            ctx.fillStyle = 'rgba(255,255,255,0.05)'
            ctx.fillRect(x0 + slot * i, 0, slot, height)
          }
        }
        drawHeatmap(ctx, pose, centre, baseY, scale)
        drawSkeleton(ctx, pose, paneWidth + PANE_GAP + centre, baseY, scale)

        ctx.save()
        ctx.font = '9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = isSelected
          ? 'rgba(255,255,255,0.9)'
          : 'rgba(255,255,255,0.7)'
        const label = `${detection.posture} · ${(detection.confidence * 100).toFixed(0)}%`
        for (const x of [centre, paneWidth + PANE_GAP + centre]) {
          ctx.fillText(detection.zone, x, height - 18, slot - 5)
          ctx.fillText(label, x, height - 6, slot - 5)
        }
        ctx.restore()
      })
    }
    render()
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [])

  return (
    <div className='relative'>
      <canvas
        ref={canvasRef}
        className='h-52 w-full rounded-lg bg-[#05080a]'
        role='img'
        aria-label={
          detections.length
            ? `Simulated CSI pose estimation for ${detections.length} occupants: keypoint confidence field and decoded skeleton.`
            : 'Simulated CSI pose estimation, no occupants detected on this band.'
        }
      />
      <span className='pointer-events-none absolute left-2 top-1.5 text-[9px] uppercase tracking-wider text-white/65'>
        CSI confidence field
      </span>
      <span className='pointer-events-none absolute right-2 top-1.5 text-[9px] uppercase tracking-wider text-white/65'>
        Pose · 17 joints
      </span>
      {detections.length === 0 ? (
        <span className='pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-white/30'>
          no occupants detected on this band
        </span>
      ) : null}
    </div>
  )
}
