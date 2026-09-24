import type { Metadata } from 'next'
import { Suspense } from 'react'
import { NeuroSkinDashboard } from '@/components/neuroskin/NeuroSkinDashboard'
import { getOnboarding } from '@/lib/api-client'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Building Intelligence',
  description:
    'Building health, sandbox scenarios, occupant comfort and coordinated facade agents.',
}

// Load the building filed at onboarding, with the existing commissioning defaults
// when the building profile is unavailable.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const profile = await getOnboarding()
    .then((state) => state.profile)
    .catch(() => undefined)
  return (
    <Suspense fallback={null}>
      <NeuroSkinDashboard profile={profile} />
    </Suspense>
  )
}
