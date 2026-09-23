import Link from 'next/link'
import {
  ArrowRight,
  BrainCircuit,
  Building2,
  Grid2X2,
  Layers,
  Leaf,
  Radio,
  ShieldCheck,
  SunMedium,
} from 'lucide-react'

const differentiators = [
  {
    number: '01',
    icon: Building2,
    label: 'See what happens',
    title: 'Interactive digital twin',
    body: 'Move from building exposure to a local zone, then trace its inputs and action on one shared timeline.',
    result: 'Building · Floor · Brains · Feeds',
    href: '/dashboard?view=building',
    action: 'Explore the twin',
  },
  {
    number: '02',
    icon: Grid2X2,
    label: 'Control where it matters',
    title: 'Independent 4×4 zones',
    body: 'Each zone keeps its own simulated sensors and actuator state. One orchestrator applies a shared policy to local conditions.',
    result: '16 zones per facade · 64 logical building zones',
    href: '/dashboard?view=floor',
    action: 'Inspect a local zone',
  },
  {
    number: '03',
    icon: BrainCircuit,
    label: 'Understand the decision',
    title: 'Three-layer mechatronic brain',
    body: 'Check each sensor against its peers, observe predicted daylight, and replay supervised fault recovery.',
    result:
      'Simulated peer checks · observe-only Et/Ev · deterministic recovery',
    href: '/dashboard?view=brains',
    action: 'Follow the reasoning',
  },
]

const brainLayers = [
  {
    number: '01',
    icon: SunMedium,
    title: 'Physics + vision input assurance',
    status: 'SIMULATED · PEER-CHECKED',
    color: 'text-mint bg-mint/10',
    description:
      'Solar/cloud checks on the wall path; freshness checks for vision. Each zone sensor is compared with its wall peers and its own lux channel, in simulation only.',
  },
  {
    number: '02',
    icon: BrainCircuit,
    title: 'Daylight prediction + optimisation',
    status: 'OBSERVE-ONLY',
    color: 'text-sky bg-sky/10',
    description:
      'Extra Trees predicts task light (Et) and eye light (Ev). These estimates are displayed; they do not yet drive control.',
  },
  {
    number: '03',
    icon: ShieldCheck,
    title: 'Supervised fault recovery',
    status: 'SIMULATED · DETERMINISTIC',
    color: 'text-amber-200 bg-amber-200/10',
    description:
      'Authorised isolation, a snapshot, and verification against an uncorrected replay—then retain, roll back or escalate. An LLM diagnosis agent remains planned.',
  },
]

const lenses = [
  ['building', 'Building', 'See exposure', Building2],
  ['floor', 'Floor', 'Inspect a zone', Layers],
  ['brains', 'Brains', 'Trace the decision', BrainCircuit],
  ['feeds', 'Feeds', 'Check the evidence', Radio],
] as const

export function NeuroSkinLanding() {
  return (
    <main className='landing-shell'>
      <header className='landing-nav'>
        <nav
          aria-label='Main navigation'
          className='mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 lg:px-8'
        >
          <Link className='flex items-center gap-3' href='/'>
            <span className='brand-mark h-10 w-10 rounded-2xl'>
              <Leaf className='h-5 w-5' />
            </span>
            <span>
              <span className='block font-display text-lg font-semibold tracking-tight text-white'>
                NeuroSkin
              </span>
              <span className='block text-[9px] font-semibold uppercase tracking-[0.22em] text-white/60'>
                Adaptive facade intelligence
              </span>
            </span>
          </Link>
          <div className='flex items-center gap-5'>
            <a
              className='hidden text-xs font-medium text-white/65 transition hover:text-white md:block'
              href='#how-it-works'
            >
              Three defining ideas
            </a>
            <a
              className='hidden text-xs font-medium text-white/65 transition hover:text-white md:block'
              href='#model'
            >
              Inside the brain
            </a>
            <Link className='landing-nav-cta shrink-0' href='/dashboard'>
              Open twin <ArrowRight className='h-3.5 w-3.5' />
            </Link>
          </div>
        </nav>
      </header>

      <section className='landing-hero'>
        <div className='mx-auto grid max-w-[1240px] items-center gap-12 px-5 pb-16 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-24 lg:pt-20'>
          <div>
            <div className='landing-eyebrow'>
              <span className='h-1.5 w-1.5 rounded-full bg-mint' /> Interactive
              simulation · current release
            </div>
            <h1 className='mt-6 max-w-3xl font-display text-5xl font-semibold leading-[1.02] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl'>
              One twin.
              <br />
              Local control.
              <br />
              <span className='text-mint'>Visible decisions.</span>
            </h1>
            <p className='mt-6 max-w-lg text-base leading-7 text-white/65'>
              Explore an adaptive facade in simulation. Inspect the building,
              compare independent zones, and follow the logic behind each
              movement.
            </p>
            <div className='mt-8 flex flex-wrap items-center gap-3'>
              <Link
                className='landing-primary-cta'
                href='/dashboard?view=building'
              >
                Explore the digital twin <ArrowRight className='h-4 w-4' />
              </Link>
              <a className='landing-secondary-cta' href='#how-it-works'>
                Discover the three ideas
              </a>
            </div>
            <p className='mt-7 text-xs leading-5 text-white/55'>
              Putrajaya building model · simulated sensing · modelled daylight
            </p>
          </div>

          <div className='landing-visual'>
            <div className='landing-visual-top'>
              <span className='text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65'>
                Independent by zone
              </span>
              <span className='rounded-full border border-white/15 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-white/60'>
                Schematic
              </span>
            </div>
            <div className='my-5 flex items-end justify-between gap-4'>
              <div>
                <p className='font-display text-5xl font-semibold tracking-[-0.05em] text-white'>
                  64<span className='ml-2 text-base text-white/60'>zones</span>
                </p>
                <p className='mt-2 text-xs text-white/60'>
                  Four facades. Separate local state.
                </p>
              </div>
              <Grid2X2 className='mb-1 h-8 w-8 text-mint/70' />
            </div>
            <div className='flex items-center justify-center gap-2 rounded-xl border border-mint/25 bg-mint/10 px-3 py-3 text-xs font-semibold text-mint'>
              <BrainCircuit className='h-4 w-4' /> One orchestrator · one shared
              policy
            </div>
            <div aria-hidden='true' className='mx-auto h-4 w-px bg-mint/30' />
            <div
              role='img'
              aria-label='Four facades, each with a 4 by 4 array of 16 independent logical zones; 64 zones in total. Illustrative states.'
              className='grid grid-cols-2 gap-3'
            >
              {['North', 'East', 'South', 'West'].map((facade, faceIndex) => (
                <div
                  className='rounded-xl border border-white/10 bg-black/10 p-3'
                  key={facade}
                >
                  <div className='mb-2 flex justify-between font-mono text-[9px] uppercase tracking-wider text-white/60'>
                    <span>{facade}</span>
                    <span>4 × 4</span>
                  </div>
                  <div className='grid grid-cols-4 gap-1.5' aria-hidden='true'>
                    {Array.from({ length: 16 }, (_, zone) => (
                      <div
                        key={zone}
                        className={`grid aspect-[1.5] place-items-center overflow-hidden rounded border ${faceIndex % 2 === 0 ? 'border-mint/25 bg-mint/10 text-mint' : 'border-sky/25 bg-sky/10 text-sky'}`}
                      >
                        <span
                          className='h-0.5 w-2/3 rounded-full bg-current'
                          style={{
                            transform: `rotate(${-12 - ((zone + faceIndex * 3) % 5) * 9}deg)`,
                            opacity: 0.4 + ((zone + faceIndex) % 4) * 0.2,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px]'>
              <span className='text-white/55'>
                Illustrative states · logical zones
              </span>
              <Link
                className='inline-flex items-center gap-1.5 font-semibold text-mint hover:text-white'
                href='/dashboard?view=floor'
              >
                Inspect the array <ArrowRight className='h-3 w-3' />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className='bg-background py-16 sm:py-20' id='how-it-works'>
        <div className='mx-auto max-w-[1240px] px-5 lg:px-8'>
          <p className='eyebrow'>Three defining ideas</p>
          <h2 className='mt-3 max-w-2xl font-display text-3xl font-semibold tracking-[-0.035em] sm:text-5xl'>
            See the whole. Act locally.
            <br />
            Understand why.
          </h2>
          <div className='mt-10 grid gap-4 lg:grid-cols-3'>
            {differentiators.map((item) => {
              const Icon = item.icon
              return (
                <article
                  className='landing-proof-card flex flex-col'
                  key={item.number}
                >
                  <div className='flex items-center justify-between'>
                    <span className='landing-proof-icon'>
                      <Icon className='h-5 w-5' />
                    </span>
                    <span className='font-mono text-xs text-muted-foreground'>
                      {item.number}
                    </span>
                  </div>
                  <p className='mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-primary'>
                    {item.label}
                  </p>
                  <h3 className='mt-2 font-display text-xl font-semibold tracking-tight'>
                    {item.title}
                  </h3>
                  <p className='mb-6 mt-3 text-sm leading-6 text-muted-foreground'>
                    {item.body}
                  </p>
                  <p className='mt-auto border-t border-border/70 pt-4 text-[11px] leading-5 text-muted-foreground'>
                    {item.result}
                  </p>
                  <Link
                    className='mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline'
                    href={item.href}
                  >
                    {item.action} <ArrowRight className='h-3.5 w-3.5' />
                  </Link>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className='landing-model-section' id='model'>
        <div className='mx-auto grid max-w-[1240px] items-start gap-10 px-5 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-20'>
          <div>
            <p className='landing-dark-eyebrow'>
              Current capability → target brain
            </p>
            <h2 className='mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl'>
              Three layers.
              <br />
              Clear responsibility.
            </h2>
            <p className='mt-5 max-w-md text-sm leading-6 text-white/65'>
              Physics and peers check evidence. Learned models predict daylight.
              Deterministic supervision verifies simulated recovery within the
              same orchestrator.
            </p>
            <div className='mt-7 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4'>
              <ShieldCheck className='mt-0.5 h-5 w-5 shrink-0 text-mint' />
              <p className='text-xs leading-5 text-white/65'>
                <strong className='block font-semibold text-white'>
                  Safety remains deterministic
                </strong>
                Power, wind, rain and movement limits govern simulated
                actuation.
              </p>
            </div>
            <Link
              className='mt-7 inline-flex items-center gap-2 text-xs font-semibold text-mint hover:text-white'
              href='/dashboard?view=brains'
            >
              Inspect the current brain <ArrowRight className='h-3.5 w-3.5' />
            </Link>
          </div>

          <ol className='space-y-3'>
            {brainLayers.map((layer) => {
              const Icon = layer.icon
              return (
                <li
                  className='rounded-2xl border border-white/10 bg-white/[0.045] p-5 sm:p-6'
                  key={layer.number}
                >
                  <div className='flex flex-wrap items-center justify-between gap-3'>
                    <span className='flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60'>
                      <Icon className='h-4 w-4' /> Layer {layer.number}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[9px] font-bold tracking-wider ${layer.color}`}
                    >
                      {layer.status}
                    </span>
                  </div>
                  <h3 className='mt-3 font-display text-lg font-semibold tracking-tight text-white'>
                    {layer.title}
                  </h3>
                  <p className='mt-2 text-xs leading-6 text-white/65'>
                    {layer.description}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section className='bg-white py-16 sm:py-20'>
        <div className='mx-auto max-w-[1240px] px-5 lg:px-8'>
          <p className='eyebrow'>Start exploring</p>
          <h2 className='mt-3 font-display text-3xl font-semibold tracking-[-0.035em] sm:text-4xl'>
            Four views. One shared timeline.
          </h2>
          <div className='mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            {lenses.map(([id, name, purpose, Icon]) => (
              <Link
                className='group flex items-center gap-4 rounded-2xl border border-border/80 bg-background p-5 transition hover:border-primary/30 hover:bg-secondary'
                href={`/dashboard?view=${id}`}
                key={id}
              >
                <Icon className='h-5 w-5 shrink-0 text-primary' />
                <span>
                  <span className='block text-sm font-semibold'>{name}</span>
                  <span className='mt-1 block text-xs text-muted-foreground'>
                    {purpose}
                  </span>
                </span>
                <ArrowRight className='ml-auto h-3.5 w-3.5 shrink-0 text-primary transition group-hover:translate-x-0.5' />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className='border-t border-border/70 bg-white px-5 py-6'>
        <div className='mx-auto flex max-w-[1240px] flex-col justify-between gap-3 text-[11px] text-muted-foreground sm:flex-row'>
          <span>
            NeuroSkin · Simulation and model-development demonstration
          </span>
          <Link className='hover:text-primary hover:underline' href='/slab'>
            Supporting application: radiant-slab planner ↗
          </Link>
        </div>
      </footer>
    </main>
  )
}
