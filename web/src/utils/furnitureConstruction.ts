// Shared construction rules for the furniture designer.
//
// Every number that turns a drawn design into a real panel size lives here so
// the 2D canvas, the 3D preview and the cut list can never disagree about what
// gets cut. Nothing in this file imports the store, so it stays safe to use
// from the store itself.

export type TopFormation = 'top_over_door' | 'door_over_top'

export const TOP_FORMATIONS: TopFormation[] = ['top_over_door', 'door_over_top']

export const TOP_FORMATION_LABELS: Record<TopFormation, string> = {
  top_over_door: 'Top over door',
  door_over_top: 'Door over top',
}

export const TOP_FORMATION_DESCRIPTIONS: Record<TopFormation, string> = {
  top_over_door: 'Top panel runs the full depth and the door hangs below it.',
  door_over_top: 'Door runs up past the top panel and covers its front edge.',
}

/** Design-level build settings that change how panels are sized. */
export interface Construction {
  /** Plinth height in mm. 0 = no base. Comes OUT of the outer height. */
  baseHeight: number
  /** Padding block thickness per side, so the drawer clears the door hinges. */
  drawerSidePadding: number
  /** Runner channel allowance per side, between padding and drawer box. */
  drawerChannel: number
  /** Taken off the cabinet depth to get the default drawer depth. */
  drawerDepthReduction: number
  /** Taken off the drawer height and depth to size the box walls. */
  drawerBoxReduction: number
  topFormation: TopFormation
}

// ── Trade allowances ──────────────────────────────────────────────────────────

export const DEFAULT_BACK_PANEL_THICKNESS = 6
export const DEFAULT_BASE_HEIGHT = 75
export const DEFAULT_DRAWER_SIDE_PADDING = 36
export const DEFAULT_DRAWER_CHANNEL = 12.5
export const DEFAULT_DRAWER_DEPTH_REDUCTION = 150
export const DEFAULT_DRAWER_BOX_REDUCTION = 50

/** Height eaten by the drawer box bottom groove + running clearance. */
export const DRAWER_BOX_HEIGHT_ALLOWANCE = 6
/** Depth kept free behind a drawer box. */
export const DRAWER_DEPTH_CLEARANCE = 16
/** Vertical gap above + below a drawer front. */
export const DRAWER_FRONT_GAP = 2
/** Gap around a door on every edge. */
export const DOOR_EDGE_GAP = 1
/** Drawer bottom board thickness. */
export const DRAWER_BOTTOM_THICKNESS = 9

/**
 * Depth of the groove cut into each side panel that the back packing sits in,
 * so it grips rather than just butting against the edge. Clamped to half the
 * board so a thin side cannot be cut through.
 */
export const BACK_PACKING_GROOVE = 9

export const BASE_HEIGHT_RANGE = { min: 0, max: 300 } as const
export const DRAWER_SIDE_PADDING_RANGE = { min: 0, max: 200 } as const
export const DRAWER_CHANNEL_RANGE = { min: 0, max: 60 } as const
export const DRAWER_DEPTH_REDUCTION_RANGE = { min: 0, max: 600 } as const
export const DRAWER_BOX_REDUCTION_RANGE = { min: 0, max: 300 } as const

export const DEFAULT_CONSTRUCTION: Construction = {
  baseHeight: 0,
  drawerSidePadding: DEFAULT_DRAWER_SIDE_PADDING,
  drawerChannel: DEFAULT_DRAWER_CHANNEL,
  drawerDepthReduction: DEFAULT_DRAWER_DEPTH_REDUCTION,
  drawerBoxReduction: DEFAULT_DRAWER_BOX_REDUCTION,
  topFormation: 'top_over_door',
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.max(min, Math.min(value, max))
}

function snap(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0)
}

/** Channel sizes are half-millimetre values, so they round to 0.5 not 1. */
function snapHalf(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 2) / 2
}

export function isTopFormation(value: string | null | undefined): value is TopFormation {
  return TOP_FORMATIONS.includes(value as TopFormation)
}

/** Accepts nulls so a field the server omitted falls back to its default. */
export type ConstructionInput = {
  [K in keyof Construction]?: Construction[K] | null
}

export function normalizeConstruction(input: ConstructionInput | null | undefined): Construction {
  return {
    baseHeight: clamp(
      snap(input?.baseHeight ?? DEFAULT_CONSTRUCTION.baseHeight),
      BASE_HEIGHT_RANGE.min,
      BASE_HEIGHT_RANGE.max,
    ),
    drawerSidePadding: clamp(
      snap(input?.drawerSidePadding ?? DEFAULT_CONSTRUCTION.drawerSidePadding),
      DRAWER_SIDE_PADDING_RANGE.min,
      DRAWER_SIDE_PADDING_RANGE.max,
    ),
    drawerChannel: clamp(
      snapHalf(input?.drawerChannel ?? DEFAULT_CONSTRUCTION.drawerChannel),
      DRAWER_CHANNEL_RANGE.min,
      DRAWER_CHANNEL_RANGE.max,
    ),
    drawerDepthReduction: clamp(
      snap(input?.drawerDepthReduction ?? DEFAULT_CONSTRUCTION.drawerDepthReduction),
      DRAWER_DEPTH_REDUCTION_RANGE.min,
      DRAWER_DEPTH_REDUCTION_RANGE.max,
    ),
    drawerBoxReduction: clamp(
      snap(input?.drawerBoxReduction ?? DEFAULT_CONSTRUCTION.drawerBoxReduction),
      DRAWER_BOX_REDUCTION_RANGE.min,
      DRAWER_BOX_REDUCTION_RANGE.max,
    ),
    topFormation: isTopFormation(input?.topFormation)
      ? input.topFormation
      : DEFAULT_CONSTRUCTION.topFormation,
  }
}

// ── Carcass geometry ──────────────────────────────────────────────────────────

/** Minimal shapes so this module never has to import the store. */
export interface BoxLike { width: number; height: number; depth: number }
export interface MaterialLike { thickness: number; backPanelThickness?: number }

export interface CarcassMetrics {
  /** Plinth height, clamped so the carcass keeps at least a usable interior. */
  baseHeight: number
  /**
   * Outer height minus the base. The interior sits inside this, but the side
   * panels are NOT cut to it — they run the full height down to the floor and
   * the base rail fits between them. Use `sidePanelHeight` for cut sizes.
   */
  carcassHeight: number
  /** Sides and back run the full overall height, down to the floor. */
  sidePanelHeight: number
  interiorWidth: number
  interiorHeight: number
  interiorDepth: number
  /** mm above the floor where the carcass bottom panel starts. */
  carcassBottom: number
  /** mm above the floor where the interior starts. */
  interiorBottom: number
  thickness: number
  backPanelThickness: number
}

export function backPanelThicknessOf(material: MaterialLike) {
  return material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
}

/**
 * The single source of truth for how an outer box + material + construction
 * resolves into usable interior space. `baseHeight` is subtracted from the
 * outer height — the drawn height always includes the plinth.
 */
export function getCarcassMetrics(
  box: BoxLike,
  material: MaterialLike,
  construction: Construction = DEFAULT_CONSTRUCTION,
): CarcassMetrics {
  const T = material.thickness
  const B = backPanelThicknessOf(material)
  // Never let the plinth eat so much height that no interior is left.
  const baseHeight = clamp(construction.baseHeight, 0, Math.max(0, box.height - T * 2 - 1))
  const carcassHeight = box.height - baseHeight

  return {
    baseHeight,
    carcassHeight,
    sidePanelHeight: box.height,
    interiorWidth: box.width - T * 2,
    interiorHeight: carcassHeight - T * 2,
    interiorDepth: Math.max(1, box.depth - B),
    carcassBottom: baseHeight,
    interiorBottom: baseHeight + T,
    thickness: T,
    backPanelThickness: B,
  }
}

// ── Sections ──────────────────────────────────────────────────────────────────

/**
 * A partition sits on its centreline, so each side of it steals half a
 * thickness from the neighbouring opening. Edge sections butt the carcass side
 * and lose nothing.
 */
export function getSectionInsets(index: number, lastIndex: number, thickness: number) {
  return {
    left: index === 0 ? 0 : thickness / 2,
    right: index === lastIndex ? 0 : thickness / 2,
  }
}

/** Clear opening width of a section, measured between panel faces. */
export function getUsableSectionWidth(
  sectionWidth: number,
  index: number,
  lastIndex: number,
  thickness: number,
) {
  const inset = getSectionInsets(index, lastIndex, thickness)
  return sectionWidth - inset.left - inset.right
}

/** Section boundaries from partition centrelines, left to right. */
export function getSectionBounds(partitionOffsets: number[], interiorWidth: number) {
  const sorted = [...partitionOffsets].sort((a, b) => a - b)
  const bounds = [0, ...sorted, interiorWidth]
  return bounds.slice(0, -1).map((fromLeft, index) => ({
    index,
    fromLeft,
    toLeft: bounds[index + 1],
    width: bounds[index + 1] - fromLeft,
  }))
}

// ── Drawers ───────────────────────────────────────────────────────────────────

export interface DrawerWidths {
  /** Clearance actually applied per side — reduced if the opening is too narrow. */
  sidePadding: number
  /** Visible drawer front width. */
  frontWidth: number
  /** Drawer box outer width, inside the runner channels. */
  boxWidth: number
}

/**
 * The drawer is inset from BOTH sides of its opening by a padding block, so the
 * door hinges have room to swing shut. The runner channel then sits between the
 * padding and the box.
 *
 *   opening 900 - 36 - 36            = 828  front
 *   828     - 12.5 - 12.5            = 803  box outer
 */
export function getDrawerWidths(
  openingWidth: number,
  construction: Construction = DEFAULT_CONSTRUCTION,
): DrawerWidths {
  const requested = Math.max(0, construction.drawerSidePadding)
  // Keep at least 1mm of front even in an opening too narrow for full padding.
  const maxPadding = Math.max(0, (openingWidth - 1) / 2)
  const sidePadding = Math.min(requested, maxPadding)
  const frontWidth = Math.max(0, openingWidth - sidePadding * 2)
  const boxWidth = Math.max(0, frontWidth - construction.drawerChannel * 2)

  return { sidePadding, frontWidth, boxWidth }
}

/** Default drawer depth: cabinet depth less the depth reduction. */
export function getDefaultDrawerDepth(
  cabinetDepth: number,
  construction: Construction = DEFAULT_CONSTRUCTION,
) {
  return Math.max(1, cabinetDepth - construction.drawerDepthReduction)
}

/** A drawer can never be deeper than the carcass that holds it. */
export function clampDrawerDepth(
  depth: number | undefined,
  cabinetDepth: number,
  construction: Construction = DEFAULT_CONSTRUCTION,
) {
  const fallback = getDefaultDrawerDepth(cabinetDepth, construction)
  if (!depth || !Number.isFinite(depth) || depth <= 0) return fallback
  return Math.max(1, Math.min(Math.round(depth), Math.round(cabinetDepth)))
}

/** Every board that makes up one drawer, keyed to the numbering on the sketch. */
export interface DrawerParts {
  /** Padding applied per side after any narrow-opening clamp. */
  sidePadding: number
  /** Visible front. */
  frontWidth: number
  /** Box outer width, between the runner channels. */
  boxOuterWidth: number
  /** Sides (1) and (3) — run across the width, fitted between (2) and (4). */
  crossMemberLength: number
  /** Sides (2) and (4) — run front to back. */
  sideMemberLength: number
  /** Height of all four box walls. */
  wallHeight: number
  /** Bottom sits under the walls, so it is the full box footprint. */
  bottomWidth: number
  bottomDepth: number
  /** One padding block per side. */
  paddingThickness: number
  paddingHeight: number
  paddingDepth: number
}

/**
 * Resolves one drawer into cut sizes, following the shop arithmetic:
 *
 *   936 - 36 (carcass sides) - 36 - 36 (paddings)
 *       - 12.5 - 12.5 (channels) - 36 (box sides) = 767
 *
 * `boardThickness` is the design's board thickness — the box walls are cut from
 * the same material as the carcass.
 */
export function getDrawerParts(input: {
  openingWidth: number
  drawerHeight: number
  drawerDepth: number
  cabinetDepth: number
  boardThickness: number
  construction?: Construction
}): DrawerParts {
  const construction = input.construction ?? DEFAULT_CONSTRUCTION
  const { sidePadding, frontWidth, boxOuterWidth } = (() => {
    const w = getDrawerWidths(input.openingWidth, construction)
    return { sidePadding: w.sidePadding, frontWidth: w.frontWidth, boxOuterWidth: w.boxWidth }
  })()

  const reduction = construction.drawerBoxReduction
  const T = input.boardThickness

  return {
    sidePadding,
    frontWidth,
    boxOuterWidth,
    crossMemberLength: Math.max(0, boxOuterWidth - T * 2),
    sideMemberLength: Math.max(0, input.drawerDepth - reduction),
    wallHeight: Math.max(0, input.drawerHeight - reduction),
    bottomWidth: boxOuterWidth,
    bottomDepth: Math.max(0, input.drawerDepth - reduction),
    paddingThickness: sidePadding,
    paddingHeight: input.drawerHeight,
    paddingDepth: Math.max(0, input.cabinetDepth - reduction),
  }
}

export function getMinDrawerHeight(thickness: number) {
  return Math.max(20, thickness + DRAWER_BOX_HEIGHT_ALLOWANCE + 1)
}

// ── Doors + top formation ─────────────────────────────────────────────────────

/**
 * `door_over_top` runs the door up across the front edge of the top panel, so
 * the door gains one board thickness and the top panel loses that much depth.
 */
export function getDoorHeight(interiorHeight: number, thickness: number, formation: TopFormation) {
  const raw = formation === 'door_over_top' ? interiorHeight + thickness : interiorHeight
  return Math.max(0, raw - DOOR_EDGE_GAP * 2)
}

export function getTopPanelDepth(depth: number, thickness: number, formation: TopFormation) {
  return formation === 'door_over_top' ? Math.max(1, depth - thickness) : depth
}

/** mm above the interior bottom where a door starts. */
export function getDoorBottomOffset() {
  return DOOR_EDGE_GAP
}

// ── Base / plinth ─────────────────────────────────────────────────────────────

export interface BasePieceSizes {
  /** The rail spans the clear interior width, between the two side panels. */
  railLength: number
  height: number
  thickness: number
}

/**
 * A single front rail fitted between the side panels, which run the full
 * height to the floor. The rail is the interior width, not the outer width.
 */
export function getBasePieceSizes(
  material: MaterialLike,
  metrics: CarcassMetrics,
): BasePieceSizes | null {
  if (metrics.baseHeight <= 0) return null
  return {
    railLength: metrics.interiorWidth,
    height: metrics.baseHeight,
    thickness: material.thickness,
  }
}

// ── Back packing ──────────────────────────────────────────────────────────────

export interface BackPackingSize {
  /** Outer width less one groove depth per side. */
  width: number
  /** Runs the full overall height, past the base. */
  height: number
  thickness: number
  /** How far it is let into each side panel. */
  groove: number
}

/** Groove depth, never more than half the side panel it is cut into. */
export function getBackPackingGroove(thickness: number) {
  return Math.min(BACK_PACKING_GROOVE, thickness / 2)
}

export function getBackPackingSize(
  box: BoxLike,
  material: MaterialLike,
  metrics: CarcassMetrics,
): BackPackingSize {
  const groove = getBackPackingGroove(metrics.thickness)
  return {
    width: Math.max(1, box.width - groove * 2),
    height: box.height,
    thickness: backPanelThicknessOf(material),
    groove,
  }
}

// ── Shelf cells ───────────────────────────────────────────────────────────────

export interface ShelfCell { from: number; to: number }

/**
 * The open gaps between shelves, measured between shelf FACES rather than
 * centrelines. `shelfCentres` must be sorted ascending and measured from the
 * interior bottom.
 */
export function getShelfCells(
  shelfCentres: number[],
  thickness: number,
  interiorHeight: number,
): ShelfCell[] {
  const cells: ShelfCell[] = []
  let prevTop = 0
  for (const centre of shelfCentres) {
    const shelfBottomFace = Math.max(prevTop, centre - thickness / 2)
    cells.push({ from: prevTop, to: shelfBottomFace })
    prevTop = centre + thickness / 2
  }
  cells.push({ from: prevTop, to: interiorHeight })
  return cells
}
