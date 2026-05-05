/**
 * FoggyWindowCanvas
 *
 * "그리는 게 아니라 지우는 거다. 그린 자국은 색이 아니라 투명함이다."
 *
 * Four stacked canvases (back → front):
 *   bgCanvas   (z=1)  — fixed gradient + city glows + subtle rain
 *   edgeCanvas (z=2)  — blue chromatic-aberration ring at wipe boundaries; accumulates
 *   fogCanvas  (z=3)  — opaque fog; destination-out punches transparent holes
 *   dropCanvas (z=4)  — glass-bead droplets; cleared+redrawn each frame
 *
 * Wiping:  destination-out on fogCanvas → bgCanvas/edgeCanvas show through holes.
 * No painting — the wiped area IS the drawing.
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import {
  generateRain, stepRain,
  createDroplet,
  type RainStreak, type Droplet,
} from '../lib/fogEngine'
import FogToolbar from './FogToolbar'

// ── Single background ─────────────────────────────────────────────────────────

const BG_STOPS: Array<[number, string]> = [
  [0,   '#2b4a6e'],
  [0.5, '#5a7a9a'],
  [1,   '#9bb0c4'],
]

// Faint city-light halos (pre-defined positions, no preset switching)
const CITY_LIGHTS = [
  { rx: 0.20, ry: 0.72, r: 80,  color: 'rgba(255,210,120,0.35)' },
  { rx: 0.65, ry: 0.80, r: 65,  color: 'rgba(255,185,90,0.30)'  },
  { rx: 0.82, ry: 0.63, r: 55,  color: 'rgba(200,200,255,0.25)' },
]

const FOG_FILL  = 'rgba(220, 230, 240, 0.88)'
const EDGE_COLOR = 'rgba(120, 160, 205, 0.18)'   // chromatic edge ring

// ── Brush ─────────────────────────────────────────────────────────────────────

const BRUSH_MIN  = 8      // minimum brush radius px
const DROP_PROB  = 0.25
const DROP_GAP   = 10     // min px between consecutive droplets on a stroke

// ── Background drawing (redrawn each frame for rain animation) ────────────────

function drawBackground(
  ctx: CanvasRenderingContext2D,
  rain: RainStreak[],
  w: number, h: number,
): void {
  ctx.clearRect(0, 0, w, h)

  // Gradient
  const g = ctx.createLinearGradient(0, 0, 0, h)
  BG_STOPS.forEach(([t, c]) => g.addColorStop(t, c))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // City glows
  for (const l of CITY_LIGHTS) {
    const lx = l.rx * w, ly = l.ry * h
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, l.r)
    lg.addColorStop(0, l.color); lg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = lg
    ctx.fillRect(lx - l.r, ly - l.r, l.r * 2, l.r * 2)
  }

  // Rain streaks
  ctx.lineWidth = 0.7
  for (const s of rain) {
    ctx.globalAlpha = s.opacity
    ctx.strokeStyle = 'rgba(140,175,215,1)'
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(s.x - s.len * 0.14, s.y + s.len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ── Fog canvas ────────────────────────────────────────────────────────────────

function initFog(fc: HTMLCanvasElement): void {
  const ctx = fc.getContext('2d')!
  const { width: w, height: h } = fc

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = FOG_FILL
  ctx.fillRect(0, 0, w, h)

  // Pixel-level noise for organic texture (done once)
  const img  = ctx.getImageData(0, 0, w, h)
  const data = img.data
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, data[i] + (Math.random() - 0.5) * 28))
  }
  ctx.putImageData(img, 0, 0)
}

/** Erase fog at (x, y) — makes that area transparent so layers below show through. */
function wipeAt(fc: HTMLCanvasElement, x: number, y: number, r: number): void {
  const ctx = fc.getContext('2d')!
  ctx.globalCompositeOperation = 'destination-out'
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0,    'rgba(0,0,0,1)')
  g.addColorStop(0.50, 'rgba(0,0,0,0.7)')
  g.addColorStop(1,    'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * Interpolate wipes between two points — no skipped gaps when moving fast.
 * Also applies the chromatic edge glow at each step.
 */
function wipePath(
  fc: HTMLCanvasElement,
  ec: HTMLCanvasElement,
  x1: number, y1: number,
  x2: number, y2: number,
  r: number,
): void {
  const d     = Math.hypot(x2 - x1, y2 - y1)
  const step  = Math.max(1, r * 0.28)
  const steps = Math.ceil(d / step)
  for (let i = 0; i <= steps; i++) {
    const t = steps > 0 ? i / steps : 0
    const x = x1 + (x2 - x1) * t
    const y = y1 + (y2 - y1) * t
    wipeAt(fc, x, y, r)
    drawEdgeGlow(ec, x, y, r)
  }
}

// ── Edge glow (chromatic aberration at wipe boundary) ─────────────────────────

/**
 * Draw a soft blue annular ring at the wipe boundary.
 * Very low alpha — accumulates subtly without becoming garish.
 * Stays on edgeCanvas permanently (never cleared).
 */
function drawEdgeGlow(ec: HTMLCanvasElement, x: number, y: number, r: number): void {
  const ctx = ec.getContext('2d')!
  ctx.globalCompositeOperation = 'source-over'
  const inner = r * 0.70
  const outer = r * 1.15
  const g = ctx.createRadialGradient(x, y, inner, x, y, outer)
  g.addColorStop(0,    'rgba(0,0,0,0)')
  g.addColorStop(0.45, EDGE_COLOR)
  g.addColorStop(1,    'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, outer, 0, Math.PI * 2); ctx.fill()
}

// ── Glass-bead droplet ────────────────────────────────────────────────────────

function drawDroplet(ctx: CanvasRenderingContext2D, d: Droplet): void {
  if (d.alpha < 0.02) return
  const r = d.radius, hx = d.x - r * 0.32, hy = d.y - r * 0.32
  ctx.save()
  ctx.globalAlpha = d.alpha

  // Water body: bright centre → translucent bluish edge
  const grad = ctx.createRadialGradient(hx, hy, 0, d.x, d.y, r)
  grad.addColorStop(0,    'rgba(255,255,255,0.92)')
  grad.addColorStop(0.35, 'rgba(185,210,235,0.70)')
  grad.addColorStop(0.70, 'rgba(120,155,195,0.50)')
  grad.addColorStop(1,    'rgba(70,105,145,0.28)')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.fill()

  // Specular highlight (glass bead sparkle)
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.beginPath(); ctx.arc(hx, hy, r * 0.24, 0, Math.PI * 2); ctx.fill()

  ctx.restore()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FoggyWindowCanvas() {
  const bgRef   = useRef<HTMLCanvasElement>(null)
  const edgeRef = useRef<HTMLCanvasElement>(null)
  const fogRef  = useRef<HTMLCanvasElement>(null)
  const dropRef = useRef<HTMLCanvasElement>(null)

  const rainRef     = useRef<RainStreak[]>([])
  const dropletsRef = useRef<Droplet[]>([])
  const rafRef      = useRef(0)
  const brushRef    = useRef(18)
  const [brush, setBrush] = useState(18)
  useEffect(() => { brushRef.current = brush }, [brush])

  // Drawing state
  const activeRef   = useRef(false)
  const lastRef     = useRef({ x: 0, y: 0, t: 0 })
  const dropAccRef  = useRef(0)
  const lastDipRef  = useRef({ x: 0, y: 0 })

  const [showHint, setShowHint] = useState(true)

  // ── Size sync ────────────────────────────────────────────────────────────────

  const syncSize = useCallback(() => {
    const els = [bgRef, edgeRef, fogRef, dropRef].map(r => r.current).filter(Boolean) as HTMLCanvasElement[]
    if (els.length < 4) return
    const w = els[0].offsetWidth, h = els[0].offsetHeight
    els.forEach(c => { c.width = w; c.height = h })
    rainRef.current = generateRain(80, w, h)
    initFog(fogRef.current!)
    // edgeCanvas: clear on resize
    edgeRef.current!.getContext('2d')!.clearRect(0, 0, w, h)
  }, [])

  useEffect(() => {
    syncSize()
    const ob = new ResizeObserver(syncSize)
    if (bgRef.current) ob.observe(bgRef.current)
    return () => ob.disconnect()
  }, [syncSize])

  // ── rAF loop ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = () => {
      const bg   = bgRef.current
      const fog  = fogRef.current
      const drop = dropRef.current
      if (!bg || !fog || !drop) { rafRef.current = requestAnimationFrame(loop); return }

      const bgCtx   = bg.getContext('2d')!
      const dropCtx = drop.getContext('2d')!
      const w = bg.width, h = bg.height

      // 1. Background (gradient + lights + animated rain)
      stepRain(rainRef.current, w, h)
      drawBackground(bgCtx, rainRef.current, w, h)

      // 2. fogCanvas: only mutated on pointer events / drip wipes — no per-frame clear

      // 3. Dripping droplets advance and wipe fog along their trail
      const dead: number[] = []
      dropletsRef.current.forEach((d, i) => {
        d.alpha = Math.min(1, d.alpha + 0.07)
        if (d.isDripping && d.totalDrift < d.maxDrift) {
          d.vy = Math.min(d.vy + 0.003, 0.55)
          d.driftPhase += 0.04
          d.x += Math.sin(d.driftPhase) * 0.6
          d.y += d.vy
          d.totalDrift += d.vy
          // Drip trail wipes fog (and subtle edge glow)
          wipeAt(fog, d.x, d.y, d.radius * 0.75)
          drawEdgeGlow(edgeRef.current!, d.x, d.y, d.radius * 0.75)
        } else if (d.isDripping) {
          d.isDripping = false
        }
        if (d.y > h + 20) dead.push(i)
      })
      if (dead.length) dropletsRef.current = dropletsRef.current.filter((_, i) => !dead.includes(i))

      // 4. Droplets
      dropCtx.clearRect(0, 0, w, h)
      for (const d of dropletsRef.current) drawDroplet(dropCtx, d)

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── Pointer events (on fogCanvas) ────────────────────────────────────────────

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = fogRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const maybeDroplet = useCallback((x: number, y: number, r: number) => {
    const dx = x - lastDipRef.current.x, dy = y - lastDipRef.current.y
    dropAccRef.current += Math.hypot(dx, dy)
    if (dropAccRef.current >= DROP_GAP && Math.random() < DROP_PROB) {
      dropAccRef.current = 0
      lastDipRef.current = { x, y }
      dropletsRef.current.push(createDroplet(x, y, r))
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    fogRef.current?.setPointerCapture(e.pointerId)
    const { x, y } = pos(e)
    activeRef.current = true
    lastRef.current   = { x, y, t: performance.now() }
    dropAccRef.current  = 0
    lastDipRef.current  = { x, y }
    wipeAt(fogRef.current!, x, y, brushRef.current)
    drawEdgeGlow(edgeRef.current!, x, y, brushRef.current)
    maybeDroplet(x, y, brushRef.current)
    setShowHint(false)
  }, [maybeDroplet])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeRef.current) return
    e.preventDefault()
    const { x, y }  = pos(e)
    const now        = performance.now()
    const prev       = lastRef.current
    const dist       = Math.hypot(x - prev.x, y - prev.y)
    if (dist < 0.5) return

    // Speed-based radius: fast → thinner, slow → thicker
    const speed  = dist / Math.max(1, now - prev.t)   // px/ms
    const radius = Math.max(BRUSH_MIN, brushRef.current - speed * 0.12 * brushRef.current)

    wipePath(fogRef.current!, edgeRef.current!, prev.x, prev.y, x, y, radius)
    maybeDroplet(x, y, radius)

    lastRef.current = { x, y, t: now }
  }, [maybeDroplet])

  const onPointerUp = useCallback(() => { activeRef.current = false }, [])

  // ── Actions ────────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    const fog  = fogRef.current
    const edge = edgeRef.current
    if (!fog || !edge) return
    initFog(fog)
    edge.getContext('2d')!.clearRect(0, 0, edge.width, edge.height)
    dropletsRef.current = []
  }, [])

  const handleSave = useCallback(() => {
    const [bg, edge, fog, drop] = [bgRef, edgeRef, fogRef, dropRef].map(r => r.current)
    if (!bg || !edge || !fog || !drop) return
    const out = document.createElement('canvas')
    out.width = bg.width; out.height = bg.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(bg, 0, 0); ctx.drawImage(edge, 0, 0)
    ctx.drawImage(fog, 0, 0); ctx.drawImage(drop, 0, 0)
    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = `foggy-${Date.now()}.png`
    a.click()
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────────

  const canvasStyle = { position: 'absolute' as const, top: 0, left: 0, width: '100%', height: '100%' }

  return (
    <div className="relative w-full h-full overflow-hidden select-none touch-none">

      {/* z=1  Background */}
      <canvas ref={bgRef}   style={{ ...canvasStyle, zIndex: 1 }} />

      {/* z=2  Edge glow (chromatic aberration) — pointer-events: none */}
      <canvas ref={edgeRef} style={{ ...canvasStyle, zIndex: 2, pointerEvents: 'none' }} />

      {/* z=3  Fog — receives pointer events */}
      <canvas ref={fogRef}  style={{ ...canvasStyle, zIndex: 3, cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* z=4  Droplets — pointer-events: none */}
      <canvas ref={dropRef} style={{ ...canvasStyle, zIndex: 4, pointerEvents: 'none' }} />

      {/* Hint */}
      {showHint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
             style={{ zIndex: 10 }}>
          <p className="text-white/28 text-base sm:text-xl tracking-[0.24em] font-light">
            Touch to wipe the fog
          </p>
        </div>
      )}

      {/* Toolbar */}
      <FogToolbar
        brush={brush}
        onBrushChange={setBrush}
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}
