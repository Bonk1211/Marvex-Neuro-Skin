import type { Metadata } from 'next'
import { HardwareCalibration } from '@/components/neuroskin/HardwareCalibration'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Actuator calibration',
  description:
    'Hold each louvre of the ESP32 rig at a known angle and align its servo endpoints.',
}

export default function HardwarePage() {
  return <HardwareCalibration />
}
