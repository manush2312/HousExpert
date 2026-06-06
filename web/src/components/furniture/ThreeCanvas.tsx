import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Html, Line, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  DEFAULT_BACK_PANEL_THICKNESS,
  DEFAULT_SECTION_CONFIG,
  useFurnitureStore,
} from '../../stores/furnitureStore'
import {
  getCustomFurnitureMaterialForAssignment,
  getFurniturePreviewAssignmentForArea,
  getFurniturePreviewMaterialForAssignment,
  useFurniturePreviewStore,
  type FurniturePreviewBackground,
  type FurniturePreviewMaterial,
  type FurniturePreviewMaterialArea,
  type FurniturePreviewView,
} from '../../stores/furniturePreviewStore'
import type { CustomFurnitureMaterial, FurnitureMaterialFinish, FurnitureMaterialGrainDirection } from '../../types/furnitureMaterials'

// ── Unit conversion ───────────────────────────────────────────────────────────
// 1 Three.js unit = 1000 mm (= 1 metre)
function u(mm: number) { return mm / 1000 }

type ExplodeOffset = [number, number, number]
type Point3 = [number, number, number]
type FurniturePreviewSurface = {
  previewMaterial: FurniturePreviewMaterial
  customMaterial: CustomFurnitureMaterial | null
}

const NO_EXPLODE_OFFSET: ExplodeOffset = [0, 0, 0]

const CANVAS_BACKGROUND: Record<FurniturePreviewBackground, string> = {
  dark: 'linear-gradient(160deg, #1e1e2e 0%, #16161f 100%)',
  light: 'linear-gradient(160deg, #f8fafc 0%, #eef2f7 100%)',
}

const GRID_COLORS: Record<FurniturePreviewBackground, [string, string]> = {
  dark: ['#333333', '#222222'],
  light: ['#cbd5e1', '#e2e8f0'],
}

const FINISH_RENDER_SETTINGS: Record<FurnitureMaterialFinish, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.86, metalness: 0.02 },
  satin: { roughness: 0.58, metalness: 0.03 },
  glossy: { roughness: 0.28, metalness: 0.04 },
  laminate: { roughness: 0.48, metalness: 0.03 },
  veneer: { roughness: 0.66, metalness: 0.02 },
  acrylic: { roughness: 0.2, metalness: 0.04 },
  membrane: { roughness: 0.72, metalness: 0.02 },
}

interface DimensionTheme {
  line: string
  labelBackground: string
  labelBorder: string
  labelColor: string
  labelShadow: string
}

const DIMENSION_THEME: Record<FurniturePreviewBackground, DimensionTheme> = {
  dark: {
    line: '#f8fafc',
    labelBackground: 'rgba(12,16,22,0.84)',
    labelBorder: '1px solid rgba(255,255,255,0.18)',
    labelColor: 'white',
    labelShadow: '0 8px 22px rgba(0,0,0,0.22)',
  },
  light: {
    line: '#0f172a',
    labelBackground: 'rgba(255,255,255,0.9)',
    labelBorder: '1px solid rgba(15,23,42,0.16)',
    labelColor: '#0f172a',
    labelShadow: '0 8px 20px rgba(15,23,42,0.14)',
  },
}

function getOffsetPosition(
  posX: number,
  posY: number,
  posZ: number,
  offset: ExplodeOffset = NO_EXPLODE_OFFSET,
): Point3 {
  return [u(posX + offset[0]), u(posY + offset[1]), u(posZ + offset[2])]
}

function point3(posX: number, posY: number, posZ: number): Point3 {
  return [u(posX), u(posY), u(posZ)]
}

function getSectionInsets(index: number, lastIndex: number, thickness: number) {
  return {
    left:  index === 0 ? 0 : thickness / 2,
    right: index === lastIndex ? 0 : thickness / 2,
  }
}

function sideBias(centerX: number) {
  if (centerX < -1) return -0.28
  if (centerX > 1) return 0.28
  return 0
}

function getCameraPosition(
  view: FurniturePreviewView,
  target: [number, number, number],
  distance: number,
): [number, number, number] {
  switch (view) {
    case 'front':
      return [target[0], target[1], target[2] + distance]
    case 'side':
      return [target[0] + distance, target[1], target[2]]
    case 'top':
      return [target[0], target[1] + distance, target[2]]
    case 'isometric':
      return [target[0] + distance, target[1] + distance * 0.75, target[2] + distance]
  }
}

function getCameraUp(view: FurniturePreviewView): [number, number, number] {
  return view === 'top' ? [0, 0, -1] : [0, 1, 0]
}

function getPanelTextureRotation(
  grainDirection: FurnitureMaterialGrainDirection,
  panelWidth: number,
  panelHeight: number,
) {
  if (grainDirection === 'horizontal') return Math.PI / 2
  if (grainDirection === 'vertical' || grainDirection === 'none') return 0
  return panelWidth > panelHeight ? Math.PI / 2 : 0
}

function getMaterialFinishSettings(material: CustomFurnitureMaterial | null) {
  return material ? FINISH_RENDER_SETTINGS[material.finish] : { roughness: 0.65, metalness: 0.04 }
}

function getTextureRepeat(textureRepeatX: number, textureRepeatY: number, textureScale: number) {
  const scale = Math.max(0.01, textureScale)

  return [
    Math.max(0.01, textureRepeatX * scale),
    Math.max(0.01, textureRepeatY * scale),
  ] as const
}

function getSurfaceColor(
  surface: FurniturePreviewSurface,
  designColor: string,
  key: 'color' | 'secondaryColor' | 'backPanelColor' | 'drawerColor' = 'color',
) {
  if (surface.previewMaterial.id === 'design' && key === 'color') return designColor
  return surface.previewMaterial[key]
}

// ── Camera view controller ───────────────────────────────────────────────────
// Runs inside the Canvas so it has access to useThree()

function CameraViewController({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl | null> }) {
  const { outerBox } = useFurnitureStore()
  const activeView = useFurniturePreviewStore((state) => state.activeView)
  const cameraResetKey = useFurniturePreviewStore((state) => state.cameraResetKey)
  const { camera } = useThree()

  useEffect(() => {
    const target: [number, number, number] = outerBox
      ? [0, u(outerBox.height / 2), 0]
      : [0, 1, 0]

    if (!outerBox) {
      camera.position.set(2.8, 2.2, 2.8)
    } else {
      const maxDim = Math.max(outerBox.width, outerBox.height, outerBox.depth)
      const distance = u(maxDim) * 2.4
      camera.position.set(...getCameraPosition(activeView, target, distance))
    }

    camera.up.set(...getCameraUp(activeView))
    camera.lookAt(...target)

    if (controlsRef.current) {
      controlsRef.current.target.set(...target)
      controlsRef.current.update()
    }
  }, [activeView, camera, cameraResetKey, controlsRef, outerBox])

  return null
}

// ── Single wooden panel ───────────────────────────────────────────────────────

interface PanelProps {
  posX: number; posY: number; posZ: number  // mm, Y=0 at furniture bottom
  w: number; h: number; d: number           // mm
  color: string
  opacity?: number
  explode?: ExplodeOffset
  surfaceMaterial?: CustomFurnitureMaterial | null
}

function Panel({ posX, posY, posZ, w, h, d, color, opacity = 1, explode, surfaceMaterial = null }: PanelProps) {
  const finishSettings = getMaterialFinishSettings(surfaceMaterial)

  return (
    <mesh position={getOffsetPosition(posX, posY, posZ, explode)} castShadow receiveShadow>
      <boxGeometry args={[u(w), u(h), u(d)]} />
      {surfaceMaterial?.texture ? (
        <TexturedPanelMaterial
          color={color}
          opacity={opacity}
          panelWidth={w}
          panelHeight={h}
          material={surfaceMaterial}
          textureSrc={surfaceMaterial.texture.src}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={finishSettings.roughness}
          metalness={finishSettings.metalness}
          transparent={opacity < 1}
          opacity={opacity}
        />
      )}
    </mesh>
  )
}

function TexturedPanelMaterial({
  color,
  opacity,
  panelWidth,
  panelHeight,
  material,
  textureSrc,
}: {
  color: string
  opacity: number
  panelWidth: number
  panelHeight: number
  material: CustomFurnitureMaterial
  textureSrc: string
}) {
  const loadedTexture = useTexture(textureSrc) as THREE.Texture
  const grainDirection = material.grainDirection
  const textureRepeatX = material.textureRepeat.x
  const textureRepeatY = material.textureRepeat.y
  const textureScale = material.textureScale
  const texture = useMemo(() => {
    const configuredTexture = loadedTexture.clone()
    const [repeatX, repeatY] = getTextureRepeat(textureRepeatX, textureRepeatY, textureScale)

    configuredTexture.colorSpace = THREE.SRGBColorSpace
    configuredTexture.wrapS = THREE.RepeatWrapping
    configuredTexture.wrapT = THREE.RepeatWrapping
    configuredTexture.center.set(0.5, 0.5)
    configuredTexture.rotation = getPanelTextureRotation(grainDirection, panelWidth, panelHeight)
    configuredTexture.repeat.set(repeatX, repeatY)
    configuredTexture.needsUpdate = true

    return configuredTexture
  }, [
    grainDirection,
    loadedTexture,
    panelHeight,
    panelWidth,
    textureRepeatX,
    textureRepeatY,
    textureScale,
  ])
  const finishSettings = getMaterialFinishSettings(material)

  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  return (
    <meshStandardMaterial
      color={color}
      map={texture}
      roughness={finishSettings.roughness}
      metalness={finishSettings.metalness}
      transparent={opacity < 1}
      opacity={opacity}
    />
  )
}

// ── Dimension labels ─────────────────────────────────────────────────────────

interface DimensionGuideProps {
  start: Point3
  end: Point3
  label: string
  labelPosition: Point3
  ticks: Array<[Point3, Point3]>
  theme: DimensionTheme
}

function DimensionGuide({ start, end, label, labelPosition, ticks, theme }: DimensionGuideProps) {
  return (
    <group>
      <Line points={[start, end]} color={theme.line} lineWidth={1.35} />
      {ticks.map(([tickStart, tickEnd], index) => (
        <Line key={index} points={[tickStart, tickEnd]} color={theme.line} lineWidth={1.15} />
      ))}
      <Html
        position={labelPosition}
        center
        pointerEvents="none"
        zIndexRange={[40, 0]}
      >
        <div
          style={{
            padding: '2px 6px',
            borderRadius: 4,
            background: theme.labelBackground,
            border: theme.labelBorder,
            boxShadow: theme.labelShadow,
            color: theme.labelColor,
            fontSize: 10.5,
            fontWeight: 600,
            lineHeight: '13px',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  )
}

function DimensionLabels({
  width,
  height,
  depth,
  clearance,
  backgroundMode,
}: {
  width: number
  height: number
  depth: number
  clearance: number
  backgroundMode: FurniturePreviewBackground
}) {
  const theme = DIMENSION_THEME[backgroundMode]
  const maxDim = Math.max(width, height, depth)
  const gap = Math.max(130, Math.min(280, maxDim * 0.1)) + clearance * 0.45
  const tick = Math.max(55, Math.min(95, gap * 0.42))
  const frontZ = depth / 2 + gap
  const bottomY = -gap * 0.42
  const leftX = -width / 2 - gap
  const rightX = width / 2 + gap

  return (
    <group>
      <DimensionGuide
        label={`${width} mm`}
        start={point3(-width / 2, bottomY, frontZ)}
        end={point3(width / 2, bottomY, frontZ)}
        labelPosition={point3(0, bottomY, frontZ + tick * 0.38)}
        theme={theme}
        ticks={[
          [point3(-width / 2, bottomY, frontZ - tick / 2), point3(-width / 2, bottomY, frontZ + tick / 2)],
          [point3(width / 2, bottomY, frontZ - tick / 2), point3(width / 2, bottomY, frontZ + tick / 2)],
        ]}
      />
      <DimensionGuide
        label={`${height} mm`}
        start={point3(leftX, 0, frontZ)}
        end={point3(leftX, height, frontZ)}
        labelPosition={point3(leftX - tick * 0.42, height / 2, frontZ)}
        theme={theme}
        ticks={[
          [point3(leftX - tick / 2, 0, frontZ), point3(leftX + tick / 2, 0, frontZ)],
          [point3(leftX - tick / 2, height, frontZ), point3(leftX + tick / 2, height, frontZ)],
        ]}
      />
      <DimensionGuide
        label={`${depth} mm`}
        start={point3(rightX, bottomY, -depth / 2)}
        end={point3(rightX, bottomY, depth / 2)}
        labelPosition={point3(rightX + tick * 0.42, bottomY, 0)}
        theme={theme}
        ticks={[
          [point3(rightX - tick / 2, bottomY, -depth / 2), point3(rightX + tick / 2, bottomY, -depth / 2)],
          [point3(rightX - tick / 2, bottomY, depth / 2), point3(rightX + tick / 2, bottomY, depth / 2)],
        ]}
      />
    </group>
  )
}

// ── Full furniture model ──────────────────────────────────────────────────────

function FurnitureModel() {
  const { outerBox, shelves, partitions, drawers, material, sectionConfigs, shelfPartitions } = useFurnitureStore()
  const showDoors = useFurniturePreviewStore((state) => state.showDoors)
  const showDimensions = useFurniturePreviewStore((state) => state.showDimensions)
  const explodedView = useFurniturePreviewStore((state) => state.explodedView)
  const explodedAmount = useFurniturePreviewStore((state) => state.explodedAmount)
  const customMaterials = useFurniturePreviewStore((state) => state.customMaterials)
  const materialAssignments = useFurniturePreviewStore((state) => state.materialAssignments)
  const backgroundMode = useFurniturePreviewStore((state) => state.backgroundMode)

  // useMemo must be called before any conditional return (Rules of Hooks)
  const sortedPartitions = useMemo(
    () => [...partitions].sort((a, b) => a.fromLeft - b.fromLeft),
    [partitions],
  )
  if (!outerBox) return null

  const { width: W, height: H, depth: D } = outerBox
  const T   = material.thickness
  const B   = material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
  const createSurface = (area: FurniturePreviewMaterialArea): FurniturePreviewSurface => {
    const assignment = getFurniturePreviewAssignmentForArea({ materialAssignments }, area)

    return {
      previewMaterial: getFurniturePreviewMaterialForAssignment(assignment, customMaterials),
      customMaterial: getCustomFurnitureMaterialForAssignment(assignment, customMaterials),
    }
  }
  const carcassSurface = createSurface('carcass')
  const doorSurface = createSurface('doors')
  const drawerSurface = createSurface('drawers')
  const backSurface = createSurface('back')
  const col = getSurfaceColor(carcassSurface, material.color)
  const dark = getSurfaceColor(carcassSurface, material.color, 'secondaryColor')
  const back = getSurfaceColor(backSurface, material.color, 'backPanelColor')
  const drawerColor = getSurfaceColor(drawerSurface, material.color, 'drawerColor')
  const doorColor = getSurfaceColor(doorSurface, material.color)
  const explodeDistance = explodedView
    ? Math.max(80, Math.min(260, Math.max(W, H, D) * 0.1)) * explodedAmount
    : 0
  const explode = (x: number, y: number, z: number): ExplodeOffset => [
    x * explodeDistance,
    y * explodeDistance,
    z * explodeDistance,
  ]

  const interiorW = W - T * 2
  const interiorH = H - T * 2
  const interiorD = Math.max(1, D - B)
  const interiorCenterZ = B / 2
  const sectionBoundaries = [0, ...sortedPartitions.map((p) => p.fromLeft), interiorW]
  const sections = sectionBoundaries.slice(0, -1).map((fromLeft, i) => ({
    index:    i,
    fromLeft,
    width:    sectionBoundaries[i + 1] - fromLeft,
    // X of section centre relative to furniture X-centre
    centerX:  -W / 2 + T + fromLeft + (sectionBoundaries[i + 1] - fromLeft) / 2,
  }))

  return (
    <group>
      {/* ── Outer shell ── */}

      {/* Left side */}
      <Panel posX={-W / 2 + T / 2} posY={H / 2} posZ={0}
             w={T} h={H} d={D} color={col} explode={explode(-1, 0, 0)}
             surfaceMaterial={carcassSurface.customMaterial} />

      {/* Right side */}
      <Panel posX={W / 2 - T / 2} posY={H / 2} posZ={0}
             w={T} h={H} d={D} color={col} explode={explode(1, 0, 0)}
             surfaceMaterial={carcassSurface.customMaterial} />

      {/* Top panel */}
      <Panel posX={0} posY={H - T / 2} posZ={0}
             w={interiorW} h={T} d={D} color={dark} explode={explode(0, 0.9, 0)}
             surfaceMaterial={carcassSurface.customMaterial} />

      {/* Bottom panel */}
      <Panel posX={0} posY={T / 2} posZ={0}
             w={interiorW} h={T} d={D} color={dark} explode={explode(0, -0.55, 0)}
             surfaceMaterial={carcassSurface.customMaterial} />

      {/* Back panel */}
      <Panel posX={0} posY={H / 2} posZ={-D / 2 + B / 2}
             w={W} h={H} d={B} color={back} explode={explode(0, 0, -1)}
             surfaceMaterial={backSurface.customMaterial} />

      {/* ── Vertical partitions ── */}
      {sortedPartitions.map((p) => {
        const panelCentX = -W / 2 + T + p.fromLeft
        return (
          <Panel key={p.id}
            posX={panelCentX}
            posY={T + interiorH / 2}
            posZ={interiorCenterZ}
            w={T} h={interiorH} d={interiorD}
            color={col}
            explode={explode(sideBias(panelCentX), 0, 0.24)}
            surfaceMaterial={carcassSurface.customMaterial}
          />
        )
      })}

      {/* ── Shelf partitions (vertical dividers between shelves) ── */}
      {shelfPartitions.map((sp) => {
        const section = sections[sp.sectionIndex]
        if (!section) return null
        const panelH    = sp.toBottom - sp.fromBottom
        const panelCentY = T + sp.fromBottom + panelH / 2
        const panelCentX = -W / 2 + T + sp.fromLeft
        return (
          <Panel key={sp.id}
            posX={panelCentX}
            posY={panelCentY}
            posZ={interiorCenterZ}
            w={T} h={panelH} d={interiorD}
            color={col}
            explode={explode(sideBias(panelCentX), 0, 0.3)}
            surfaceMaterial={carcassSurface.customMaterial}
          />
        )
      })}

      {/* ── Shelves (section-specific) ── */}
      {shelves.map((shelf) => {
        const section = sections[shelf.sectionIndex]
        if (!section) return null
        // Wall-adjacent sides need no inset; partition-adjacent sides need T/2
        const leftInset  = shelf.sectionIndex === 0                   ? 0 : T / 2
        const rightInset = shelf.sectionIndex === sortedPartitions.length ? 0 : T / 2
        const shelfW     = section.width - leftInset - rightInset
        const shelfCentX = -W / 2 + T + section.fromLeft + leftInset + shelfW / 2
        return (
          <Panel key={shelf.id}
            posX={shelfCentX}
            posY={T + shelf.fromBottom}
            posZ={interiorCenterZ}
            w={shelfW} h={T} d={interiorD}
            color={dark}
            explode={explode(sideBias(shelfCentX), shelf.fromBottom > interiorH / 2 ? 0.18 : -0.08, 0.42)}
            surfaceMaterial={carcassSurface.customMaterial}
          />
        )
      })}

      {/* ── Drawers ── */}
      {drawers.map((drawer) => {
        const section = sections[drawer.sectionIndex]
        if (!section) return null

        const drawerCenterY = T + drawer.fromBottom + drawer.height / 2
        const inset         = getSectionInsets(drawer.sectionIndex, sortedPartitions.length, T)
        const drawerW       = section.width - inset.left - inset.right
        const drawerCenterX = -W / 2 + T + section.fromLeft + inset.left + drawerW / 2
        const frontSetback  = Math.max(0, Math.min(drawer.frontSetback ?? 0, interiorD - T - 17))
        const drawerD       = Math.max(1, interiorD - T - frontSetback)
        const drawerZ       = interiorCenterZ - (T + frontSetback) / 2
        const drawerFrontZ  = D / 2 - frontSetback - T / 2

        return (
          <group key={drawer.id}>
            {/* Drawer body (slightly darker) */}
            <Panel
              posX={drawerCenterX}
              posY={drawerCenterY}
              posZ={drawerZ}
              w={drawerW} h={drawer.height - 2} d={drawerD}
              color={drawerColor}
              explode={explode(sideBias(drawerCenterX), 0, 0.72)}
              surfaceMaterial={drawerSurface.customMaterial}
            />
            {/* Drawer front face */}
            <Panel
              posX={drawerCenterX}
              posY={drawerCenterY}
              posZ={drawerFrontZ}
              w={drawerW} h={drawer.height - 2} d={T}
              color={drawerColor}
              explode={explode(sideBias(drawerCenterX), 0, 1)}
              surfaceMaterial={drawerSurface.customMaterial}
            />
          </group>
        )
      })}

      {/* ── Doors & hanging rails (per section) ── */}
      {sections.map((section) => {
        const cfg = sectionConfigs[section.index] ?? DEFAULT_SECTION_CONFIG
        const doorH    = interiorH - 2          // 1mm clearance top + bottom
        const doorFaceZ = D / 2 + T / 2        // overlay: sits just in front of frame
        const doorCenterY = T + interiorH / 2

        return (
          <group key={`sec-${section.index}`}>

            {/* Door */}
            {showDoors && cfg.door === 'single' && (
              <Panel
                posX={section.centerX}
                posY={doorCenterY}
                posZ={doorFaceZ}
                w={section.width - 2} h={doorH} d={T}
                color={doorColor} opacity={0.82}
                explode={explode(sideBias(section.centerX), 0, 1.12)}
                surfaceMaterial={doorSurface.customMaterial}
              />
            )}
            {showDoors && cfg.door === 'double' && (() => {
              const halfW = (section.width - 4) / 2
              return (
                <>
                  <Panel
                    posX={section.centerX - halfW / 2 - 1}
                    posY={doorCenterY} posZ={doorFaceZ}
                    w={halfW} h={doorH} d={T}
                    color={doorColor} opacity={0.82}
                    explode={explode(sideBias(section.centerX) - 0.22, 0, 1.12)}
                    surfaceMaterial={doorSurface.customMaterial}
                  />
                  <Panel
                    posX={section.centerX + halfW / 2 + 1}
                    posY={doorCenterY} posZ={doorFaceZ}
                    w={halfW} h={doorH} d={T}
                    color={doorColor} opacity={0.82}
                    explode={explode(sideBias(section.centerX) + 0.22, 0, 1.12)}
                    surfaceMaterial={doorSurface.customMaterial}
                  />
                </>
              )
            })()}

            {/* Hanging rail (25mm diameter rod, ~200mm below top) */}
            {cfg.hangingRail && (() => {
              const railOffset = explode(sideBias(section.centerX), 0, 0.34)
              return (
                <mesh
                  position={getOffsetPosition(section.centerX, T + interiorH - 200, interiorCenterZ, railOffset)}
                  rotation={[0, 0, Math.PI / 2]}
                >
                  <cylinderGeometry args={[u(12.5), u(12.5), u(section.width - T * 2), 16]} />
                  <meshStandardMaterial color="#aaaaaa" metalness={0.85} roughness={0.15} />
                </mesh>
              )
            })()}
          </group>
        )
      })}

      {showDimensions && (
        <DimensionLabels
          width={W}
          height={H}
          depth={D}
          clearance={explodeDistance}
          backgroundMode={backgroundMode}
        />
      )}
    </group>
  )
}

// ── Empty state hint (no box drawn yet) ───────────────────────────────────────

function EmptyHint({ backgroundMode }: { backgroundMode: FurniturePreviewBackground }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[3, 2]} />
      <meshStandardMaterial color={backgroundMode === 'light' ? '#e2e8f0' : '#2a2a2a'} />
    </mesh>
  )
}

// ── Main canvas export ────────────────────────────────────────────────────────

export default function ThreeCanvas() {
  const { outerBox } = useFurnitureStore()
  const backgroundMode = useFurniturePreviewStore((state) => state.backgroundMode)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)

  const camTarget: [number, number, number] = outerBox
    ? [0, u(outerBox.height / 2), 0]
    : [0, 1, 0]

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows
        camera={{ position: [2.8, 2.2, 2.8], fov: 45, near: 0.01, far: 50 }}
        gl={{ antialias: true }}
        style={{ background: CANVAS_BACKGROUND[backgroundMode] }}
      >
        <Suspense fallback={null}>
          {/* ── Lighting ── */}
          <ambientLight intensity={backgroundMode === 'light' ? 0.68 : 0.55} />
          <directionalLight
            position={[4, 7, 4]} intensity={backgroundMode === 'light' ? 0.95 : 1.1}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-near={0.1}
            shadow-camera-far={20}
            shadow-camera-left={-3}
            shadow-camera-right={3}
            shadow-camera-top={3}
            shadow-camera-bottom={-3}
          />
          <directionalLight position={[-3, 2, -2]} intensity={0.25} />

          {/* ── Furniture or empty hint ── */}
          {outerBox ? <FurnitureModel /> : <EmptyHint backgroundMode={backgroundMode} />}

          {/* ── Floor grid ── */}
          <gridHelper
            args={[10, 20, GRID_COLORS[backgroundMode][0], GRID_COLORS[backgroundMode][1]]}
            position={[0, 0, 0]}
          />

          {/* ── Camera view buttons + auto-fit when furniture changes ── */}
          <CameraViewController controlsRef={controlsRef} />

          {/* ── Controls ── */}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            target={camTarget}
            enablePan={false}
            enableZoom
            enableRotate
            minDistance={0.3}
            maxDistance={15}
          />

          {/* ── Axis gizmo ── */}
          <GizmoHelper alignment="bottom-right" margin={[40, 40]}>
            <GizmoViewport
              axisColors={['#e05252', '#52a852', '#5252e0']}
              labelColor={backgroundMode === 'light' ? '#111827' : 'white'}
            />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* Hint overlay */}
      {!outerBox && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: backgroundMode === 'light' ? '#64748b' : '#555', fontSize: 11 }}
        >
          Draw a box to see 3D preview
        </div>
      )}
    </div>
  )
}
