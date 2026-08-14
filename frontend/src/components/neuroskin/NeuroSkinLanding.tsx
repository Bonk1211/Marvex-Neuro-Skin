import Link from 'next/link'
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Gauge,
  Leaf,
  Move3d,
  ShieldCheck,
  SunMedium,
} from 'lucide-react'

const proofs = [
  {
    number: '01',
    icon: SunMedium,
    label: 'Sensor truth',
    title: 'Detect a lying irradiance sensor.',
    body: 'Measured irradiance is checked against solar position and cloud-adjusted expectation before it can influence the facade.',
    result: 'Reject contradiction · trust genuine cloud',
  },
  {
    number: '02',
    icon: BrainCircuit,
    label: 'One objective',
    title: 'Balance four impacts together.',
    body: 'Thermal load, daylight comfort, movement, and wind risk are evaluated for every allowable facade angle.',
    result: '0°–60° search · 5° increments',
  },
  {
    number: '03',
    icon: ShieldCheck,
    label: 'Hard safety',
    title: 'Keep optimisation below safety.',
    body: 'Power loss, critical wind, and rain bypass normal optimisation and select the safe mechanical state directly.',
    result: 'Power off → 60° · wind or rain → 0°',
  },
]

export function NeuroSkinLanding() {
  return (
    <main className='landing-shell'>
      <header className='landing-nav'>
        <nav className='mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 lg:px-8'>
          <Link className='flex items-center gap-3' href='/'>
            <span className='brand-mark h-10 w-10 rounded-2xl'>
              <Leaf className='h-5 w-5' />
            </span>
            <span>
              <span className='block font-display text-lg font-semibold tracking-tight text-white'>
                NeuroSkin
              </span>
              <span className='block text-[9px] font-semibold uppercase tracking-[0.22em] text-white/40'>
                Adaptive facade control
              </span>
            </span>
          </Link>
          <div className='flex items-center gap-5'>
            <a
              className='hidden text-xs font-medium text-white/55 transition hover:text-white md:block'
              href='#how-it-works'
            >
              How it works
            </a>
            <a
              className='hidden text-xs font-medium text-white/55 transition hover:text-white md:block'
              href='#model'
            >
              The model
            </a>
            <Link
              className='hidden text-xs font-medium text-white/55 transition hover:text-white md:block'
              href='/slab'
            >
              Slab charging
            </Link>
            <Link className='landing-nav-cta' href='/dashboard'>
              Open dashboard <ArrowRight className='h-3.5 w-3.5' />
            </Link>
          </div>
        </nav>
      </header>

      <section className='landing-hero'>
        <div className='mx-auto grid max-w-[1240px] items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-28 lg:pt-24'>
          <div>
            <div className='landing-eyebrow'>
              <span className='status-pulse' /> Deterministic · explainable ·
              safety-first
            </div>
            <h1 className='mt-6 max-w-3xl font-display text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl'>
              A facade controller you can{' '}
              <span className='text-mint'>judge.</span>
            </h1>
            <p className='mt-7 max-w-xl text-base leading-7 text-white/55 sm:text-lg'>
              NeuroSkin turns weather, occupancy, daylight, and safety
              conditions into an auditable facade angle—without hiding the
              decision inside a black box.
            </p>
            <div className='mt-9 flex flex-wrap items-center gap-3'>
              <Link className='landing-primary-cta' href='/dashboard'>
                Run the simulation <ArrowRight className='h-4 w-4' />
              </Link>
              <a className='landing-secondary-cta' href='#how-it-works'>
                Understand the logic
              </a>
              <Link className='landing-secondary-cta' href='/slab'>
                7.1 Predictive slab charging
              </Link>
            </div>
            <div className='mt-10 flex flex-wrap gap-x-7 gap-y-3 text-[11px] text-white/45'>
              {[
                '144 decisions per day',
                '10-minute resolution',
                'Kuala Lumpur model',
              ].map((item) => (
                <span className='flex items-center gap-2' key={item}>
                  <Check className='h-3.5 w-3.5 text-mint' /> {item}
                </span>
              ))}
            </div>
          </div>

          <div
            className='landing-visual'
            aria-label='NeuroSkin decision loop preview'
          >
            <div className='landing-visual-top'>
              <span className='flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45'>
                <span className='h-2 w-2 rounded-full bg-mint' /> Decision loop
              </span>
              <span className='font-mono text-[10px] text-white/35'>
                12:00 MYT
              </span>
            </div>
            <div className='landing-angle-readout'>
              <div>
                <p className='text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35'>
                  Selected angle
                </p>
                <p className='mt-2 font-display text-6xl font-semibold tracking-[-0.05em] text-white'>
                  35°
                </p>
              </div>
              <div className='landing-angle-dial'>
                <span className='landing-angle-arm' />
                <span className='landing-angle-center' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <PreviewMetric label='Relative load' value='0.420' tone='mint' />
              <PreviewMetric label='Indoor light' value='520 lux' tone='sky' />
              <PreviewMetric label='Sensor' value='Trusted' tone='mint' />
              <PreviewMetric label='Mode' value='NORMAL' tone='amber' />
            </div>
            <div className='mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3'>
              <span className='text-[10px] text-white/45'>
                Thermal · Light · Movement · Risk
              </span>
              <span className='rounded-full bg-mint/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-mint'>
                Lowest cost
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className='bg-background py-20 sm:py-28' id='how-it-works'>
        <div className='mx-auto max-w-[1240px] px-5 lg:px-8'>
          <div className='max-w-2xl'>
            <p className='eyebrow'>How it works</p>
            <h2 className='mt-3 font-display text-3xl font-semibold tracking-[-0.035em] sm:text-5xl'>
              Three proofs. One operating loop.
            </h2>
            <p className='mt-4 text-sm leading-6 text-muted-foreground sm:text-base'>
              The landing page holds the context. The dashboard stays focused on
              inputs, impact, and evidence.
            </p>
          </div>

          <div className='mt-12 grid gap-4 lg:grid-cols-3'>
            {proofs.map((proof) => {
              const Icon = proof.icon
              return (
                <article className='landing-proof-card' key={proof.number}>
                  <div className='flex items-center justify-between'>
                    <span className='landing-proof-icon'>
                      <Icon className='h-5 w-5' />
                    </span>
                    <span className='font-mono text-[10px] text-muted-foreground'>
                      {proof.number}
                    </span>
                  </div>
                  <p className='mt-8 text-[10px] font-bold uppercase tracking-[0.16em] text-primary'>
                    {proof.label}
                  </p>
                  <h3 className='mt-2 font-display text-xl font-semibold tracking-tight'>
                    {proof.title}
                  </h3>
                  <p className='mt-3 text-sm leading-6 text-muted-foreground'>
                    {proof.body}
                  </p>
                  <div className='mt-7 border-t border-border/70 pt-4 font-mono text-[10px] text-foreground/60'>
                    {proof.result}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className='landing-model-section' id='model'>
        <div className='mx-auto grid max-w-[1240px] gap-12 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-28'>
          <div>
            <p className='landing-dark-eyebrow'>Transparent by design</p>
            <h2 className='mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl'>
              The controller is the formula.
            </h2>
            <p className='mt-5 max-w-md text-sm leading-6 text-white/50'>
              Every five-degree candidate is scored. The lowest-cost safe angle
              wins; a movement budget prevents low-value actuator cycles.
            </p>
            <div className='mt-8 space-y-3'>
              <ModelRule icon={Gauge} text='Comfort band: 300–700 lux' />
              <ModelRule icon={Move3d} text='Angles: 0°, 5°, … 60°' />
              <ModelRule icon={ShieldCheck} text='Critical wind: 15 m/s' />
            </div>
          </div>

          <div className='landing-formula-panel'>
            <p className='text-[10px] font-bold uppercase tracking-[0.18em] text-mint/60'>
              Total angle cost
            </p>
            <div className='mt-6 font-mono text-sm leading-8 text-mint sm:text-lg'>
              <p>C(θ) = wT · L(θ) + wL · P(lux(θ))²</p>
              <p className='pl-8'>+ wM · |θ − θprevious| / 60</p>
              <p className='pl-8'>+ wR · (v / 15)² · θ / 60</p>
            </div>
            <div className='mt-8 grid gap-3 sm:grid-cols-2'>
              <FormulaTerm symbol='wT' label='Thermal load' />
              <FormulaTerm symbol='wL' label='Daylight penalty' />
              <FormulaTerm symbol='wM' label='Movement cost' />
              <FormulaTerm symbol='wR' label='Wind exposure' />
            </div>
            <p className='mt-6 border-t border-white/10 pt-5 text-[10px] leading-5 text-white/40'>
              Cooling load is a relative physics-inspired proxy, not HVAC energy
              in kWh. Environmental and sensor readings are seeded synthetic
              data; MET mode uses official daily context to shape that synthetic
              day.
            </p>
          </div>
        </div>
      </section>

      <section className='bg-white py-20'>
        <div className='mx-auto flex max-w-[1000px] flex-col items-center px-5 text-center'>
          <p className='eyebrow'>Ready to judge the result?</p>
          <h2 className='mt-3 max-w-2xl font-display text-3xl font-semibold tracking-[-0.035em] sm:text-5xl'>
            Change one input. See the impact.
          </h2>
          <p className='mt-4 max-w-xl text-sm leading-6 text-muted-foreground'>
            The operating dashboard contains only the controls and evidence
            needed to compare a run.
          </p>
          <Link className='landing-primary-cta mt-8' href='/dashboard'>
            Open NeuroSkin OS <ArrowRight className='h-4 w-4' />
          </Link>
        </div>
      </section>

      <footer className='border-t border-border/70 bg-white px-5 py-6'>
        <div className='mx-auto flex max-w-[1240px] flex-col justify-between gap-2 text-[10px] text-muted-foreground sm:flex-row'>
          <span>NeuroSkin · Explainable adaptive facade simulation</span>
          <span>Kuala Lumpur · Synthetic decision proof</span>
        </div>
      </footer>
    </main>
  )
}

function PreviewMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'mint' | 'sky' | 'amber'
}) {
  const color =
    tone === 'mint'
      ? 'text-mint'
      : tone === 'sky'
        ? 'text-sky'
        : 'text-amber-300'
  return (
    <div className='rounded-xl border border-white/10 bg-white/[0.05] p-3'>
      <p className='text-[9px] uppercase tracking-wider text-white/35'>
        {label}
      </p>
      <p className={`mt-1 font-mono text-sm font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function ModelRule({
  icon: Icon,
  text,
}: {
  icon: React.ElementType
  text: string
}) {
  return (
    <div className='flex items-center gap-3 text-xs text-white/60'>
      <span className='grid h-8 w-8 place-items-center rounded-xl bg-white/[0.06] text-mint'>
        <Icon className='h-4 w-4' />
      </span>
      {text}
    </div>
  )
}

function FormulaTerm({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div className='flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3'>
      <span className='grid h-8 w-8 place-items-center rounded-lg bg-mint/10 font-mono text-xs font-bold text-mint'>
        {symbol}
      </span>
      <span className='text-xs text-white/60'>{label}</span>
    </div>
  )
}
