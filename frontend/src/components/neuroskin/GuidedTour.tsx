'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import type { ScenarioName } from '@/lib/types'

interface GuidedTourProps {
  open: boolean
  loading: boolean
  scenario: ScenarioName
  onOpenChange: (open: boolean) => void
  onScenarioChange: (scenario: ScenarioName) => void
}

interface TourStep {
  kicker: string
  title: string
  body: string
  target: string
  scenario: ScenarioName
}

const steps: TourStep[] = [
  {
    kicker: 'The central claim',
    title: 'This is a proof of decisions, not a building twin.',
    body: 'Every reading is synthetic. The value is in seeing NeuroSkin choose an angle, explain why, and behave differently from a static controller.',
    target: '[data-tour="hero"]',
    scenario: 'overview',
  },
  {
    kicker: 'Tier 1 · Lie detector',
    title: 'Ask whether a sensor reading is physically plausible.',
    body: 'At 11:30 the irradiance sensor says zero while the almanac predicts strong sun under clear sky. NeuroSkin rejects the sensor; the naive controller opens.',
    target: '[data-tour="scenario-story"]',
    scenario: 'lie_detector',
  },
  {
    kicker: 'Tier 1 · Evidence',
    title: 'The same low reading can still be genuine.',
    body: 'Later, heavy cloud explains the low reading. The controller trusts it. This disambiguation is the USP—not a simple low-value threshold.',
    target: '[data-tour="evidence"]',
    scenario: 'lie_detector',
  },
  {
    kicker: 'Tier 2 · Co-optimisation',
    title: 'One cost balances daylight, load, movement, and risk.',
    body: 'The comparison uses the same seeded day for both strategies. Read the three outcome cards together: comfort, relative load, and actuator movement.',
    target: '[data-tour="comparison"]',
    scenario: 'co_optimization',
  },
  {
    kicker: 'Tier 3 · Safety first',
    title: 'Safety short-circuits the optimiser.',
    body: 'One event declines a marginal move; another simulates power loss and forces the passive 60° fail-shaded geometry.',
    target: '[data-tour="events"]',
    scenario: 'budget_failsafe',
  },
  {
    kicker: 'Trust · Explainability',
    title: 'Inspect the reason behind any tick.',
    body: 'Drag the timeline, inspect trust and mode, then read the reason and cost contribution. Use the controls to rerun the proof with different conditions.',
    target: '[data-tour="explainability"]',
    scenario: 'budget_failsafe',
  },
]

export function GuidedTour({
  open,
  loading,
  scenario,
  onOpenChange,
  onScenarioChange,
}: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const step = steps[stepIndex]

  useEffect(() => {
    if (!open) return
    if (scenario !== step.scenario) onScenarioChange(step.scenario)
  }, [onScenarioChange, open, scenario, step.scenario])

  useEffect(() => {
    if (!open || loading) return
    const target = document.querySelector<HTMLElement>(step.target)
    if (!target) return
    target.classList.add('tour-focus')
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    panelRef.current?.focus({ preventScroll: true })
    return () => target.classList.remove('tour-focus')
  }, [loading, open, step.target])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
      if (event.key === 'ArrowRight' && stepIndex < steps.length - 1) {
        setStepIndex((current) => current + 1)
      }
      if (event.key === 'ArrowLeft' && stepIndex > 0) {
        setStepIndex((current) => current - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange, open, stepIndex])

  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  if (!open) return null

  const finish = () => {
    window.localStorage.setItem('neuroskin-tour-v1', 'complete')
    onOpenChange(false)
  }

  return (
    <div className='tour-layer' aria-live='polite'>
      <div
        ref={panelRef}
        className='tour-panel'
        role='dialog'
        aria-modal='false'
        aria-labelledby='tour-title'
        tabIndex={-1}
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <p className='tour-kicker'>{step.kicker}</p>
            <p className='mt-1 text-xs text-white/45'>
              Step {stepIndex + 1} of {steps.length}
            </p>
          </div>
          <button
            className='tour-close'
            type='button'
            onClick={finish}
            aria-label='Close guided tour'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='tour-progress mt-4' aria-hidden='true'>
          {steps.map((item, index) => (
            <span
              key={item.title}
              className={index <= stepIndex ? 'tour-progress-active' : ''}
            />
          ))}
        </div>

        <h2
          id='tour-title'
          className='mt-5 font-display text-xl font-semibold leading-tight text-white'
        >
          {step.title}
        </h2>
        <p className='mt-3 text-sm leading-6 text-white/65'>{step.body}</p>

        <div className='mt-6 flex items-center justify-between gap-3'>
          <button
            className='tour-secondary-button'
            type='button'
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            <ArrowLeft className='h-4 w-4' /> Back
          </button>
          {stepIndex === steps.length - 1 ? (
            <button
              className='tour-primary-button'
              type='button'
              onClick={finish}
            >
              Finish tour <Check className='h-4 w-4' />
            </button>
          ) : (
            <button
              aria-label='Next tour step'
              className='tour-primary-button'
              type='button'
              onClick={() =>
                setStepIndex((current) =>
                  Math.min(steps.length - 1, current + 1)
                )
              }
            >
              Next <ArrowRight className='h-4 w-4' />
            </button>
          )}
        </div>
        <p className='mt-3 text-center text-[10px] text-white/35'>
          Use ← → to navigate · Esc to close
        </p>
      </div>
    </div>
  )
}
