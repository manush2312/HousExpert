import type {
  FurnitureMeasurementDepthReference,
  FurnitureMeasurementHorizontalReference,
  FurnitureMeasurementPanelReference,
  FurnitureMeasurementVerticalReference,
} from '../stores/furniturePreviewStore'

export interface FurnitureMeasurementSettings {
  horizontalReference: FurnitureMeasurementHorizontalReference
  verticalReference: FurnitureMeasurementVerticalReference
  depthReference: FurnitureMeasurementDepthReference
  panelReference: FurnitureMeasurementPanelReference
}

export interface FurnitureMeasurementContext {
  outerWidth: number
  outerHeight: number
  interiorWidth: number
  interiorHeight: number
  thickness: number
}

export interface FurnitureMeasurementSection {
  fromLeft: number
  toLeft: number
}

export const HORIZONTAL_REFERENCE_LABELS: Record<FurnitureMeasurementHorizontalReference, string> = {
  interior_left: 'Int L',
  exterior_left: 'Ext L',
  section_start: 'Section',
  interior_right: 'Int R',
  exterior_right: 'Ext R',
}

export const VERTICAL_REFERENCE_LABELS: Record<FurnitureMeasurementVerticalReference, string> = {
  interior_bottom: 'Int B',
  exterior_bottom: 'Ext B',
  interior_top: 'Int T',
  exterior_top: 'Ext T',
}

export const DEPTH_REFERENCE_LABELS: Record<FurnitureMeasurementDepthReference, string> = {
  front: 'Front',
  back: 'Back',
}

export const PANEL_REFERENCE_LABELS: Record<FurnitureMeasurementPanelReference, string> = {
  centerline: 'Center',
  near_face: 'Near face',
  far_face: 'Far face',
}

export function horizontalMeasurementLabel(reference: FurnitureMeasurementHorizontalReference) {
  switch (reference) {
    case 'interior_left':
      return 'From int left'
    case 'exterior_left':
      return 'From ext left'
    case 'section_start':
      return 'From section'
    case 'interior_right':
      return 'From int right'
    case 'exterior_right':
      return 'From ext right'
  }
}

export function verticalMeasurementLabel(reference: FurnitureMeasurementVerticalReference) {
  switch (reference) {
    case 'interior_bottom':
      return 'From int bottom'
    case 'exterior_bottom':
      return 'From ext bottom'
    case 'interior_top':
      return 'From int top'
    case 'exterior_top':
      return 'From ext top'
  }
}

export function depthMeasurementLabel(reference: FurnitureMeasurementDepthReference) {
  return reference === 'front' ? 'From front' : 'From back'
}

export function horizontalMeasurementExtent(
  reference: FurnitureMeasurementHorizontalReference,
  context: FurnitureMeasurementContext,
  section?: FurnitureMeasurementSection,
) {
  if (reference === 'section_start' && section) return Math.max(1, section.toLeft - section.fromLeft)
  if (reference === 'exterior_left' || reference === 'exterior_right') return context.outerWidth
  return context.interiorWidth
}

export function verticalMeasurementExtent(
  reference: FurnitureMeasurementVerticalReference,
  context: FurnitureMeasurementContext,
) {
  if (reference === 'exterior_bottom' || reference === 'exterior_top') return context.outerHeight
  return context.interiorHeight
}

export function displayHorizontalPoint(
  pointFromInteriorLeft: number,
  reference: FurnitureMeasurementHorizontalReference,
  context: FurnitureMeasurementContext,
  sectionStart = 0,
) {
  switch (reference) {
    case 'interior_left':
      return pointFromInteriorLeft
    case 'exterior_left':
      return pointFromInteriorLeft + context.thickness
    case 'section_start':
      return pointFromInteriorLeft - sectionStart
    case 'interior_right':
      return context.interiorWidth - pointFromInteriorLeft
    case 'exterior_right':
      return context.outerWidth - context.thickness - pointFromInteriorLeft
  }
}

export function horizontalPointFromDisplay(
  displayedValue: number,
  reference: FurnitureMeasurementHorizontalReference,
  context: FurnitureMeasurementContext,
  sectionStart = 0,
) {
  switch (reference) {
    case 'interior_left':
      return displayedValue
    case 'exterior_left':
      return displayedValue - context.thickness
    case 'section_start':
      return sectionStart + displayedValue
    case 'interior_right':
      return context.interiorWidth - displayedValue
    case 'exterior_right':
      return context.outerWidth - context.thickness - displayedValue
  }
}

export function displayVerticalPoint(
  pointFromInteriorBottom: number,
  reference: FurnitureMeasurementVerticalReference,
  context: FurnitureMeasurementContext,
) {
  switch (reference) {
    case 'interior_bottom':
      return pointFromInteriorBottom
    case 'exterior_bottom':
      return pointFromInteriorBottom + context.thickness
    case 'interior_top':
      return context.interiorHeight - pointFromInteriorBottom
    case 'exterior_top':
      return context.outerHeight - context.thickness - pointFromInteriorBottom
  }
}

export function verticalPointFromDisplay(
  displayedValue: number,
  reference: FurnitureMeasurementVerticalReference,
  context: FurnitureMeasurementContext,
) {
  switch (reference) {
    case 'interior_bottom':
      return displayedValue
    case 'exterior_bottom':
      return displayedValue - context.thickness
    case 'interior_top':
      return context.interiorHeight - displayedValue
    case 'exterior_top':
      return context.outerHeight - context.thickness - displayedValue
  }
}

export function displayHorizontalPanelPosition(
  centerFromInteriorLeft: number,
  settings: Pick<FurnitureMeasurementSettings, 'horizontalReference' | 'panelReference'>,
  context: FurnitureMeasurementContext,
  sectionStart = 0,
) {
  const point = horizontalPanelPointFromCenter(centerFromInteriorLeft, settings, context.thickness)
  return Math.round(displayHorizontalPoint(point, settings.horizontalReference, context, sectionStart))
}

export function horizontalPanelCenterFromDisplay(
  displayedValue: number,
  settings: Pick<FurnitureMeasurementSettings, 'horizontalReference' | 'panelReference'>,
  context: FurnitureMeasurementContext,
  sectionStart = 0,
) {
  const point = horizontalPointFromDisplay(displayedValue, settings.horizontalReference, context, sectionStart)
  return Math.round(horizontalPanelCenterFromPoint(point, settings, context.thickness))
}

export function displayVerticalPanelPosition(
  centerFromInteriorBottom: number,
  settings: Pick<FurnitureMeasurementSettings, 'verticalReference' | 'panelReference'>,
  context: FurnitureMeasurementContext,
) {
  const point = verticalPanelPointFromCenter(centerFromInteriorBottom, settings, context.thickness)
  return Math.round(displayVerticalPoint(point, settings.verticalReference, context))
}

export function verticalPanelCenterFromDisplay(
  displayedValue: number,
  settings: Pick<FurnitureMeasurementSettings, 'verticalReference' | 'panelReference'>,
  context: FurnitureMeasurementContext,
) {
  const point = verticalPointFromDisplay(displayedValue, settings.verticalReference, context)
  return Math.round(verticalPanelCenterFromPoint(point, settings, context.thickness))
}

export function displayHorizontalBoxOffset(
  fromInteriorLeft: number,
  width: number,
  reference: FurnitureMeasurementHorizontalReference,
  context: FurnitureMeasurementContext,
  sectionStart = 0,
) {
  const point = horizontalReferenceReadsFromRight(reference)
    ? fromInteriorLeft + width
    : fromInteriorLeft
  return Math.round(displayHorizontalPoint(point, reference, context, sectionStart))
}

export function horizontalBoxOffsetFromDisplay(
  displayedValue: number,
  width: number,
  reference: FurnitureMeasurementHorizontalReference,
  context: FurnitureMeasurementContext,
  sectionStart = 0,
) {
  const point = horizontalPointFromDisplay(displayedValue, reference, context, sectionStart)
  return Math.round(horizontalReferenceReadsFromRight(reference) ? point - width : point)
}

export function displayVerticalBoxOffset(
  fromInteriorBottom: number,
  height: number,
  reference: FurnitureMeasurementVerticalReference,
  context: FurnitureMeasurementContext,
) {
  const point = verticalReferenceReadsFromTop(reference)
    ? fromInteriorBottom + height
    : fromInteriorBottom
  return Math.round(displayVerticalPoint(point, reference, context))
}

export function verticalBoxOffsetFromDisplay(
  displayedValue: number,
  height: number,
  reference: FurnitureMeasurementVerticalReference,
  context: FurnitureMeasurementContext,
) {
  const point = verticalPointFromDisplay(displayedValue, reference, context)
  return Math.round(verticalReferenceReadsFromTop(reference) ? point - height : point)
}

export function displayDepthOffset(
  frontOffset: number,
  maxFrontOffset: number,
  reference: FurnitureMeasurementDepthReference,
) {
  return reference === 'front'
    ? Math.round(frontOffset)
    : Math.round(Math.max(0, maxFrontOffset - frontOffset))
}

export function depthOffsetFromDisplay(
  displayedValue: number,
  maxFrontOffset: number,
  reference: FurnitureMeasurementDepthReference,
) {
  return reference === 'front'
    ? Math.round(displayedValue)
    : Math.round(Math.max(0, maxFrontOffset - displayedValue))
}

export function getInteriorSections(
  partitions: Array<{ fromLeft: number }>,
  interiorWidth: number,
) {
  const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
  const boundaries = [0, ...sorted.map((partition) => partition.fromLeft), interiorWidth]
  return boundaries.slice(0, -1).map((fromLeft, index) => ({
    index,
    fromLeft,
    toLeft: boundaries[index + 1],
  }))
}

export function getSectionForIndex(
  partitions: Array<{ fromLeft: number }>,
  interiorWidth: number,
  sectionIndex: number,
) {
  return getInteriorSections(partitions, interiorWidth)[sectionIndex]
}

export function getSectionForHorizontalRange(
  partitions: Array<{ fromLeft: number }>,
  interiorWidth: number,
  fromLeft: number,
  width = 0,
) {
  const point = fromLeft + width / 2
  return getInteriorSections(partitions, interiorWidth)
    .find((section) => point >= section.fromLeft && point <= section.toLeft)
}

function horizontalReferenceReadsFromRight(reference: FurnitureMeasurementHorizontalReference) {
  return reference === 'interior_right' || reference === 'exterior_right'
}

function verticalReferenceReadsFromTop(reference: FurnitureMeasurementVerticalReference) {
  return reference === 'interior_top' || reference === 'exterior_top'
}

function horizontalPanelPointFromCenter(
  centerFromInteriorLeft: number,
  settings: Pick<FurnitureMeasurementSettings, 'horizontalReference' | 'panelReference'>,
  thickness: number,
) {
  if (settings.panelReference === 'centerline') return centerFromInteriorLeft

  const nearFaceIsLeft = !horizontalReferenceReadsFromRight(settings.horizontalReference)
  const offset = thickness / 2

  if (settings.panelReference === 'near_face') {
    return centerFromInteriorLeft + (nearFaceIsLeft ? -offset : offset)
  }

  return centerFromInteriorLeft + (nearFaceIsLeft ? offset : -offset)
}

function horizontalPanelCenterFromPoint(
  pointFromInteriorLeft: number,
  settings: Pick<FurnitureMeasurementSettings, 'horizontalReference' | 'panelReference'>,
  thickness: number,
) {
  if (settings.panelReference === 'centerline') return pointFromInteriorLeft

  const nearFaceIsLeft = !horizontalReferenceReadsFromRight(settings.horizontalReference)
  const offset = thickness / 2

  if (settings.panelReference === 'near_face') {
    return pointFromInteriorLeft + (nearFaceIsLeft ? offset : -offset)
  }

  return pointFromInteriorLeft + (nearFaceIsLeft ? -offset : offset)
}

function verticalPanelPointFromCenter(
  centerFromInteriorBottom: number,
  settings: Pick<FurnitureMeasurementSettings, 'verticalReference' | 'panelReference'>,
  thickness: number,
) {
  if (settings.panelReference === 'centerline') return centerFromInteriorBottom

  const nearFaceIsBottom = !verticalReferenceReadsFromTop(settings.verticalReference)
  const offset = thickness / 2

  if (settings.panelReference === 'near_face') {
    return centerFromInteriorBottom + (nearFaceIsBottom ? -offset : offset)
  }

  return centerFromInteriorBottom + (nearFaceIsBottom ? offset : -offset)
}

function verticalPanelCenterFromPoint(
  pointFromInteriorBottom: number,
  settings: Pick<FurnitureMeasurementSettings, 'verticalReference' | 'panelReference'>,
  thickness: number,
) {
  if (settings.panelReference === 'centerline') return pointFromInteriorBottom

  const nearFaceIsBottom = !verticalReferenceReadsFromTop(settings.verticalReference)
  const offset = thickness / 2

  if (settings.panelReference === 'near_face') {
    return pointFromInteriorBottom + (nearFaceIsBottom ? offset : -offset)
  }

  return pointFromInteriorBottom + (nearFaceIsBottom ? -offset : offset)
}
