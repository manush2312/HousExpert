import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useFurnitureStore, DEFAULT_SECTION_CONFIG } from '../../stores/furnitureStore'

// ── Unit conversion ───────────────────────────────────────────────────────────
// 1 Three.js unit = 1000 mm (= 1 metre)
function u(mm: number) { return mm / 1000 }

// ── Camera auto-fit ───────────────────────────────────────────────────────────
// Runs inside the Canvas so it has access to useThree()

function CameraAutoFit() {
  const { outerBox } = useFurnitureStore()
  const { camera } = useThree()

  useEffect(() => {
    if (!outerBox) {
      camera.position.set(2.8, 2.2, 2.8)
      return
    }
    const maxDim = Math.max(outerBox.width, outerBox.height, outerBox.depth)
    const dist   = u(maxDim) * 2.4
    camera.position.set(dist, dist * 0.75, dist)
  }, [outerBox, camera])

  return null
}

// ── Single wooden panel ───────────────────────────────────────────────────────

interface PanelProps {
  posX: number; posY: number; posZ: number  // mm, Y=0 at furniture bottom
  w: number; h: number; d: number           // mm
  color: string
  opacity?: number
}

function Panel({ posX, posY, posZ, w, h, d, color, opacity = 1 }: PanelProps) {
  return (
    <mesh position={[u(posX), u(posY), u(posZ)]} castShadow receiveShadow>
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

// ── Full furniture model ──────────────────────────────────────────────────────

function FurnitureModel() {
  const { outerBox, shelves, partitions, drawers, material, sectionConfigs, shelfPartitions } = useFurnitureStore()

  // useMemo must be called before any conditional return (Rules of Hooks)
  const sortedPartitions = useMemo(
    () => [...partitions].sort((a, b) => a.fromLeft - b.fromLeft),
    [partitions],
  )

  if (!outerBox) return null

  const { width: W, height: H, depth: D } = outerBox
  const T   = material.thickness
  const col = material.color          // main panel colour
  const dark = '#a07840'              // slightly darker for top/bottom
  const back = '#8b6518'              // thin back panel

  const interiorW = W - T * 2
  const interiorH = H - T * 2
  const interiorD = D - 6            // 6 mm back panel
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
             w={T} h={H} d={D} color={col} />

      {/* Right side */}
      <Panel posX={W / 2 - T / 2} posY={H / 2} posZ={0}
             w={T} h={H} d={D} color={col} />

      {/* Top panel */}
      <Panel posX={0} posY={H - T / 2} posZ={0}
             w={interiorW} h={T} d={D} color={dark} />

      {/* Bottom panel */}
      <Panel posX={0} posY={T / 2} posZ={0}
             w={interiorW} h={T} d={D} color={dark} />

      {/* Back panel (6 mm) */}
      <Panel posX={0} posY={H / 2} posZ={-(D / 2 - 3)}
             w={W} h={H} d={6} color={back} />

      {/* ── Vertical partitions ── */}
      {sortedPartitions.map((p) => (
        <Panel key={p.id}
          posX={-W / 2 + T + p.fromLeft}
          posY={T + interiorH / 2}
          posZ={0}
          w={T} h={interiorH} d={interiorD}
          color={col}
        />
      ))}

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
            posZ={0}
            w={T} h={panelH} d={interiorD}
            color={col}
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
            posZ={0}
            w={shelfW} h={T} d={interiorD}
            color={dark}
          />
        )
      })}

      {/* ── Drawers ── */}
      {drawers.map((drawer) => {
        const section = sections[drawer.sectionIndex]
        if (!section) return null

        const drawerCenterY = T + drawer.fromBottom + drawer.height / 2
        const drawerW       = section.width - T
        const drawerD       = interiorD - T    // slight inset from back

        return (
          <group key={drawer.id}>
            {/* Drawer body (slightly darker) */}
            <Panel
              posX={section.centerX}
              posY={drawerCenterY}
              posZ={-T / 2}
              w={drawerW} h={drawer.height - 2} d={drawerD}
              color="#c8a050"
            />
            {/* Drawer front face */}
            <Panel
              posX={section.centerX}
              posY={drawerCenterY}
              posZ={D / 2 - T / 2}
              w={drawerW} h={drawer.height - 2} d={T}
              color={col}
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
            {cfg.door === 'single' && (
              <Panel
                posX={section.centerX}
                posY={doorCenterY}
                posZ={doorFaceZ}
                w={section.width - 2} h={doorH} d={T}
                color={col} opacity={0.82}
              />
            )}
            {cfg.door === 'double' && (() => {
              const halfW = (section.width - 4) / 2
              return (
                <>
                  <Panel
                    posX={section.centerX - halfW / 2 - 1}
                    posY={doorCenterY} posZ={doorFaceZ}
                    w={halfW} h={doorH} d={T}
                    color={col} opacity={0.82}
                  />
                  <Panel
                    posX={section.centerX + halfW / 2 + 1}
                    posY={doorCenterY} posZ={doorFaceZ}
                    w={halfW} h={doorH} d={T}
                    color={col} opacity={0.82}
                  />
                </>
              )
            })()}

            {/* Hanging rail (25mm diameter rod, ~200mm below top) */}
            {cfg.hangingRail && (
              <mesh
                position={[u(section.centerX), u(T + interiorH - 200), 0]}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[u(12.5), u(12.5), u(section.width - T * 2), 16]} />
                <meshStandardMaterial color="#aaaaaa" metalness={0.85} roughness={0.15} />
              </mesh>
            )}
          </group>
        )
      })}
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

          {/* ── Camera auto-fit when furniture changes ── */}
          <CameraAutoFit />

          {/* ── Controls ── */}
          <OrbitControls
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
