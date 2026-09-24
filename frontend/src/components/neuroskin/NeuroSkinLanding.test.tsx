import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NeuroSkinLanding } from './NeuroSkinLanding'

describe('NeuroSkinLanding', () => {
  it('presents the three product differentiators with honest release status and direct demo entry', () => {
    render(<NeuroSkinLanding />)

    expect(
      screen.getByRole('heading', {
        name: /One twin. Local control. Visible decisions./i,
      })
    ).toBeInTheDocument()
    for (const title of [
      'Interactive digital twin',
      'Independent 4×4 zones',
      'Three-layer mechatronic brain',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(
      screen.getByRole('img', {
        name: /Four facades, each with a 4 by 4 array of 16 independent logical zones; 64 zones in total. Illustrative states./,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('One orchestrator · one shared policy')
    ).toBeInTheDocument()
    expect(screen.getByText('SIMULATED · PEER-CHECKED')).toBeInTheDocument()
    expect(screen.getByText('OBSERVE-ONLY')).toBeInTheDocument()
    expect(screen.getByText('SIMULATED · DETERMINISTIC')).toBeInTheDocument()
    expect(
      screen.getByText(/An LLM diagnosis agent remains planned/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/they do not yet drive control/)
    ).toBeInTheDocument()

    for (const [view, name] of [
      ['building', 'Building See exposure'],
      ['floor', 'Floor Inspect a zone'],
      ['brains', 'Brains Trace the decision'],
      ['feeds', 'Feeds Check the evidence'],
    ]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'href',
        `/dashboard?view=${view}`
      )
    }
    expect(
      screen.getByRole('link', { name: /Explore the digital twin/ })
    ).toHaveAttribute('href', '/dashboard?view=building')  })
})
