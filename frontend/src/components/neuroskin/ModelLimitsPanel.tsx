import type { SimulationRunResponse } from '@/lib/types'

interface ModelLimitsPanelProps {
  metadata: SimulationRunResponse['metadata']
}

export function ModelLimitsPanel({ metadata }: ModelLimitsPanelProps) {
  return (
    <section className='console-card' aria-label='Model limits'>
      <p className='console-card-title'>Model limits</p>
      <span className='synthetic-badge mt-2'>
        {metadata.synthetic
          ? 'Includes synthetic inputs'
          : 'Provider weather inputs'}
      </span>
      <div className='mt-3 space-y-2 text-xs leading-5 text-muted-foreground'>
        <p>
          Facade load is a {metadata.load_unit}. It is never converted to HVAC
          kWh, carbon, cost, or payback.
        </p>
        <p>Shading cannot remove the latent-load floor from humidity.</p>
        <p>
          Open-Meteo supplies provider forecast or reanalysis weather, not
          building telemetry.
        </p>
        <p>
          Occupancy, indoor lux/temperature/RH, pyranometer noise and facade
          control are simulated. Occupancy is one building-wide value.
        </p>
        <p>
          The 3D massing is reconstructed from published figures, not measured
          drawings. Workspaces, furniture, the service core and overhead HVAC
          routes are illustrative. There is no room-level thermal model,
          measured duct layout, airflow or equipment energy data.
        </p>
        <p>
          Facade tilt: {metadata.facade_tilt}°. 115° is the Diamond’s 25°
          outward lean; 90° is an upright counterfactual.
        </p>
        <p>
          Four facade bands span {metadata.floors} floors. Zones do not provide
          individual floor measurements.
        </p>
      </div>
    </section>
  )
}
