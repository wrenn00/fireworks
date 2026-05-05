/**
 * TapFireworkCanvas
 *
 * Tap = small ink firework.  Hold longer = bigger firework.
 *
 * While holding, a growing ring shows the charge level at the press point.
 * On release the firework is drawn progressively (center → tips over 280–800 ms),
 * held for 1.5 s, then fades out — no persistent dots.
 *
 * Background: stars + vignette (same as FireworkCanvas).
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import {
  createInkFirework, drawInkFirework, isInkDone, type InkFirework,
} from '../lib/inkFirework'
import { playWhoosh, playBoom } from '../lib/audioEngine'

interface Props {
  color: string   // current user-selected color
}

// ── Star field (local copy — same as FireworkCanvas) ──────────────────────────

interface Star { x: number; y: number; radius: number; baseAlpha: number; phase: number; speed: number }

function generateStars(n = 200): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random(), y: Math.random(),
    radius:    Math.random() < 0.01 ? 1.5 : 0.5 + Math.random() * 0.5,
    baseAlpha: 0.35 + Math.random() * 0.35,
    phase:     Math.random() * Math.PI * 2,
    speed:     0.01 + Math.random() * 0.025,
  }))
}
const STAR_COLS = ['#ffffff', '#ffffff', '#ffffff', '#fffde4', '#eeeeff']

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], frame: number, w: number, h: number) {
  ctx.shadowBlur = 0
  for (const s of stars) {
    const a = Math.max(0, Math.min(1, s.baseAlpha + Math.sin(frame * s.speed + s.phase) * 0.28))
    if (a < 0.01) continue
    ctx.globalAlpha = a
    ctx.fillStyle   = STAR_COLS[Math.floor(Math.random() * STAR_COLS.length)]
    ctx.beginPath()
    ctx.arc(s.x * w, s.y * h, s.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2, cy = h / 2
  const r  = Math.max(w, h) * 0.72
  const g  = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.30)')
  ctx.globalAlpha = 1; ctx.shadowBlur = 0
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
}

// ── Charge indicator ──────────────────────────────────────────────────────────

interface Charge { x: number; y: number; startTime: number; pointerId: number }

function drawCharge(ctx: CanvasRenderingContext2D, charge: Charge, color: string, now: number) {
  const elapsed = now - charge.startTime
  const power   = Math.min(1, elapsed / 1500)
  const radius  = 5 + power * 28              // 5→33 px
  const alpha   = 0.30 + power * 0.50          // 0.30→0.80

  // Outer ring (shows charge level)
  ctx.globalAlpha  = alpha
  ctx.strokeStyle  = color
  ctx.lineWidth    = 1.5
  ctx.shadowBlur   = 0
  ctx.beginPath()
  ctx.arc(charge.x, charge.y, radius, 0, Math.PI * 2)
  ctx.stroke()

  // Pulsing inner dot
  const pulse = 1 + 0.3 * Math.sin(elapsed * 0.012)
  ctx.globalAlpha = alpha * 0.65
  ctx.fillStyle   = color
  ctx.beginPath()
  ctx.arc(charge.x, charge.y, 2.5 * pulse, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TapFireworkCanvas({ color }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fireworksRef = useRef<InkFirework[]>([])
  const chargeRef    = useRef<Charge | null>(null)
  const colorRef     = useRef(color)
  const starsRef     = useRef<Star[]>(generateStars(200))
  const frameRef     = useRef(0)
  const rafRef       = useRef(0)
  const [hasLaunched, setHasLaunched] = useState(false)

  // Keep colorRef in sync without restarting the rAF loop
  useEffect(() => { colorRef.current = color }, [color])

  // ── Resize ───────────────────────────────────────────────────────────────────

  const resize = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = c.offsetWidth; c.height = c.offsetHeight
  }, [])

  useEffect(() => {
    resize()
    const ob = new ResizeObserver(resize)
    if (canvasRef.current) ob.observe(canvasRef.current)
    return () => ob.disconnect()
  }, [resize])

  // ── rAF loop ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = () => {
      const w     = canvas.width
      const h     = canvas.height
      const now   = performance.now()
      const frame = frameRef.current++

      ctx.clearRect(0, 0, w, h)

      // Stars
      drawStars(ctx, starsRef.current, frame, w, h)

      // Charge indicator
      if (chargeRef.current) drawCharge(ctx, chargeRef.current, colorRef.current, now)

      // Ink fireworks
      for (const fw of fireworksRef.current) drawInkFirework(ctx, fw, now)

      // Prune finished fireworks
      fireworksRef.current = fireworksRef.current.filter(fw => !isInkDone(fw, now))

      // Vignette
      drawVignette(ctx, w, h)

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])   // stable — uses refs only

  // ── Pointer events ────────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    chargeRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      startTime:  performance.now(),
      pointerId:  e.pointerId,
    }
    canvasRef.current?.setPointerCapture(e.pointerId)
    playWhoosh(0.3)
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const charge = chargeRef.current
    if (!charge || charge.pointerId !== e.pointerId) return
    chargeRef.current = null

    const elapsed = performance.now() - charge.startTime
    const power   = Math.min(1, elapsed / 1500)

    fireworksRef.current.push(
      createInkFirework(charge.x, charge.y, colorRef.current, power),
    )
    playBoom(0.2 + power * 0.45)
    setHasLaunched(true)
  }, [])

  const onPointerCancel = useCallback(() => {
    chargeRef.current = null
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none"
        style={{ cursor: 'crosshair', display: 'block' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerCancel}
        onPointerCancel={onPointerCancel}
      />

      {/* Hint — fades away after first launch */}
      {!hasLaunched && (
        <div className="absolute inset-0 flex flex-col items-center justify-center
                        gap-2 pointer-events-none select-none">
          <p className="text-white/18 text-sm tracking-wide">
            Tap anywhere · Hold for bigger
          </p>
        </div>
      )}
    </div>
  )
}
