import type { CsiDetection, Posture } from './csiPosture'

/**
 * 17-keypoint COCO pose for the CSI view.
 *
 * NOTHING HERE IS INFERRED FROM A RADIO. These are kinematic stand-ins driven by the
 * scripted detections in csiPosture.ts, shaped like what a CSI pose model emits so the
 * panel can show the two things that matter about such a model: the per-keypoint
 * confidence field it actually produces, and the skeleton decoded from its peaks.
 *
 * Frame: x across the body in [-0.5, 0.5], y up with 0 at the floor and 1 at the crown.
 */

export const KEYPOINTS = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const

export type KeypointName = (typeof KEYPOINTS)[number]

/**
 * Bones, as index pairs into KEYPOINTS.
 *
 * COCO has no neck keypoint, so nose-to-shoulder stands in for one. Without it the
 * head renders as a detached squiggle floating above the torso.
 */
export const SKELETON: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], // head
  [0, 5], [0, 6], // neck, the stand-in
  [5, 6], [5, 11], [6, 12], [11, 12], // torso
  [5, 7], [7, 9], [6, 8], [8, 10], // arms
  [11, 13], [13, 15], [12, 14], [14, 16], // legs
]

export interface Keypoint {
  name: KeypointName
  x: number
  y: number
  /** Per-joint detector confidence, 0-1. Extremities are always the weakest. */
  confidence: number
}

/**
 * How sure a CSI pose model is about each joint, relative to the whole-body score.
 * Torso dominates the signal; wrists and ankles are small, fast and easily lost.
 */
const JOINT_TRUST: Record<KeypointName, number> = {
  nose: 0.95,
  left_eye: 0.88,
  right_eye: 0.88,
  left_ear: 0.86,
  right_ear: 0.86,
  left_shoulder: 1,
  right_shoulder: 1,
  left_elbow: 0.85,
  right_elbow: 0.85,
  left_wrist: 0.72,
  right_wrist: 0.72,
  left_hip: 0.98,
  right_hip: 0.98,
  left_knee: 0.84,
  right_knee: 0.84,
  left_ankle: 0.7,
  right_ankle: 0.7,
}

/** A standing adult, in metres. The pose frame is normalised against this. */
export const STANDING_HEIGHT_M = 1.7

/**
 * Joint heights per posture, as fractions of standing height.
 *
 * Calibrated so one fixed scale serves every posture: standing puts the eye near
 * 1.6 m and seated near 1.2 m, which is the seat eye height the daylight probes use.
 * Seated hips drop to seat height and the thighs point at the sensor, so the knees
 * sit level with the hips rather than below them.
 */
const HEIGHTS: Record<Posture, { hip: number; knee: number; ankle: number; shoulder: number }> = {
  standing: { hip: 0.52, knee: 0.28, ankle: 0.03, shoulder: 0.82 },
  walking: { hip: 0.52, knee: 0.28, ankle: 0.03, shoulder: 0.82 },
  seated: { hip: 0.27, knee: 0.27, ankle: 0.03, shoulder: 0.58 },
}

/**
 * The gait phase of one occupant at a moment. Separated so the renderer can animate
 * smoothly on its own clock while the detections themselves update far more slowly.
 */
export function gaitPhase(seconds: number, probeIndex: number): number {
  return seconds * 2.6 + ((probeIndex * 2654435761) % 1000) / 159
}

type Heights = (typeof HEIGHTS)[Posture]

/** Joint positions in the body frame, before bearing is applied. */
function rawPose(h: Heights, stride: number): [KeypointName, number, number][] {
  // Mid-stride spreads the legs; the trailing foot also sits slightly higher.
  const spread = 0.08 + Math.abs(stride) * 0.13
  const swing = stride * 0.05
  const headY = h.shoulder + 0.14
  return [
    ['nose', 0, headY],
    ['left_eye', -0.025, headY + 0.02],
    ['right_eye', 0.025, headY + 0.02],
    ['left_ear', -0.05, headY + 0.01],
    ['right_ear', 0.05, headY + 0.01],
    ['left_shoulder', -0.13, h.shoulder],
    ['right_shoulder', 0.13, h.shoulder],
    ['left_elbow', -0.17 - swing, (h.shoulder + h.hip) / 2 + 0.08],
    ['right_elbow', 0.17 + swing, (h.shoulder + h.hip) / 2 + 0.08],
    ['left_wrist', -0.19 - swing * 2, h.hip + 0.1 - Math.abs(stride) * 0.03],
    ['right_wrist', 0.19 + swing * 2, h.hip + 0.1 - Math.abs(stride) * 0.03],
    ['left_hip', -0.09, h.hip],
    ['right_hip', 0.09, h.hip],
    ['left_knee', -(spread * 0.7), h.knee + Math.max(0, stride) * 0.03],
    ['right_knee', spread * 0.7, h.knee + Math.max(0, -stride) * 0.03],
    ['left_ankle', -spread, h.ankle + Math.max(0, stride) * 0.05],
    ['right_ankle', spread, h.ankle + Math.max(0, -stride) * 0.05],
  ]
}

export function poseFor(detection: CsiDetection, seconds: number): Keypoint[] {
  const stride =
    detection.posture === 'walking'
      ? Math.sin(gaitPhase(seconds, detection.probeIndex))
      : 0
  const raw = rawPose(HEIGHTS[detection.posture], stride)

  // Body bearing. Turning away narrows the figure and swaps left for right, exactly as
  // a real front-view projection does, which is why cos is used unclamped.
  const yaw = (detection.facingDeg * Math.PI) / 180
  const turn = Math.cos(yaw)
  const lean = Math.sin(yaw) * 0.04

  return raw.map(([name, x, y]) => ({
    name,
    x: x * turn + (name === 'nose' || name.endsWith('eye') ? lean : 0),
    y,
    confidence: Math.max(0, Math.min(1, detection.confidence * JOINT_TRUST[name])),
  }))
}

/**
 * Keypoint colour, warm at the crown and cold at the feet, the way a pose heatmap
 * reads. Returns an HSL hue in degrees.
 *
 * The hue belongs to the JOINT, not to its current height. Ramping on live height
 * would repaint a person's head from red to yellow simply for sitting down, which
 * makes two postures impossible to compare and breaks the tie to the skeleton drawn
 * in the room. Every nose is red whatever the occupant is doing.
 */
const HUE_BY_JOINT: Record<KeypointName, number> = (() => {
  const reference = rawPose(HEIGHTS.standing, 0)
  const hues = {} as Record<KeypointName, number>
  for (const [name, , y] of reference) {
    hues[name] = Math.max(0, Math.min(285, (1 - Math.max(0, Math.min(1, y))) * 285))
  }
  return hues
})()

export function keypointHue(joint: KeypointName): number {
  return HUE_BY_JOINT[joint]
}

/**
 * Blob radius for the confidence field, as a fraction of figure height. A model that
 * is unsure produces a broad, soft peak; a confident one produces a tight dot. Showing
 * that is the point of drawing the heatmap at all rather than only the skeleton.
 */
export function blobRadius(confidence: number): number {
  // Sized so neighbouring joints overlap and read as one body rather than a row of
  // dots. A published pose heatmap is a continuous field, not a scatter plot.
  return 0.075 + (1 - Math.max(0, Math.min(1, confidence))) * 0.11
}
