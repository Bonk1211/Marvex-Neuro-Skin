import type { Metadata } from 'next'
import { Suspense } from 'react'
import { NeuroSkinDashboard } from '@/components/neuroskin/NeuroSkinDashboard'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Simulation Dashboard',
  description:
    'Focused operating dashboard for the NeuroSkin facade simulation.',
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <NeuroSkinDashboard />
    </Suspense>
  )
}
