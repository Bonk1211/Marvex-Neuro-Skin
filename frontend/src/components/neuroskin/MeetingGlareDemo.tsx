'use client'

import type { MeetingDemoResponse, MeetingLight } from '@/lib/api-client'
import type { TickPayload } from '@/lib/types'

export type MeetingStage = NonNullable<TickPayload['meeting_demo']>
export const MEETING_MOVE_MS = 7500

export function meetingDemoTick(
  tick: TickPayload,
  demo: MeetingDemoResponse,
  stage: MeetingStage,
  actuatorAngle: number | null = null
): TickPayload {
  const light = stage === 'balanced' ? demo.balanced : demo.glare
  const angle = stage === 'ready' ? demo.glare.angle : demo.balanced.angle
  return {
    ...tick,
    meeting_demo: stage,
    meeting_actuator_angle: actuatorAngle,
    solar_azimuth: demo.solar_azimuth,
    solar_elevation: demo.solar_elevation,
    cloud: 0.5,
    daylight: {
      model: 'Scripted meeting · optics + radiosity',
      night: false,
      occupied: true,
      ev_cap_lux: demo.ev_cap_lux,
      et_band_low_lux: 300,
      et_band_high_lux: 500,
      demo_control: true,
    },
    facade: tick.facade.map((wall) =>
      wall.orientation !== 'west'
        ? wall
        : {
            ...wall,
            angle: angle / 16,
            reason: 'Scripted meeting demo · W13 responds; other zones hold.',
            zones: wall.zones?.map((zone) => {
              const meeting = zone.zone === 'W13'
              const local = meeting ? light : demo.shaded
              const probes =
                zone.row !== 3
                  ? []
                  : local.probes.filter((probe) => {
                      // One control zone serves the complete meeting room, including seat 4
                      // next to its bay boundary. The other occupied room belongs to W16.
                      if (probe.index < 4) return meeting
                      return (
                        zone.zone === 'W16' &&
                        (probe.index === 12 || probe.index === 13)
                      )
                    })
              const et = probes.length
                ? probes.reduce(
                    (sum, p) => sum + (p.task_illuminance ?? 0),
                    0
                  ) / probes.length
                : 0
              const ev = Math.max(
                0,
                ...probes.map((p) => p.eye_illuminance ?? 0)
              )
              return {
                ...zone,
                angle: meeting ? angle : 0,
                angle_target: meeting ? angle : 0,
                moved: meeting && stage !== 'ready',
                mode: 'DEMO',
                incident: (meeting ? 120 : 0) + 20,
                transmitted: local.beam + local.diffuse,
                diffuse_incident: 20,
                diffuse_transmitted: local.diffuse,
                sunlit_fraction: meeting ? 1 : 0,
                lux: et,
                sensors: undefined,
                control_input: undefined,
                assurance: undefined,
                cost_breakdown: undefined,
                reason: meeting
                  ? 'Meeting room · local glare response'
                  : 'Local cloud shade · hold position',
                conditions: {
                  daylight_status:
                    et < 300 ? 'low' : et > 500 ? 'high' : 'useful',
                  transmitted: local.beam + local.diffuse,
                  solar_heat_gain: (local.beam + local.diffuse) * 0.4,
                  direct_sun: local.beam,
                  glare_risk: ev > demo.ev_cap_lux,
                  glare_limit_w_m2: 25,
                  glazing_shgc: 0.4,
                  task_illuminance: probes.length ? et : null,
                  eye_illuminance: probes.length ? ev : null,
                  daylight_probes: probes,
                },
              }
            }),
          }
    ),
  }
}

function summary(light: MeetingLight, seats: number[]) {
  const probes = light.probes.filter((p) => seats.includes(p.index))
  return `Ev ${Math.max(...probes.map((p) => p.eye_illuminance ?? 0)).toFixed(0)} lx · Et ${(probes.reduce((sum, p) => sum + (p.task_illuminance ?? 0), 0) / probes.length).toFixed(0)} lx`
}

export function MeetingGlareDemo({
  demo,
  stage,
  actuatorAngle = null,
  loading,
  error,
  onStart,
  onStage,
  onExit,
}: {
  demo: MeetingDemoResponse | null
  stage: MeetingStage | null
  actuatorAngle?: number | null
  loading: boolean
  error: string | null
  onStart: () => void
  onStage: (stage: MeetingStage) => void
  onExit: () => void
}) {
  const light = demo && (stage === 'balanced' ? demo.balanced : demo.glare)
  const angle =
    demo && (stage === 'ready' ? demo.glare.angle : demo.balanced.angle)
  const visibleAngle =
    angle == null || actuatorAngle == null
      ? angle
      : (angle * actuatorAngle) / 180
  const comfortable =
    stage === 'balanced' &&
    !!light &&
    light.probes
      .slice(0, 4)
      .every(
        (p) =>
          p.eye_illuminance != null &&
          p.eye_illuminance <= (demo?.ev_cap_lux ?? 1000) &&
          p.task_illuminance != null &&
          p.task_illuminance >= 300 &&
          p.task_illuminance <= 500
      )
  return (
    <section className='console-card' aria-label='West Floor 7 meeting demo'>
      <h3 className='console-card-title'>West · Floor 7 · zone control</h3>
      <p className='mt-2 text-xs'>
        Four people meet at seats 1–4. Two people work at seats 13–14 under
        local cloud shade.
      </p>
      {!stage ? (
        <button
          className='run-button-light mt-3'
          disabled={loading}
          onClick={onStart}
        >
          {loading ? 'Preparing predictions…' : 'Set up meeting demo'}
        </button>
      ) : (
        <>
          <div className='mt-3 flex flex-wrap gap-2'>
            <button
              className='run-button-light'
              disabled={stage !== 'ready'}
              onClick={() => onStage('glare')}
            >
              Simulate glare
            </button>
            <button className='band-button' onClick={() => onStage('ready')}>
              Reset demo
            </button>
            <button className='band-button' onClick={onExit}>
              Exit demo
            </button>
          </div>
          <p className='mt-3 text-xs font-semibold' role='status'>
            {stage === 'ready'
              ? 'High glare · meeting room needs shading'
              : stage === 'glare'
                ? 'W13 is adjusting · sunlight path is shifting…'
                : comfortable
                  ? 'Comfort restored · 15 other zones hold'
                  : 'W13 adjusted · review comfort readings'}
          </p>
          {demo && light && (
            <>
              <div
                aria-label='Meeting room comfort'
                className={`mt-3 rounded-lg border p-3 text-xs transition-colors ${comfortable ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-amber-400 bg-amber-50 text-amber-900'}`}
              >
                <strong>Seats 1–4 · meeting · W13 / BH1</strong>
                <p className='mt-2 text-lg font-bold tabular-nums'>
                  {summary(light, [0, 1, 2, 3])}
                </p>
                <p className='mt-1'>
                  Hardware 0° → {stage === 'ready' ? 0 : 180}° ·{' '}
                  {stage === 'balanced'
                    ? comfortable
                      ? 'Comfort targets met'
                      : 'Review comfort readings'
                    : stage === 'glare'
                      ? 'adjusting the meeting zone'
                      : 'high Ev / Et · direct sun on table'}
                </p>
                <p className='mt-1 text-[10px]'>
                  Modelled façade {demo.glare.angle}° → {angle}° · Ev/Et
                  prediction
                </p>
                <p className='mt-1 text-[10px]'>
                  {actuatorAngle == null
                    ? 'Sun path · simulated motion'
                    : `Sun path follows BH1 · reported command ${actuatorAngle.toFixed(1)}°`}
                </p>
                {stage === 'balanced' && (
                  <p className='mt-1 text-[10px]'>
                    Before: {summary(demo.glare, [0, 1, 2, 3])}
                  </p>
                )}
              </div>
              <div className='border-sky-200 bg-sky-50 mt-2 rounded-lg border p-3 text-xs'>
                <strong>Seats 13–14 · cloud shade · W16</strong>
                <p className='mt-1'>{summary(demo.shaded, [12, 13])}</p>
                <p className='mt-1'>
                  No direct sun · 0° held · no movement needed
                </p>
              </div>
              <div
                className='mt-3 grid grid-cols-4 gap-1'
                aria-label='West 4 by 4 zone array'
              >
                {Array.from(
                  { length: 16 },
                  (_, i) => 13 - Math.floor(i / 4) * 4 + (i % 4)
                ).map((id) => (
                  <div
                    key={id}
                    className={`rounded border p-1 text-center text-[10px] ${id === 13 ? (comfortable ? 'border-emerald-400 bg-emerald-100 text-emerald-800' : 'border-amber-400 bg-amber-100') : 'border-border'}`}
                  >
                    W{id}
                    <svg
                      viewBox='0 0 48 30'
                      className='mx-auto h-7 w-10'
                      aria-hidden='true'
                    >
                      {[7, 15, 23].map((y) => (
                        <g key={y} transform={`translate(24 ${y})`}>
                          <rect
                            x='-16'
                            y='-1.5'
                            width='32'
                            height='3'
                            rx='1'
                            fill='currentColor'
                            className='transition-transform motion-reduce:transition-none'
                            style={{
                              transform: `rotate(${id === 13 ? visibleAngle : 0}deg)`,
                              transitionDuration: `${actuatorAngle == null ? MEETING_MOVE_MS - 500 : 500}ms`,
                            }}
                          />
                        </g>
                      ))}
                    </svg>
                    {id === 13 ? angle : 0}°<br />
                    {id === 13 && stage !== 'ready'
                      ? stage === 'glare'
                        ? 'moving'
                        : 'adjusted'
                      : 'hold'}
                  </div>
                ))}
              </div>
              <p className='mt-2 text-[10px] text-muted-foreground'>
                Ev: highest occupied seat · Et: mean task light. Targets: Ev ≤{' '}
                {demo.ev_cap_lux} lx, Et 300–500 lx.
              </p>
            </>
          )}
        </>
      )}
      {error && (
        <p role='alert' className='mt-2 text-xs text-rose-700'>
          {error}
        </p>
      )}
      <p className='mt-2 text-[10px] text-muted-foreground'>
        Scripted demo · modelled Ev/Et. Local cloud shade is simulated.
      </p>
      {stage && (
        <p className='mt-2 text-[10px] text-muted-foreground'>
          Simulate glare connects BH1 automatically when the rig is online.
          Reset to repeat the sweep.
        </p>
      )}
      {demo && stage && (
        <details className='mt-2 text-[10px] text-muted-foreground'>
          <summary>Prediction model</summary>
          <p className='mt-1'>{demo.provenance}</p>
        </details>
      )}
    </section>
  )
}
