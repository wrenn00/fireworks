/**
 * FoggyWindowCanvas
 *
 * "비 오는 날 차창 안쪽에 손가락으로 그림 그리는 그 감각."
 *
 * Layer structure (back to front):
 *   1. Background gradient + city lights + rain streaks  (mainCanvas)
 *   2. Fog canvas (offscreen, composited with source-over)
 *      – filled rgba(185,208,228,0.92); destination-out where user wipes
 *   3. Water droplets (on mainCanvas after fog)
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import {
  BACKGROUNDS, BackgroundPreset,
  generateRain, stepRain,
  createDroplet, stepDroplets, pruneDroplets,
  type RainStreak, type Droplet,
} from '../lib/fogEngine'
import FogToolbar from './FogToolbar'

// ── Drawing constants ─────────────────────────────────────────────────────────

const BRUSH_STEP     = 4      // px between wipe-fog samples while dragging
const MIN_RADIUS     = 10     // px — fast drawing
const SPEED_FACTOR   = 0.18   // px·ms⁻¹ → radius reduction
const DROP_PROB      = 0.28   // probability of droplet per step
const DROP_INTERVAL  = 10     // min px between droplets
const DRIP_WIPE_R    = 2.5    // fog wipe radius for drip trails

// ── Background drawing ─────────────────────────────────────────────────────────

function drawBackground(
  ctx: CanvasRenderingContext2D,
  preset: BackgroundPreset,
  rain: RainStreak[],
  w: number, h: number,
): void {
  // Gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  preset.gradient.forEach((c, i) => grad.addColorStop(i / (preset.gradient.length - 1), c))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // Soft city lights (radial gradients simulating distant lights + bloom)
  ctx.globalCompositeOperation = 'source-over'
  for (const light of preset.lights) {
    const lx = light.x * w
    const ly = light.y * h
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, light.r)
    lg.addColorStop(0,   light.color)
    lg.addColorStop(1,   'rgba(0,0,0,0)')
    ctx.fillStyle = lg
    ctx.beginPath()
    ctx.arc(lx, ly, light.r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Rain streaks (behind fog — visible when fog is cleared)
  for (const s of rain) {
    ctx.strokeStyle = preset.rainColor
    ctx.lineWidth   = 0.8
    ctx.globalAlpha = s.opacity
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(s.x + s.length * 0.18, s.y + s.length)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ── Droplet drawing ────────────────────────────────────────────────────────────

function drawDroplet(ctx: CanvasRenderingContext2D, d: Droplet): void {
  const r = d.radius

  // Dark shadow ring (refraction edge)
  ctx.globalAlpha = 0.30
  ctx.fillStyle   = 'rgba(20,40,70,1)'
  ctx.beginPath()
  ctx.arc(d.x, d.y, r + 0.6, 0, Math.PI * 2)
  ctx.fill()

  // Water body
  ctx.globalAlpha = 0.55
  ctx.fillStyle   = 'rgba(140,185,225,1)'
  ctx.beginPath()
  ctx.arc(d.x, d.y, r * 0.9, 0, Math.PI * 2)
  ctx.fill()

  // Specular highlight
  ctx.globalAlpha = 0.85
  ctx.fillStyle   = 'rgba(255,255,255,1)'
  ctx.beginPath()
  ctx.arc(d.x - r * 0.30, d.y - r * 0.28, r * 0.28, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
}

// ── Fog wipe ───────────────────────────────────────────────────────────────────

function wipeFog(
  fogCtx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
): void {
  const prev = fogCtx.globalCompositeOperation
  fogCtx.globalCompositeOperation = 'destination-out'

  const grad = fogCtx.createRadialGradient(x, y, 0, x, y, radius)
  grad.addColorStop(0,    'rgba(0,0,0,1)')
  grad.addColorStop(0.65, 'rgba(0,0,0,0.6)')
  grad.addColorStop(1,    'rgba(0,0,0,0)')
  fogCtx.fillStyle = grad
  fogCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2)

  fogCtx.globalCompositeOperation = prev
}

function fillFog(
  fogCtx: CanvasRenderingContext2D,
  color: string,
  w: number, h: number,
): void {
  fogCtx.globalCompositeOperation = 'source-over'
  fogCtx.fillStyle = color
  fogCtx.fillRect(0, 0, w, h)
}

// ── Component state ────────────────────────────────────────────────────────────

interface DrawState {
  active:          boolean
  lastX:           number
  lastY:           number
  lastTime:        number
  accumulated:     number   // px since last droplet
  lastDripX:       number
  lastDripY:       number
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function FoggyWindowCanvas() {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null)
  const fogCanvasRef  = useRef<HTMLCanvasElement | null>(null)   // offscreen

  const rainRef     = useRef<RainStreak[]>([])
  const dropletsRef = useRef<Droplet[]>([])
  const drawState   = useRef<DrawState>({
    active: false, lastX: 0, lastY: 0, lastTime: 0, accumulated: 0, lastDripX: 0, lastDripY: 0,
  })
  const brushRef    = useRef(16)
  const presetRef   = useRef<BackgroundPreset>(BACKGROUNDS[0])
  const rafRef      = useRef(0)
  const frameRef    = useRef(0)

  const [showHint, setShowHint] = useState(true)
  const [preset, setPreset]     = useState<BackgroundPreset>(BACKGROUNDS[0])
  const [brush, setBrush]       = useState(16)

  // Keep refs in sync
  useEffect(() => { brushRef.current  = brush  }, [brush])
  useEffect(() => { presetRef.current = preset }, [preset])

  // ── Canvas / fog init ────────────────────────────────────────────────────────

  const initFog = useCallback(() => {
    const main = mainCanvasRef.current
    if (!main) return
    const w = main.offsetWidth, h = main.offsetHeight
    main.width = w; main.height = h

    const fog = document.createElement('canvas')
    fog.width = w; fog.height = h
    fogCanvasRef.current = fog
    fillFog(fog.getContext('2d')!, presetRef.current.fogColor, w, h)

    rainRef.current     = generateRain(90, w, h)
    dropletsRef.current = []
  }, [])

  const resize = useCallback(() => {
    const main = mainCanvasRef.current
    const fog  = fogCanvasRef.current
    if (!main || !fog) return
    const w = main.offsetWidth, h = main.offsetHeight

    // Snapshot existing fog, resize, repaint
    const snap = fog.getContext('2d')!.getImageData(0, 0, fog.width, fog.height)
    main.width = w; main.height = h
    fog.width  = w; fog.height  = h

    const fc = fog.getContext('2d')!
    fillFog(fc, presetRef.current.fogColor, w, h)
    if (snap.width > 0) fc.putImageData(snap, 0, 0)   // best-effort restore

    rainRef.current = generateRain(90, w, h)
  }, [])

  useEffect(() => {
    initFog()
    const ob = new ResizeObserver(resize)
    if (mainCanvasRef.current) ob.observe(mainCanvasRef.current)
    return () => ob.disconnect()
  }, [initFog, resize])

  // ── rAF loop ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = () => {
      const main = mainCanvasRef.current
      const fog  = fogCanvasRef.current
      if (!main || !fog) { rafRef.current = requestAnimationFrame(loop); return }

      const ctx = main.getContext('2d')
      const fc  = fog.getContext('2d')
      if (!ctx || !fc) { rafRef.current = requestAnimationFrame(loop); return }

      const w = main.width, h = main.height
      frameRef.current++

      // Step rain
      stepRain(rainRef.current, w, h)

      // Step droplets — wipe fog along drip trails
      const wipePositions = stepDroplets(dropletsRef.current)
      for (const { x, y } of wipePositions) {
        wipeFog(fc, x, y, DRIP_WIPE_R)
      }
      dropletsRef.current = pruneDroplets(dropletsRef.current, h)

      // ── Render ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, w, h)

      // 1. Background + rain
      drawBackground(ctx, presetRef.current, rainRef.current, w, h)

      // 2. Fog layer
      ctx.drawImage(fog, 0, 0)

      // 3. Droplets
      for (const d of dropletsRef.current) drawDroplet(ctx, d)

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── Pointer events ────────────────────────────────────────────────────────────

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = mainCanvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const applyBrush = useCallback((x: number, y: number, radius: number) => {
    const fc = fogCanvasRef.current?.getContext('2d')
    if (!fc) return
    wipeFog(fc, x, y, radius)

    const ds = drawState.current
    const dx = x - ds.lastDripX, dy = y - ds.lastDripY
    ds.accumulated += Math.hypot(dx, dy)

    if (ds.accumulated >= DROP_INTERVAL && Math.random() < DROP_PROB) {
      ds.accumulated = 0
      ds.lastDripX   = x
      ds.lastDripY   = y
      dropletsRef.current.push(createDroplet(x, y))
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    mainCanvasRef.current?.setPointerCapture(e.pointerId)
    const { x, y } = getPos(e)
    const ds = drawState.current
    ds.active = true; ds.lastX = x; ds.lastY = y
    ds.lastTime = performance.now(); ds.accumulated = 0
    ds.lastDripX = x; ds.lastDripY = y
    applyBrush(x, y, brushRef.current)
    setShowHint(false)
  }, [applyBrush])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const ds = drawState.current
    if (!ds.active) return
    e.preventDefault()

    const { x, y } = getPos(e)
    const now  = performance.now()
    const dx   = x - ds.lastX, dy = y - ds.lastY
    const dist = Math.hypot(dx, dy)
    if (dist < 1) return

    const dt     = Math.max(1, now - ds.lastTime)
    const speed  = dist / dt   // px/ms
    const radius = Math.max(MIN_RADIUS, brushRef.current - speed * SPEED_FACTOR * brushRef.current)

    // Interpolate steps along the movement
    const steps  = Math.max(1, Math.floor(dist / BRUSH_STEP))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      applyBrush(ds.lastX + dx * t, ds.lastY + dy * t, radius)
    }

    ds.lastX = x; ds.lastY = y; ds.lastTime = now
  }, [applyBrush])

  const onPointerUp = useCallback(() => {
    drawState.current.active = false
  }, [])

  // ── Public actions ────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    const fog = fogCanvasRef.current
    const main = mainCanvasRef.current
    if (!fog || !main) return
    const w = main.width, h = main.height
    const fc = fog.getContext('2d')!
    fc.clearRect(0, 0, w, h)
    fillFog(fc, presetRef.current.fogColor, w, h)
    dropletsRef.current = []
  }, [])

  const handleSave = useCallback(() => {
    const main = mainCanvasRef.current
    if (!main) return
    const a   = document.createElement('a')
    a.href    = main.toDataURL('image/png')
    a.download = `foggy-${Date.now()}.png`
    a.click()
  }, [])

  const handlePreset = useCallback((p: BackgroundPreset) => {
    setPreset(p)
    // Re-tint fog for new preset
    const fog  = fogCanvasRef.current
    const main = mainCanvasRef.current
    if (!fog || !main) return
    const w = main.width, h = main.height
    const fc  = fog.getContext('2d')!
    // Blend new fog color in (preserve cleared areas via source-atop)
    fc.globalCompositeOperation = 'source-atop'
    fc.fillStyle = p.fogColor
    fc.fillRect(0, 0, w, h)
    fc.globalCompositeOperation = 'source-over'
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full overflow-hidden">
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{ cursor: 'crosshair', display: 'block' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* First-visit hint */}
      {showHint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <p
            className="text-white/30 text-base sm:text-lg tracking-widest font-light"
            style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.2em' }}
          >
            Touch to wipe the fog
          </p>
        </div>
      )}

      {/* Toolbar */}
      <FogToolbar
        brush={brush}
        onBrushChange={setBrush}
        preset={preset}
        onPreset={handlePreset}
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}
