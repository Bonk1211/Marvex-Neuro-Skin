import type { Metadata } from 'next'
import Link from 'next/link'
import { LiveHardwarePanel } from '@/components/neuroskin/LiveHardwarePanel'

export const metadata: Metadata = {
  title: 'NeuroSkin OS — Sensor-only demo',
  description:
    'Four independent BH1750 sensors and actuators, disconnected from the simulation.',
}

export default function DemoPage() {
  return (
    <main className='min-h-screen bg-secondary/40 px-4 py-6 sm:px-8'>
      <div className='mx-auto max-w-3xl space-y-5'>
        <header className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='eyebrow'>Demo 2 · physical 2×2 prototype</p>
            <h1 className='mt-1 font-display text-2xl font-semibold tracking-tight'>
              BH1750 + actuator demo
            </h1>
            <p className='mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground'>
              Opening this page selects sensor-only control. Each light sensor
              drives its own louvre through the local hardware bridge. Keep the
              backend and ESP32 connected; no simulation needs to run.
            </p>
          </div>
          <Link className='landing-nav-cta' href='/dashboard'>
            Demo 1 · open simulation →
          </Link>
        </header>

        <LiveHardwarePanel tick={null} sensorOnly />

        <section
          className='console-card space-y-3'
          aria-label='Corner-light demonstration'
        >
          <h2 className='font-semibold'>
            Light one corner, watch one zone respond
          </h2>
          <ol className='list-decimal space-y-2 pl-5 text-sm leading-relaxed'>
            <li>Check that the ESP32 is online and Sensor only is selected.</li>
            <li>
              With the lamp off, let the panels settle. Keep the other sensors
              shaded or inside the displayed lux band.
            </li>
            <li>
              Aim the lamp at one corner until its reading exceeds the upper
              threshold. Its card turns amber and its louvre moves toward
              shading.
            </li>
            <li>
              The other panels hold or open according to their own readings.
              Move the lamp to each corner and repeat.
            </li>
          </ol>
          <p className='text-sm leading-relaxed text-muted-foreground'>
            The simulated facade has a 4×4 array of 16 independent zones. This
            2×2 rig demonstrates the same local-control principle in four zones:
            one bright corner does not close the whole facade. It demonstrates
            physical light response; full-array performance and energy savings
            remain simulation results.
          </p>
        </section>
      </div>
    </main>
  )
}
