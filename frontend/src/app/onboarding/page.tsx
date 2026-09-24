import type { Metadata } from 'next'
import { BuildingOnboarding } from '@/components/neuroskin/BuildingOnboarding'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Building onboarding',
  description:
    'Meet your commissioning agent and construct a sample digital twin with one-click demo setup.',
}

export default function OnboardingPage() {
  return <BuildingOnboarding />
}
