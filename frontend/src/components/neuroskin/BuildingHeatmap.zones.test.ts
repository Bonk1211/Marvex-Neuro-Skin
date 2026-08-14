import { describe, expect, it } from 'vitest'
import { slopedPanel } from './BuildingHeatmap'

/** x of the bottom-left and bottom-right corner of one zone. */
function bottomEdge(column: number, columns: number) {
  const position = slopedPanel(2, 3, 0, 1, column, columns).getAttribute(
    'position'
  )
  return [position.getX(0), position.getX(1)]
}

describe('facade zones', () => {
  it('tiles the wall across four columns, left to right, without overlap', () => {
    const edges = [0, 1, 2, 3].map((column) => bottomEdge(column, 4))
    expect(edges[0][0]).toBeCloseTo(-2, 1)
    expect(edges[3][1]).toBeCloseTo(2, 1)
    for (let column = 0; column < 3; column += 1) {
      expect(edges[column][1]).toBeLessThan(edges[column + 1][0])
    }
  })

  it('leans outward: the top edge sits further out than the bottom', () => {
    const position = slopedPanel(2, 3, 0, 1).getAttribute('position')
    expect(position.getZ(0)).toBeCloseTo(2)
    expect(position.getZ(2)).toBeCloseTo(3)
  })
})
