/**
 * Monochrome FireworkCanvas.
 * Black sky + white twinkling stars + white ray-based fireworks.
 * Motion blur (0.18) creates natural light trails.
 */
import { useRef, useEffect, useCallback } from 'react'
import type { DrawingPlayback, PlaybackBurst } from '../lib/types'
import { createRayFirework, drawRayFirework, isRayFireworkDone, type RayFirework } from '../lib/rayFirework'
import { playBoom } from '../lib/audioEngine'

interface Props {
  playback:   DrawingPlayback | null
  onFinished: () => void
}

// ── Stars ─────────────────────────────────────────────────────────────────────

interface Star {
  x: number; y: number
  r: number
  baseAlpha: number
  phase: number
  speed: number
  isCross: boolean   // 1% chance: large cross-shaped star
}

function generateStars(n: number, w: number, h: number): Star[] {
  return Array.from({ length: n }, () => {
    const isCross = Math.random() < 0.012
    return {
      x: Math.random() * w, y: Math.random() * h,
      r:         isCross ? 1.8 + Math.random() * 0.8 : 0.5 + Math.random() * 1.5,
      baseAlpha: 0.30 + Math.random() * 0.55,
      phase:     Math.random() * Math.PI * 2,
      speed:     0.0008 + Math.random() * 0.0018,
      isCross,
    }
  })
}

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], now: number): void {
  for (const s of stars) {
    const a = Math.max(0, Math.min(1, s.baseAlpha + Math.sin(now * s.speed + s.phase) * 0.30))
    if (a < 0.02) continue

    ctx.save()
    ctx.globalAlpha = a
    ctx.fillStyle   = '#fff'

    if (s.isCross) {
      ctx.shadowBlur  = s.r * 6
      ctx.shadowColor = '#fff'
      ctx.fillRect(s.x - s.r * 1.6, s.y - 0.4, s.r * 3.2, 0.8)
      ctx.fillRect(s.x - 0.4, s.y - s.r * 1.6, 0.8, s.r * 3.2)
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.35, 0, Math.PI * 2); ctx.fill()
    } else {
      ctx.shadowBlur  = s.r * 2
      ctx.shadowColor = '#fff'
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FireworkCanvas({ playback, onFinished }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fireworksRef = useRef<RayFirework[]>([])
  const pendingRef   = useRef<Array<{ burst: PlaybackBurst; trailStartAt: number }>>([])
  const seqStartRef  = useRef(0)
  const finishedRef  = useRef(false)
  const starsRef     = useRef<Star[]>([])
  const rafRef       = useRef(0)

  // ── Resize ───────────────────────────────────────────────────────────────────

  const resize = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = c.offsetWidth; c.height = c.offsetHeight
    starsRef.current = generateStars(180, c.width, c.height)
  }, [])

  useEffect(() => {
    resize()
    const ob = new ResizeObserver(resize)
    if (canvasRef.current) ob.observe(canvasRef.current)
    return () => ob.disconnect()
  }, [resize])

  // ── Load playback ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!playback) return
    finishedRef.current  = false
    fireworksRef.current = []
    pendingRef.current   = playback.bursts.map(b => ({
      burst: b,
      trailStartAt: b.globalDelay,  // fire immediately at position (no trail ascent)
    }))
    seqStartRef.current = performance.now()
  }, [playback])

  // ── rAF loop ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current
      if (!canvas) { rafRef.current = requestAnimationFrame(loop); return }
      const ctx = canvas.getContext('2d')!
      const w = canvas.width, h = canvas.height
      const now = performance.now()

      // ── Fire pending bursts ────────────────────────────────────────────────
      if (playback && pendingRef.current.length > 0) {
        const elapsed = now - seqStartRef.current
        const ready: typeof pendingRef.current = []
        const remain: typeof pendingRef.current = []
        for (const item of pendingRef.current) {
          if (elapsed >= item.trailStartAt) ready.push(item)
          else remain.push(item)
        }
        pendingRef.current = remain
        for (const item of ready) {
          fireworksRef.current.push(
            createRayFirework(item.burst.x, item.burst.y, Math.min(w, h)),
          )
          if (Math.random() < 0.6) playBoom(0.12 + Math.random() * 0.12)
        }
      }

      // ── Background ─────────────────────────────────────────────────────────
      if (fireworksRef.current.length > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
      }

      // ── Stars (always redrawn fresh → always crisp) ────────────────────────
      drawStars(ctx, starsRef.current, now)

      // ── Fireworks ──────────────────────────────────────────────────────────
      fireworksRef.current = fireworksRef.current.filter(fw => {
        const alive = drawRayFirework(ctx, fw, now)
        return alive && !isRayFireworkDone(fw, now)
      })

      // ── Completion ──────────────────────────────────────────────────────────
      if (
        playback && !finishedRef.current &&
        pendingRef.current.length === 0 &&
        fireworksRef.current.length === 0
      ) {
        finishedRef.current = true
        onFinished()
      }

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
}
