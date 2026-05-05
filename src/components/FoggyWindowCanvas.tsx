/**
 * FoggyWindowCanvas
 *
 * "그리는 게 아니라 지우는 거다. 그린 자국은 색이 아니라 투명함이다."
 *
 * 세 개의 stacked canvas:
 *   bgCanvas  (z=1) — 배경 그라데이션 + 도시 불빛 + 빗줄기 (매 프레임 갱신)
 *   fogCanvas (z=2) — 안개. destination-out 으로 닦이면 bgCanvas 가 비침
 *   dropCanvas(z=3) — 물방울 (매 프레임 clear + 재렌더, pointer-events: none)
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import {
  BACKGROUNDS, BackgroundPreset,
  generateRain, stepRain,
  createDroplet,
  type Droplet, type RainStreak,
} from '../lib/fogEngine'
import FogToolbar from './FogToolbar'

// ── Constants ─────────────────────────────────────────────────────────────────

const FOG_COLOR  = 'rgba(200, 215, 230, 0.85)'
const BRUSH_MIN  = 10
const STEP_FRAC  = 0.35   // brush-steps = radius × this
const DROP_PROB  = 0.30
const DROP_GAP   = 10     // min px between droplets on path

// ── Background rendering ───────────────────────────────────────────────────────

function drawBg(
  ctx: CanvasRenderingContext2D,
  preset: BackgroundPreset,
  rain: RainStreak[],
  w: number, h: number,
): void {
  // Gradient
  const g = ctx.createLinearGradient(0, 0, 0, h)
  preset.stops.forEach(([t, c]) => g.addColorStop(t, c))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // City lights (soft radial halos)
  for (const l of preset.lights) {
    const lx = l.x * w, ly = l.y * h
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, l.r)
    lg.addColorStop(0, l.color)
    lg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = lg
    ctx.fillRect(lx - l.r, ly - l.r, l.r * 2, l.r * 2)
  }

  // Rain streaks (subtle diagonal lines)
  ctx.strokeStyle = preset.rain
  ctx.lineWidth   = 0.8
  for (const s of rain) {
    ctx.globalAlpha = s.opacity
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(s.x - s.len * 0.15, s.y + s.len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ── Fog canvas helpers ─────────────────────────────────────────────────────────

/**
 * Fill fogCanvas with fog colour + subtle pixel-level noise for organic feel.
 * Called once at init and on Reset.
 */
function initFog(fc: HTMLCanvasElement): void {
  const ctx = fc.getContext('2d')!
  const w = fc.width, h = fc.height

  // Base fill
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = FOG_COLOR
  ctx.fillRect(0, 0, w, h)

  // Pixel-level noise: vary alpha 0.82–0.91
  const img  = ctx.getImageData(0, 0, w, h)
  const data = img.data
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.floor(data[i] * (0.92 + Math.random() * 0.10))
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Erase fog at (x,y) with radius r.
 * destination-out makes those pixels transparent → bgCanvas shows through.
 */
function wipeAt(fc: HTMLCanvasElement, x: number, y: number, r: number): void {
  const ctx = fc.getContext('2d')!
  ctx.globalCompositeOperation = 'destination-out'

  const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0,    'rgba(0,0,0,1)')
  grad.addColorStop(0.55, 'rgba(0,0,0,0.75)')
  grad.addColorStop(1,    'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalCompositeOperation = 'source-over'
}

/** Interpolate wipes between two points so strokes don't skip. */
function wipeBetween(
  fc: HTMLCanvasElement,
  x1: number, y1: number,
  x2: number, y2: number,
  r: number,
): void {
  const d     = Math.hypot(x2 - x1, y2 - y1)
  const step  = Math.max(1, r * STEP_FRAC)
  const steps = Math.ceil(d / step)
  for (let i = 0; i <= steps; i++) {
    const t = steps > 0 ? i / steps : 0
    wipeAt(fc, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r)
  }
}

// ── Droplet rendering ──────────────────────────────────────────────────────────

/**
 * Glass-bead water droplet.
 * Radial gradient from bright white highlight (upper-left) to translucent edge.
 */
function drawDroplet(ctx: CanvasRenderingContext2D, d: Droplet): void {
  if (d.alpha < 0.01) return
  const r  = d.radius
  const hx = d.x - r * 0.35
  const hy = d.y - r * 0.35

  ctx.save()
  ctx.globalAlpha = d.alpha

  // Water body (offset gradient → glass-bead illusion)
  const grad = ctx.createRadialGradient(hx, hy, 0, d.x, d.y, r)
  grad.addColorStop(0,    'rgba(255,255,255,0.92)')
  grad.addColorStop(0.25, 'rgba(200,225,245,0.75)')
  grad.addColorStop(0.60, 'rgba(130,165,205,0.55)')
  grad.addColorStop(1,    'rgba(65,100,145,0.28)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
  ctx.fill()

  // Bright specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.beginPath()
  ctx.arc(hx, hy, r * 0.22, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FoggyWindowCanvas() {
  const bgRef   = useRef<HTMLCanvasElement>(null)
  const fogRef  = useRef<HTMLCanvasElement>(null)
  const dropRef = useRef<HTMLCanvasElement>(null)

  const rainRef     = useRef<RainStreak[]>([])
  const dropletsRef = useRef<Droplet[]>([])
  const presetRef   = useRef<BackgroundPreset>(BACKGROUNDS[0])
  const brushRef    = useRef(18)
  const rafRef      = useRef(0)
  const frameRef    = useRef(0)

  // Drawing state
  const drawingRef  = useRef(false)
  const lastXRef    = useRef(0)
  const lastYRef    = useRef(0)
  const lastTimeRef = useRef(0)
  const dropAccRef  = useRef(0)    // px accumulated for next droplet
  const lastDipRef  = useRef({ x: 0, y: 0 })

  const [showHint, setShowHint] = useState(true)
  const [preset, setPreset]     = useState<BackgroundPreset>(BACKGROUNDS[0])
  const [brush, setBrush]       = useState(18)

  useEffect(() => { brushRef.current  = brush  }, [brush])
  useEffect(() => { presetRef.current = preset }, [preset])

  // ── Init ───────────────────────────────────────────────────────────────────

  const syncSize = useCallback(() => {
    const bg   = bgRef.current
    const fog  = fogRef.current
    const drop = dropRef.current
    if (!bg || !fog || !drop) return
    const w = bg.offsetWidth, h = bg.offsetHeight
    bg.width   = w; bg.height   = h
    fog.width  = w; fog.height  = h
    drop.width = w; drop.height = h
    rainRef.current = generateRain(85, w, h)
    initFog(fog)
  }, [])

  useEffect(() => {
    syncSize()
    const ob = new ResizeObserver(syncSize)
    if (bgRef.current) ob.observe(bgRef.current)
    return () => ob.disconnect()
  }, [syncSize])

  // ── rAF loop ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = () => {
      const bg   = bgRef.current
      const fog  = fogRef.current
      const drop = dropRef.current
      if (!bg || !fog || !drop) { rafRef.current = requestAnimationFrame(loop); return }

      const bgCtx   = bg.getContext('2d')!
      const dropCtx = drop.getContext('2d')!
      const fc      = fog  // fog canvas (direct ref, not context)
      const w = bg.width, h = bg.height
      frameRef.current++

      // 1. Background (clear + gradient + lights + rain)
      stepRain(rainRef.current, w, h)
      bgCtx.clearRect(0, 0, w, h)
      drawBg(bgCtx, presetRef.current, rainRef.current, w, h)

      // 2. fogCanvas is NOT cleared — it persists its holes
      //    But dripping droplets wipe additional fog each frame
      const toRemove: number[] = []
      dropletsRef.current.forEach((d, idx) => {
        // Fade-in
        d.alpha = Math.min(1, d.alpha + 0.08)

        if (d.isDripping && d.totalDrift < d.maxDrift) {
          d.vy += 0.005                           // gentle acceleration
          d.vy  = Math.min(d.vy, 2.2)
          d.driftPhase += 0.055
          d.x  += Math.sin(d.driftPhase) * 0.5   // sinusoidal drift
          d.y  += d.vy
          d.totalDrift += d.vy
          wipeAt(fc, d.x, d.y, d.radius * 0.8)   // drip trail wipes fog
        } else if (d.isDripping) {
          d.isDripping = false
        }

        if (d.y > h + 20) toRemove.push(idx)
      })
      // Prune off-screen
      if (toRemove.length) {
        dropletsRef.current = dropletsRef.current.filter((_, i) => !toRemove.includes(i))
      }

      // 3. Droplets
      dropCtx.clearRect(0, 0, w, h)
      for (const d of dropletsRef.current) drawDroplet(dropCtx, d)

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Hint auto-hide (handled via pointer events below)

  // ── Pointer handlers ───────────────────────────────────────────────────────

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = fogRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const spawnDroplet = useCallback((x: number, y: number) => {
    const dx = x - lastDipRef.current.x
    const dy = y - lastDipRef.current.y
    dropAccRef.current += Math.hypot(dx, dy)
    if (dropAccRef.current >= DROP_GAP && Math.random() < DROP_PROB) {
      dropAccRef.current = 0
      lastDipRef.current = { x, y }
      dropletsRef.current.push(createDroplet(x, y))
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    fogRef.current?.setPointerCapture(e.pointerId)
    const { x, y } = getPos(e)
    drawingRef.current = true
    lastXRef.current   = x; lastYRef.current = y
    lastTimeRef.current = performance.now()
    dropAccRef.current  = 0
    lastDipRef.current  = { x, y }
    wipeAt(fogRef.current!, x, y, brushRef.current)
    spawnDroplet(x, y)
    setShowHint(false)
  }, [spawnDroplet])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    e.preventDefault()

    const { x, y } = getPos(e)
    const now  = performance.now()
    const dx   = x - lastXRef.current, dy = y - lastYRef.current
    const dist = Math.hypot(dx, dy)
    if (dist < 1) return

    // Speed-based radius: fast = thinner, slow = thicker
    const dt     = Math.max(1, now - lastTimeRef.current)
    const speed  = dist / dt   // px/ms
    const radius = Math.max(BRUSH_MIN, brushRef.current - speed * 0.15 * brushRef.current)

    wipeBetween(fogRef.current!, lastXRef.current, lastYRef.current, x, y, radius)
    spawnDroplet(x, y)

    lastXRef.current  = x; lastYRef.current = y
    lastTimeRef.current = now
  }, [spawnDroplet])

  const onPointerUp = useCallback(() => {
    drawingRef.current = false
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    const fog = fogRef.current
    if (!fog) return
    initFog(fog)
    dropletsRef.current = []
  }, [])

  const handleSave = useCallback(() => {
    // Composite all three canvases into one for download
    const bg   = bgRef.current
    const fog  = fogRef.current
    const drop = dropRef.current
    if (!bg || !fog || !drop) return
    const out = document.createElement('canvas')
    out.width = bg.width; out.height = bg.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(bg,   0, 0)
    ctx.drawImage(fog,  0, 0)
    ctx.drawImage(drop, 0, 0)
    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = `foggy-${Date.now()}.png`
    a.click()
  }, [])

  const handlePreset = useCallback((p: BackgroundPreset) => {
    setPreset(p)
    // Re-seed fog texture (keep cleared areas by re-initialising over them —
    // this resets the fog but keeps the colour matching the new preset)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full overflow-hidden select-none">

      {/* Layer 1: Background */}
      <canvas ref={bgRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 1 }}
      />

      {/* Layer 2: Fog (interactive — receives pointer events) */}
      <canvas ref={fogRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{ zIndex: 2, cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Layer 3: Droplets (no pointer events) */}
      <canvas ref={dropRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 3 }}
      />

      {/* Hint text */}
      {showHint && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 10 }}
        >
          <p className="text-white/30 text-base sm:text-xl tracking-[0.22em] font-light">
            Touch to wipe the fog
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ zIndex: 20, position: 'relative' }}>
        <FogToolbar
          brush={brush}
          onBrushChange={setBrush}
          preset={preset}
          onPreset={handlePreset}
          onReset={handleReset}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}
