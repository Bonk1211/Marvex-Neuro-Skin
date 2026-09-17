import type { Metadata } from 'next'
import { PredictiveSlab } from '@/components/neuroskin/PredictiveSlab'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Predictive radiant-slab charging',
  description:
    'Supporting simulation: compare forecast-based night cooling with a fixed schedule and inspect a proposed slab-charging plan.',
}

export default function SlabPage() {
  return <PredictiveSlab />
}
