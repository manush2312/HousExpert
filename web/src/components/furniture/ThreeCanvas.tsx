import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Html, Line } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  DEFAULT_BACK_PANEL_THICKNESS,
  DEFAULT_SECTION_CONFIG,
  useFurnitureStore,
} from '../../stores/furnitureStore'
import {
  getFurniturePreviewMaterial,
  useFurniturePreviewStore,
  type FurniturePreviewView,
} from '../../stores/furniturePreviewStore'

// ── Unit conversion ───────────────────────────────────────────────────────────
// 1 Three.js unit = 1000 mm (= 1 metre)
function u(mm: number) { return mm / 1000 }

type ExplodeOffset = [number, number, number]
type Point3 = [number, number, number]

const NO_EXPLODE_OFFSET: ExplodeOffset = [0, 0, 0]

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
}

function Panel({ posX, posY, posZ, w, h, d, color, opacity = 1, explode }: PanelProps) {
  return (
    <mesh position={getOffsetPosition(posX, posY, posZ, explode)} castShadow receiveShadow>
      <boxGeometry args={[u(w), u(h), u(d)]} />
      <meshStandardMaterial
        color={color}
        roughness={0.65}
        metalness={0.04}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  )
}

// ── Dimension labels ─────────────────────────────────────────────────────────

interface DimensionGuideProps {
  start: Point3
  end: Point3
  label: string
  labelPosition: Point3
  ticks: Array<[Point3, Point3]>
}

function DimensionGuide({ start, end, label, labelPosition, ticks }: DimensionGuideProps) {
  return (
    <group>
      <Line points={[start, end]} color="#f8fafc" lineWidth={1.35} />
      {ticks.map(([tickStart, tickEnd], index) => (
        <Line key={index} points={[tickStart, tickEnd]} color="#f8fafc" lineWidth={1.15} />
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
            background: 'rgba(12,16,22,0.84)',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 8px 22px rgba(0,0,0,0.22)',
            color: 'white',
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
}: {
  width: number
  height: number
  depth: number
  clearance: number
}) {
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
  const selectedMaterialId = useFurniturePreviewStore((state) => state.selectedMaterialId)
  const customColor = useFurniturePreviewStore((state) => state.customColor)

  // useMemo must be called before any conditional return (Rules of Hooks)
  const sortedPartitions = useMemo(
    () => [...partitions].sort((a, b) => a.fromLeft - b.fromLeft),
    [partitions],
  )

  if (!outerBox) return null

  const { width: W, height: H, depth: D } = outerBox
  const T   = material.thickness
  const B   = material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
  const previewMaterial = getFurniturePreviewMaterial(selectedMaterialId, customColor)
  const col = selectedMaterialId === 'design' ? material.color : previewMaterial.color
  const dark = previewMaterial.secondaryColor
  const back = previewMaterial.backPanelColor
  const drawerColor = previewMaterial.drawerColor
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
             w={T} h={H} d={D} color={col} explode={explode(-1, 0, 0)} />

      {/* Right side */}
      <Panel posX={W / 2 - T / 2} posY={H / 2} posZ={0}
             w={T} h={H} d={D} color={col} explode={explode(1, 0, 0)} />

      {/* Top panel */}
      <Panel posX={0} posY={H - T / 2} posZ={0}
             w={interiorW} h={T} d={D} color={dark} explode={explode(0, 0.9, 0)} />

      {/* Bottom panel */}
      <Panel posX={0} posY={T / 2} posZ={0}
             w={interiorW} h={T} d={D} color={dark} explode={explode(0, -0.55, 0)} />

      {/* Back panel */}
      <Panel posX={0} posY={H / 2} posZ={-D / 2 + B / 2}
             w={W} h={H} d={B} color={back} explode={explode(0, 0, -1)} />

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
            />
            {/* Drawer front face */}
            <Panel
              posX={drawerCenterX}
              posY={drawerCenterY}
              posZ={drawerFrontZ}
              w={drawerW} h={drawer.height - 2} d={T}
              color={col}
              explode={explode(sideBias(drawerCenterX), 0, 1)}
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
                color={col} opacity={0.82}
                explode={explode(sideBias(section.centerX), 0, 1.12)}
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
                    color={col} opacity={0.82}
                    explode={explode(sideBias(section.centerX) - 0.22, 0, 1.12)}
                  />
                  <Panel
                    posX={section.centerX + halfW / 2 + 1}
                    posY={doorCenterY} posZ={doorFaceZ}
                    w={halfW} h={doorH} d={T}
                    color={col} opacity={0.82}
                    explode={explode(sideBias(section.centerX) + 0.22, 0, 1.12)}
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
        />
      )}
    </group>
  )
}

// ── Empty state hint (no box drawn yet) ───────────────────────────────────────

function EmptyHint() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[3, 2]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

// ── Main canvas export ────────────────────────────────────────────────────────

export default function ThreeCanvas() {
  const { outerBox } = useFurnitureStore()
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
        style={{ background: 'linear-gradient(160deg, #1e1e2e 0%, #16161f 100%)' }}
      >
        <Suspense fallback={null}>
          {/* ── Lighting ── */}
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[4, 7, 4]} intensity={1.1}
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
          {outerBox ? <FurnitureModel /> : <EmptyHint />}

          {/* ── Floor grid ── */}
          <gridHelper
            args={[10, 20, '#333333', '#222222']}
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
              labelColor="white"
            />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* Hint overlay */}
      {!outerBox && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: '#555', fontSize: 11 }}
        >
          Draw a box to see 3D preview
        </div>
      )}
    </div>
  )
}
