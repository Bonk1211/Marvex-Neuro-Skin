'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  MousePointerClick,
  X,
} from 'lucide-react'
import type { ScenarioName } from '@/lib/types'

interface GuidedTourProps {
  open: boolean
  loading: boolean
  scenario: ScenarioName
  onOpenChange: (open: boolean) => void
  onScenarioChange: (scenario: ScenarioName) => void
}

interface TourStep {
  section: string
  title: string
  body: string
  action: string
  notice: string[]
  target: string
  scenario: ScenarioName
  placement?: 'left' | 'right'
}

const steps: TourStep[] = [
  {
    section: 'Start here',
    title: 'Learn the dashboard in about five minutes.',
    body: 'NeuroSkin is a synthetic decision proof. You configure a day, run the deterministic controller, inspect its outcomes, and then audit why it chose each facade angle.',
    action:
      'Use Next, the arrow keys, or the section menu below. The highlighted component is the one being explained.',
    notice: [
      'All environmental and sensor readings are synthetic.',
      'Cooling load is a relative proxy—never an HVAC-kWh claim.',
    ],
    target: '[data-tour="hero"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Navigate',
    title: 'Choose the proof you want to inspect.',
    body: 'The four tabs are separate views of the same controller. Overview shows a normal day; the other tabs isolate the lie detector, co-optimisation, and safety behavior.',
    action:
      'Click a tab at any time. Changing tabs immediately runs that scenario with your current controls.',
    notice: [
      'Tier 1 is the sensor-trust USP.',
      'Tier 2 compares NeuroSkin with the naive baseline.',
      'Tier 3 demonstrates movement restraint and fail-safe priority.',
    ],
    target: '[data-tour="scenario-tabs"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Configure',
    title: 'Choose the day used by the solar almanac.',
    body: 'The date changes solar position, elevation, and clear-sky irradiance for Kuala Lumpur. Both strategies still receive the same generated day.',
    action:
      'Pick a date, then press Run simulation later. Use the same date and seed when you need a repeatable comparison.',
    notice: [
      'The location remains fixed at Kuala Lumpur.',
      'Date changes do not apply until you explicitly run the simulation.',
    ],
    target: '[data-tour="control-date"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Configure',
    title: 'Select the sky condition you want to test.',
    body: 'Cloud profile shapes irradiance attenuation and diffuse daylight across the synthetic day.',
    action:
      'Choose Clear for a stable reference, Scattered for passing cloud events, or Overcast for heavy cloud and possible rain safety events.',
    notice: [
      'Scattered is the documented seed-42 demonstration.',
      'Heavy cloud can explain a low sensor value without implying a sensor fault.',
    ],
    target: '[data-tour="control-cloud"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Configure',
    title: 'Scale how heavily the building is occupied.',
    body: 'Occupancy affects internal heat and humidity-driven latent load. That latent component cannot be removed by facade shading.',
    action:
      'Drag the slider from 0× to 1.5×. Run once at a low value and once at a high value, then compare mean relative load.',
    notice: [
      'Higher occupancy raises both internal and latent cooling load.',
      'The red latent-floor line remains above zero even at 60° shading.',
    ],
    target: '[data-tour="control-occupancy"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Configure',
    title: 'Override wind to test mechanical protection.',
    body: 'This slider applies one wind speed across the day. Wind contributes to angle risk until the hard safety threshold takes priority.',
    action:
      'Set wind below 15 m/s to observe optimization, or to 15 m/s and above to force the powered facade to retract flat at 0°.',
    notice: [
      'Risk cost increases before the safety threshold is reached.',
      'At the threshold, SAFE bypasses the cost function entirely.',
    ],
    target: '[data-tour="control-wind"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Configure',
    title: 'Simulate the global facade power state.',
    body: 'Power is a safety input, not a cost weight. Turning it off prevents normal optimization and activates the passive failure geometry.',
    action:
      'Toggle power off and run. Every tick should report SAFE with a 60° final angle; turn it back on to resume normal decisions.',
    notice: [
      'Power loss fails shaded at 60°.',
      'Wind or rain with power available retracts flat at 0°—a different safety response.',
    ],
    target: '[data-tour="control-power"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Configure',
    title: 'Tell the controller what to prioritize.',
    body: 'The four sliders shape the single cost function used to rank every allowable angle from 0° to 60°.',
    action:
      'Raise Daylight to favor the 300–700 lux band, Thermal to favor shade, Movement to preserve actuator life, or Risk to avoid exposed angles in wind.',
    notice: [
      'Weights are normalized automatically, so they do not need to total 1.',
      'The selected tick later shows each normalized cost contribution.',
    ],
    target: '[data-tour="controller-weights"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Run',
    title: 'Apply the controls and reproduce a day.',
    body: 'The seed makes cloud events and sensor noise repeatable. Identical inputs and seed produce an identical 144-tick response.',
    action:
      'Change the seed, press Run simulation, and wait for the output title to refresh. Use the reset icon at the top of the panel to restore defaults and rerun.',
    notice: [
      'Run is explicit: editing a control alone does not change the displayed result.',
      'A full day uses 10-minute ticks from 00:00 through 23:50.',
    ],
    target: '[data-tour="run-workflow"]',
    scenario: 'overview',
    placement: 'right',
  },
  {
    section: 'Read output',
    title: 'Start with the four headline indicators.',
    body: 'These cards summarize the current run before you inspect the detailed evidence below.',
    action:
      'Read mean relative load, facade movements, sensor-trust rate, and the number of synthetic sunlit ticks from left to right.',
    notice: [
      'Relative load is averaged over occupied ticks.',
      'A lower trust percentage signals rejected sensor readings, not missing data.',
    ],
    target: '[data-tour="kpi-grid"]',
    scenario: 'overview',
    placement: 'left',
  },
  {
    section: 'Tier 1 · Trust',
    title: 'Read the lie-detector proof as a three-part argument.',
    body: 'At the injected fault, the sensor reports zero while the cloud-adjusted solar almanac predicts strong sun. NeuroSkin rejects the implausible sensor reading instead of opening the facade.',
    action:
      'Read the proof chips left to right: measured value → expected value → trust decision.',
    notice: [
      'The naive controller sees only the bad sensor and opens to 0°.',
      'NeuroSkin falls back to the almanac and remains shaded.',
    ],
    target: '[data-tour="scenario-story"]',
    scenario: 'lie_detector',
    placement: 'left',
  },
  {
    section: 'Tier 1 · Events',
    title: 'Use event cards as shortcuts to evidence.',
    body: 'Annotations identify the injected dead sensor and the later genuine heavy-cloud event. They are navigation controls, not passive alerts.',
    action:
      'Click either event card. The timeline inspector jumps directly to that event so you can compare trust, mode, angles, and reason.',
    notice: [
      'Clear-sky contradiction is rejected as a sensor fault.',
      'The same low value under heavy cloud is trusted as genuine cloud gating.',
    ],
    target: '[data-tour="events"]',
    scenario: 'lie_detector',
    placement: 'left',
  },
  {
    section: 'Tier 1 · Charts',
    title: 'Interrogate the time-series evidence.',
    body: 'The first chart compares measured and expected irradiance. The second shows the control consequence: NeuroSkin versus the reactive sensor-only angle.',
    action:
      'Move the pointer across a chart to read exact values. Use the legend and annotation lines to match the fault time across both panels.',
    notice: [
      'Every chart is explicitly marked Synthetic.',
      'The important evidence is the divergence at the annotated fault—not the daily shape alone.',
    ],
    target: '[data-tour="evidence"]',
    scenario: 'lie_detector',
    placement: 'right',
  },
  {
    section: 'Tier 2 · Compare',
    title: 'Judge all three outcomes together.',
    body: 'NeuroSkin and the naive strategy receive the same seeded day. The cards compare daylight comfort, occupied relative cooling load, and full-day movement count.',
    action:
      'Look for the Better badge on all three cards, then use the charts below to see when those differences occurred.',
    notice: [
      'Daylight compliance uses occupied ticks with at least 200 W/m² available GHI.',
      'Lower load and movement are better; higher lux compliance is better.',
    ],
    target: '[data-tour="comparison"]',
    scenario: 'co_optimization',
    placement: 'left',
  },
  {
    section: 'Tier 3 · Safety',
    title: 'Verify that optimization never outranks safety.',
    body: 'This scenario includes a target that is not worth moving to and a power-loss event that bypasses the optimizer completely.',
    action:
      'Click Marginal movement declined to inspect HOLD, then click Power loss to inspect SAFE and the 60° final angle.',
    notice: [
      'HOLD preserves the current angle when benefit is below the movement budget.',
      'Power loss uses 60° fail-shaded; powered wind or rain protection uses 0° retract.',
    ],
    target: '[data-tour="events"]',
    scenario: 'budget_failsafe',
    placement: 'left',
  },
  {
    section: 'Inspect a tick',
    title: 'Scrub through every decision in the day.',
    body: 'The timeline connects summary evidence to one exact 10-minute controller decision. The badges report operating mode and whether the irradiance sensor was trusted.',
    action:
      'Drag the timeline handle. Watch time, final angle, target angle, indoor light, relative load, trust, and mode update together.',
    notice: [
      'Target is the optimizer request; final is after safety and movement rules.',
      'NORMAL moved, HOLD stayed put, and SAFE was selected by a priority override.',
    ],
    target: '[data-tour="timeline-inspector"]',
    scenario: 'budget_failsafe',
    placement: 'right',
  },
  {
    section: 'Explain a tick',
    title: 'Audit why the final angle was selected.',
    body: 'The explanation panel turns the controller state into a human-readable reason and shows how thermal, lux, movement, and risk contributed to the selected cost.',
    action:
      'After scrubbing or clicking an event, read the reason first, then compare the normalized cost bars.',
    notice: [
      'Longer bars contributed more to the selected cost.',
      'For a safety tick, the panel says the cost function was bypassed because no optimization decision was used.',
    ],
    target: '[data-tour="explanation-panel"]',
    scenario: 'budget_failsafe',
    placement: 'left',
  },
  {
    section: 'Continue exploring',
    title: 'Move through the proof without returning to the top.',
    body: 'The bottom pager follows the intended judging sequence: Overview → Lie Detector → Co-optimisation → Safety & Movement.',
    action:
      'Use Previous and Next proof, or return to the sticky tabs. Reopen this tutorial from Guided tour in the header whenever you need it.',
    notice: [
      'Try changing one input at a time and rerun to make cause and effect obvious.',
      'Use seed 42 when you want the documented reference demonstration.',
    ],
    target: '[data-tour="scenario-pager"]',
    scenario: 'budget_failsafe',
    placement: 'left',
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
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea')) return
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
    window.localStorage.setItem('neuroskin-tour-v2', 'complete')
    onOpenChange(false)
  }

  return (
    <div className='tour-layer' aria-live='polite'>
      <div
        ref={panelRef}
        className={`tour-panel tour-panel-${step.placement ?? 'right'}`}
        role='dialog'
        aria-modal='false'
        aria-labelledby='tour-title'
        aria-describedby='tour-description'
        tabIndex={-1}
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <p className='tour-kicker'>{step.section}</p>
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

        <div className='tour-progress mt-4'>
          {steps.map((item, index) => (
            <button
              key={item.title}
              aria-label={`Go to step ${index + 1}: ${item.title}`}
              className={index <= stepIndex ? 'tour-progress-active' : ''}
              onClick={() => setStepIndex(index)}
              type='button'
            />
          ))}
        </div>

        <h2
          id='tour-title'
          className='mt-5 font-display text-xl font-semibold leading-tight text-white'
        >
          {step.title}
        </h2>
        <p
          id='tour-description'
          className='mt-3 text-sm leading-6 text-white/65'
        >
          {step.body}
        </p>

        <div className='tour-action mt-4'>
          <MousePointerClick className='mt-0.5 h-4 w-4 shrink-0 text-mint' />
          <div>
            <p className='text-[10px] font-bold uppercase tracking-wider text-mint'>
              Try this
            </p>
            <p className='mt-1 text-xs leading-5 text-white/70'>
              {step.action}
            </p>
          </div>
        </div>

        <div className='mt-4 flex gap-3'>
          <Eye className='mt-0.5 h-4 w-4 shrink-0 text-sky' />
          <div>
            <p className='text-[10px] font-bold uppercase tracking-wider text-sky'>
              What to notice
            </p>
            <ul className='mt-1 space-y-1 text-xs leading-5 text-white/55'>
              {step.notice.map((item) => (
                <li key={item} className='flex gap-2'>
                  <span aria-hidden='true'>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <label className='mt-5 block'>
          <span className='text-[10px] font-bold uppercase tracking-wider text-white/35'>
            Jump to a component
          </span>
          <select
            aria-label='Jump to tour step'
            className='tour-step-select mt-2'
            value={stepIndex}
            onChange={(event) => setStepIndex(Number(event.target.value))}
          >
            {steps.map((item, index) => (
              <option key={item.title} value={index}>
                {index + 1}. {item.section} — {item.title}
              </option>
            ))}
          </select>
        </label>

        <div className='mt-5 flex items-center justify-between gap-3'>
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
