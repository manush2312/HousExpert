// Step-by-step "middle calculations" for a design.
//
// The designer already computes clear opening sizes correctly, but a workshop
// needs to see the working, not just the answer. This module reproduces the
// arithmetic a carpenter does by hand:
//
//   1970 - 18 - 18 = 1934      outer width less both side panels
//   1934 - 18      = 1916      less the middle partition
//   1916 / 2       =  958      split between the two openings
//
// and generalises it to any number of partitions, plus the same reasoning
// vertically for shelf cells.

import {
  getCarcassMetrics,
  getSectionBounds,
  getShelfCells,
  getUsableSectionWidth,
  type BoxLike,
  type Construction,
  type MaterialLike,
} from './furnitureConstruction'

export interface CalculationStep {
  /** Left-hand side of the sum, e.g. "1970 - 18 - 18". */
  expression: string
  result: number
  /** Plain-language reason for this step. */
  note: string
}

export interface CalculationOutcome {
  label: string
  value: number
}

export interface CalculationBlock {
  id: string
  title: string
  /** Set when the block describes one section rather than the whole unit. */
  sectionIndex?: number
  steps: CalculationStep[]
  outcomes: CalculationOutcome[]
  /** Shown when the openings are not all equal, so no division step applies. */
  note?: string
}

export interface FurnitureCalculationInput {
  outerBox: BoxLike
  material: MaterialLike
  construction: Construction
  partitions: { fromLeft: number }[]
  shelves: { fromBottom: number; sectionIndex: number }[]
}

const round = (value: number) => Math.round(value)

/** True when every entry matches the first, allowing for rounding. */
function allEqual(values: number[]) {
  if (values.length < 2) return true
  return values.every((value) => Math.abs(value - values[0]) <= 0.5)
}

function subtractionExpression(start: number, subtrahends: number[]) {
  return [round(start), ...subtrahends.map(round)].join(' - ')
}

// ── Widths ────────────────────────────────────────────────────────────────────

export function buildSectionWidthCalculation(
  input: FurnitureCalculationInput,
): CalculationBlock {
  const { outerBox, material, construction, partitions } = input
  const metrics = getCarcassMetrics(outerBox, material, construction)
  const T = metrics.thickness
  const partitionCount = partitions.length
  const sectionCount = partitionCount + 1

  const bounds = getSectionBounds(partitions.map((p) => p.fromLeft), metrics.interiorWidth)
  const usableWidths = bounds.map((section) => getUsableSectionWidth(
    section.width,
    section.index,
    bounds.length - 1,
    T,
  ))

  const steps: CalculationStep[] = [{
    expression: subtractionExpression(outerBox.width, [T, T]),
    result: round(metrics.interiorWidth),
    note: 'Outer width less both side panels',
  }]

  const totalClear = metrics.interiorWidth - partitionCount * T

  if (partitionCount > 0) {
    steps.push({
      expression: partitionCount === 1
        ? subtractionExpression(metrics.interiorWidth, [T])
        : `${round(metrics.interiorWidth)} - (${partitionCount} x ${round(T)})`,
      result: round(totalClear),
      note: partitionCount === 1
        ? 'Less the middle partition'
        : `Less ${partitionCount} partitions`,
    })
  }

  const equal = allEqual(usableWidths)

  if (equal && sectionCount > 1) {
    steps.push({
      expression: `${round(totalClear)} / ${sectionCount}`,
      result: round(totalClear / sectionCount),
      note: `Split between ${sectionCount} openings`,
    })
  }

  return {
    id: 'section-widths',
    title: 'Section widths',
    steps,
    outcomes: usableWidths.map((width, index) => ({
      label: `Section ${index + 1}`,
      value: round(width),
    })),
    note: equal || sectionCount < 2
      ? undefined
      : 'Partitions are not evenly spaced, so each opening is listed separately.',
  }
}

// ── Heights ───────────────────────────────────────────────────────────────────

export function buildSectionHeightCalculations(
  input: FurnitureCalculationInput,
): CalculationBlock[] {
  const { outerBox, material, construction, partitions, shelves } = input
  const metrics = getCarcassMetrics(outerBox, material, construction)
  const T = metrics.thickness
  const sectionCount = partitions.length + 1

  // Steps down to interior height are shared by every section.
  const baseSteps: CalculationStep[] = []
  if (metrics.baseHeight > 0) {
    baseSteps.push({
      expression: subtractionExpression(outerBox.height, [metrics.baseHeight]),
      result: round(metrics.carcassHeight),
      note: 'Overall height less the base',
    })
  }
  baseSteps.push({
    expression: subtractionExpression(metrics.carcassHeight, [T, T]),
    result: round(metrics.interiorHeight),
    note: 'Less the top and bottom panels',
  })

  return Array.from({ length: sectionCount }, (_, sectionIndex) => {
    const sectionShelves = shelves
      .filter((shelf) => shelf.sectionIndex === sectionIndex)
      .map((shelf) => shelf.fromBottom)
      .sort((a, b) => a - b)

    const cells = getShelfCells(sectionShelves, T, metrics.interiorHeight)
    const cellHeights = cells.map((cell) => cell.to - cell.from)
    const steps = [...baseSteps]
    const shelfCount = sectionShelves.length
    const totalClear = metrics.interiorHeight - shelfCount * T

    if (shelfCount > 0) {
      steps.push({
        expression: shelfCount === 1
          ? subtractionExpression(metrics.interiorHeight, [T])
          : `${round(metrics.interiorHeight)} - (${shelfCount} x ${round(T)})`,
        result: round(totalClear),
        note: shelfCount === 1 ? 'Less the shelf' : `Less ${shelfCount} shelves`,
      })
    }

    const equal = allEqual(cellHeights)

    if (equal && cells.length > 1) {
      steps.push({
        expression: `${round(totalClear)} / ${cells.length}`,
        result: round(totalClear / cells.length),
        note: `Split between ${cells.length} cells`,
      })
    }

    return {
      id: `section-heights-${sectionIndex}`,
      title: sectionCount === 1
        ? 'Shelf cell heights'
        : `Section ${sectionIndex + 1} cell heights`,
      sectionIndex,
      steps,
      outcomes: cellHeights.map((height, index) => ({
        label: `Cell ${index + 1}`,
        value: round(height),
      })),
      note: equal || cells.length < 2
        ? undefined
        : 'Shelves are not evenly spaced, so each cell is listed separately.',
    }
  })
}

export function buildFurnitureCalculations(
  input: FurnitureCalculationInput,
): CalculationBlock[] {
  return [
    buildSectionWidthCalculation(input),
    ...buildSectionHeightCalculations(input),
  ]
}

/** Flat "1970 - 18 - 18 = 1934" lines, for the PDF export. */
export function formatCalculationStep(step: CalculationStep) {
  return `${step.expression} = ${round(step.result)}`
}
