import type { Metadata } from 'next'
import { PredictiveSlab } from '@/components/neuroskin/PredictiveSlab'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Predictive radiant-slab charging',
  description:
    'Application 7.1: forecast tomorrow’s cooling load and charge the night-cooled slab to exactly the level the next day needs.',
}

export default function SlabPage() {
  return <PredictiveSlab />
}
