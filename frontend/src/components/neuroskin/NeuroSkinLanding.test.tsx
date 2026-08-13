import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NeuroSkinLanding } from './NeuroSkinLanding'

describe('NeuroSkinLanding', () => {
  it('holds the product explanation and routes users to the focused dashboard', () => {
    render(<NeuroSkinLanding />)

    expect(
      screen.getByRole('heading', {
        name: /A facade controller you can judge/i,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Detect a lying irradiance sensor.')
    ).toBeInTheDocument()
    expect(screen.getByText(/C\(θ\) = wT · L\(θ\)/)).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', {
        name: /dashboard|simulation|NeuroSkin OS/i,
      })[0]
    ).toHaveAttribute('href', '/dashboard')
  })
})
