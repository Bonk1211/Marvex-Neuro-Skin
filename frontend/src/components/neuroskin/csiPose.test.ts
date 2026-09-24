import { expect, it } from 'vitest'
import type { CsiDetection } from './csiPosture'
import {
  KEYPOINTS,
  SKELETON,
  STANDING_HEIGHT_M,
  blobRadius,
  keypointHue,
  poseFor,
} from './csiPose'

const detection = (over: Partial<CsiDetection> = {}): CsiDetection => ({
  probeIndex: 3,
  zone: 'W6',
  posture: 'standing',
  facingDeg: 0,
  confidence: 0.8,
  breathingBpm: 14,
  ...over,
})

it('emits all 17 COCO keypoints, in order, inside the body frame', () => {
  const pose = poseFor(detection(), 0)
  expect(pose.map((k) => k.name)).toEqual([...KEYPOINTS])
  for (const k of pose) {
    expect(k.x).toBeGreaterThanOrEqual(-0.5)
    expect(k.x).toBeLessThanOrEqual(0.5)
    expect(k.y).toBeGreaterThanOrEqual(0)
    expect(k.y).toBeLessThanOrEqual(1)
    expect(k.confidence).toBeGreaterThan(0)
    expect(k.confidence).toBeLessThanOrEqual(1)
  }
})

it('has a skeleton whose every bone joins two real keypoints', () => {
  for (const [a, b] of SKELETON) {
    expect(KEYPOINTS[a]).toBeDefined()
    expect(KEYPOINTS[b]).toBeDefined()
    expect(a).not.toBe(b)
  }
  // Every joint is attached to something; a floating keypoint would draw as a stray dot.
  const attached = new Set(SKELETON.flat())
  expect(attached.size).toBe(KEYPOINTS.length)
})

it('trusts the torso more than the extremities, as a pose model does', () => {
  const pose = poseFor(detection(), 0)
  const by = (name: string) => pose.find((k) => k.name === name)!
  expect(by('left_shoulder').confidence).toBeGreaterThan(by('left_elbow').confidence)
  expect(by('left_elbow').confidence).toBeGreaterThan(by('left_wrist').confidence)
  expect(by('left_hip').confidence).toBeGreaterThan(by('left_ankle').confidence)
})

it('only animates a walker, and scissors the legs when it does', () => {
  const still = detection({ posture: 'standing' })
  expect(poseFor(still, 0)).toEqual(poseFor(still, 1.7))

  const walker = detection({ posture: 'walking' })
  const ankleGap = (t: number) => {
    const pose = poseFor(walker, t)
    const l = pose.find((k) => k.name === 'left_ankle')!
    const r = pose.find((k) => k.name === 'right_ankle')!
    return Math.abs(r.x - l.x)
  }
  const gaps = [0, 0.15, 0.3, 0.45, 0.6, 0.75].map(ankleGap)
  expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) + 0.05)
})

it('sits an occupant lower and folds the knees up to the hips', () => {
  const at = (pose: ReturnType<typeof poseFor>, name: string) =>
    pose.find((k) => k.name === name)!.y
  const standing = poseFor(detection({ posture: 'standing' }), 0)
  const seated = poseFor(detection({ posture: 'seated' }), 0)
  expect(at(seated, 'nose')).toBeLessThan(at(standing, 'nose'))
  expect(at(seated, 'left_hip')).toBeLessThan(at(standing, 'left_hip'))
  // Thighs point at the sensor, so the knee is level with the hip rather than below.
  expect(Math.abs(at(seated, 'left_knee') - at(seated, 'left_hip'))).toBeLessThan(0.05)
  expect(at(standing, 'left_knee')).toBeLessThan(at(standing, 'left_hip') - 0.15)
})

it('narrows the figure as it turns and mirrors it once it faces away', () => {
  const width = (deg: number) => {
    const pose = poseFor(detection({ facingDeg: deg }), 0)
    const l = pose.find((k) => k.name === 'left_shoulder')!.x
    const r = pose.find((k) => k.name === 'right_shoulder')!.x
    return r - l
  }
  expect(width(0)).toBeCloseTo(0.26, 6)
  expect(Math.abs(width(90))).toBeLessThan(0.01) // edge on
  expect(width(180)).toBeCloseTo(-0.26, 6) // seen from behind, left and right swap
})

it('ramps colour from a warm crown to cold feet, and blurs an unsure joint', () => {
  // Warm at the top, cold at the bottom, on a standing reference body.
  expect(keypointHue('nose')).toBeLessThan(20)
  expect(keypointHue('left_shoulder')).toBeLessThan(keypointHue('left_hip'))
  expect(keypointHue('left_hip')).toBeLessThan(keypointHue('left_knee'))
  expect(keypointHue('left_knee')).toBeLessThan(keypointHue('left_ankle'))
  expect(keypointHue('left_ankle')).toBeGreaterThan(260)
  // Left and right of a pair share a colour, as pose-model channels do.
  expect(keypointHue('left_wrist')).toBe(keypointHue('right_wrist'))

  // Big enough that adjacent joints overlap: shoulder to elbow is about 0.16 apart.
  expect(blobRadius(0.9)).toBeGreaterThan(0.07)
  expect(blobRadius(1)).toBeLessThan(blobRadius(0.6))
  expect(blobRadius(0.6)).toBeLessThan(blobRadius(0))
  expect(blobRadius(0)).toBeCloseTo(0.185, 6)
})

it('puts the eye where the daylight probes expect it, on one fixed scale', () => {
  const eye = (posture: 'standing' | 'seated') =>
    poseFor(detection({ posture }), 0).find((k) => k.name === 'nose')!.y * STANDING_HEIGHT_M
  // Standing eye ~1.6 m, seated ~1.2 m: the seat eye height room.py probes at.
  expect(eye('standing')).toBeGreaterThan(1.5)
  expect(eye('standing')).toBeLessThan(1.7)
  expect(eye('seated')).toBeGreaterThan(1.1)
  expect(eye('seated')).toBeLessThan(1.35)
})

it('keeps a joint its own colour whatever the occupant is doing', () => {
  // Sitting down lowers the head; it must not repaint it, or two postures stop being
  // comparable and the skeleton in the room stops matching the heatmap.
  const seated = poseFor(detection({ posture: 'seated' }), 0)
  const standing = poseFor(detection({ posture: 'standing' }), 0)
  expect(seated.find((k) => k.name === 'nose')!.y).toBeLessThan(
    standing.find((k) => k.name === 'nose')!.y
  )
  for (const k of KEYPOINTS) expect(keypointHue(k)).toBe(keypointHue(k))
  expect(keypointHue('nose')).toBeLessThan(keypointHue('left_ankle'))
})
