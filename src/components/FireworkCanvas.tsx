/**
 * FireworkCanvas
 *
 * Receives a DrawingPlayback (list of timed bursts along the user's drawn path).
 * For each burst it:
 *   1. Launches an ascending bezier trail from the bottom of the screen.
 *   2. On arrival: fires a small particle burst + creates a persistent afterglow dot.
 * After the last burst the afterglows hold for 1.5 s, then fade over 3 s.
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GIF from 'gif.js'
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url'
import type { DrawingPlayback, PlaybackBurst } from '../lib/types'
import { createSmallBurst, tickFireworks, drawFireworks } from '../lib/fireworkEngine'
import { playBoom } from '../lib/audioEngine'

interface Props {
  playback: DrawingPlayback | null
  onFinished: () => void
}

// ── Local simulation types ────────────────────────────────────────────────────

interface ActiveTrail {
  p0: { x: number; y: number }   // launch point (bottom of canvas)
  p1: { x: number; y: number }   // bezier control point
  p2: { x: number; y: number }   // burst destination
  color: string
  startTime: number               // perf.now() when trail was spawned
  duration: number                // ms for the ascent
  burst: PlaybackBurst            // fired when trail arrives
  done: boolean
}

interface Afterglow {
  x: number; y: number
  color: string
  baseRadius: number              // 4–8 px
  alpha: number                   // current display alpha (re-computed each frame)
  phase: number                   // sin pulse offset
  holdUntil: number               // perf.now() — don't fade before this
  fadeDuration: number            // ms for the alpha 1→0 fade
}

// ── Bezier helper ─────────────────────────────────────────────────────────────

function quadBez(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  }
}

// ── Trail rendering ───────────────────────────────────────────────────────────

function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: ActiveTrail,
  now: number,
) {
  const elapsed = now - trail.startTime
  const t = Math.min(1, elapsed / trail.duration)
  const TAIL = 0.14   // fraction of path that makes the tail

  ctx.fillStyle  = trail.color
  ctx.shadowColor = trail.color

  // Fading tail dots (oldest → transparent, head → bright)
  const steps = 14
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps                             // 0=oldest, 1=head
    const ti   = Math.max(0, t - TAIL + frac * TAIL)
    const pos  = quadBez(trail.p0, trail.p1, trail.p2, ti)
    ctx.globalAlpha = frac * 0.75
    ctx.shadowBlur  = frac * 8
    const r = 0.4 + frac * 1.6
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Bright head
  const head = quadBez(trail.p0, trail.p1, trail.p2, t)
  ctx.globalAlpha = 1
  ctx.shadowBlur  = 18
  ctx.beginPath()
  ctx.arc(head.x, head.y, 2.8, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
  ctx.shadowBlur  = 0
}

// ── Afterglow rendering ───────────────────────────────────────────────────────

/** Returns false when the afterglow has fully faded and can be removed. */
function drawAfterglow(
  ctx: CanvasRenderingContext2D,
  ag: Afterglow,
  now: number,
): boolean {
  let alpha = ag.alpha
  if (now > ag.holdUntil) {
    const fadeT = (now - ag.holdUntil) / ag.fadeDuration
    alpha = Math.max(0, 1 - fadeT) * ag.alpha
  }
  if (alpha < 0.005) return false

  // Gentle pulse
  const pulse = 1 + 0.09 * Math.sin(now * 0.0038 + ag.phase)
  const r     = ag.baseRadius * pulse

  ctx.globalAlpha  = alpha
  ctx.fillStyle    = ag.color
  ctx.shadowColor  = ag.color
  ctx.shadowBlur   = r * 5
  ctx.beginPath()
  ctx.arc(ag.x, ag.y, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
  ctx.shadowBlur  = 0
  return true
}

// ── Star field ────────────────────────────────────────────────────────────────

interface Star {
  x: number; y: number
  radius: number
  baseAlpha: number
  phase: number
  speed: number
}

function generateStars(n = 200): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random(), y: Math.random(),
    radius:    Math.random() < 0.01 ? 1.5 : 0.5 + Math.random() * 0.5,
    baseAlpha: 0.35 + Math.random() * 0.35,
    phase:     Math.random() * Math.PI * 2,
    speed:     0.01 + Math.random() * 0.025,
  }))
}

const STAR_COLORS = ['#ffffff', '#ffffff', '#ffffff', '#fffde4', '#eeeeff']

function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: Star[], frame: number, w: number, h: number,
  brightMult = 1,
) {
  ctx.shadowBlur = 0
  for (const s of stars) {
    const a = Math.max(0, Math.min(1,
      (s.baseAlpha + Math.sin(frame * s.speed + s.phase) * 0.28) * brightMult,
    ))
    if (a < 0.01) continue
    ctx.globalAlpha = a
    ctx.fillStyle   = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
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
  ctx.globalAlpha = 1
  ctx.shadowBlur  = 0
  ctx.fillStyle   = g
  ctx.fillRect(0, 0, w, h)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FireworkCanvas({ playback, onFinished }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Particle world (small burst physics)
  type FWArray = ReturnType<typeof createSmallBurst>[]
  const worldFWRef = useRef<FWArray>([])

  // Sequence state
  const pendingRef      = useRef<Array<{ burst: PlaybackBurst; trailStartAt: number }>>([])
  const trailsRef       = useRef<ActiveTrail[]>([])
  const afterglowsRef   = useRef<Afterglow[]>([])
  const seqStartRef     = useRef(0)
  const holdUntilRef    = useRef(0)   // absolute perf.now() for afterglow hold
  const finishedRef     = useRef(false)
  const rafRef          = useRef(0)

  // Visuals
  const starsRef  = useRef<Star[]>(generateStars(200))
  const frameRef  = useRef(0)

  // GIF
  const framesRef    = useRef<ImageData[]>([])
  const capturingRef = useRef(false)
  const [gifState, setGifState] = useState<'idle' | 'encoding' | 'done'>('idle')
  const gifBlobRef   = useRef<Blob | null>(null)

  // ── Resize ──────────────────────────────────────────────────────────────────

  const resize = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.width  = c.offsetWidth
    c.height = c.offsetHeight
  }, [])

  useEffect(() => {
    resize()
    const ob = new ResizeObserver(resize)
    if (canvasRef.current) ob.observe(canvasRef.current)
    return () => ob.disconnect()
  }, [resize])

  // ── Load new playback ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!playback) return

    finishedRef.current = false
    framesRef.current   = []
    capturingRef.current = true
    setGifState('idle')
    gifBlobRef.current  = null
    worldFWRef.current  = []
    trailsRef.current   = []
    afterglowsRef.current = []

    const now = performance.now()
    seqStartRef.current = now

    // holdUntil = when afterglows start fading: 1.5 s after last regular burst
    holdUntilRef.current = now + playback.lastBurstDelay + 1500

    // Pre-compute when each trail should start (burst fires at globalDelay,
    // trail must start trailDuration ms before that)
    pendingRef.current = playback.bursts.map(burst => ({
      burst,
      trailStartAt: burst.globalDelay - burst.trailDuration,
    }))

    console.log(`[FireworkCanvas] Loaded playback: ${playback.bursts.length} bursts`)
  }, [playback])

  // ── Animation loop ───────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let capFrames = 0
    const CAPTURE_EVERY = 3

    const loop = () => {
      const w   = canvas.width
      const h   = canvas.height
      const now = performance.now()
      const frame = frameRef.current++

      if (playback) {
        const elapsed = now - seqStartRef.current

        // ── Spawn trails for due bursts ────────────────────────────────────
        const stillPending: typeof pendingRef.current = []
        for (const item of pendingRef.current) {
          if (elapsed >= item.trailStartAt) {
            const b  = item.burst
            // Launch from bottom of screen, x ≈ burst x + slight random jitter
            const p0 = { x: b.x + (Math.random() - 0.5) * 80, y: h + 16 }
            // Control point: midpoint pulled left/right and upward
            const p1 = {
              x: (p0.x + b.x) / 2 + (Math.random() - 0.5) * 130,
              y: (p0.y + b.y) / 2 - 60 - Math.random() * 60,
            }
            trailsRef.current.push({
              p0, p1, p2: { x: b.x, y: b.y },
              color: b.color,
              startTime: now,
              duration: b.trailDuration,
              burst: b,
              done: false,
            })
          } else {
            stillPending.push(item)
          }
        }
        pendingRef.current = stillPending

        // ── Check trail arrivals → fire burst + create afterglow ───────────
        for (const trail of trailsRef.current) {
          if (!trail.done && now - trail.startTime >= trail.duration) {
            trail.done = true

            // Particle burst
            worldFWRef.current.push(
              createSmallBurst(trail.p2.x, trail.p2.y, trail.burst.color, trail.burst.size),
            )

            // Sound (only for non-tiny bursts to avoid audio spam)
            if (trail.burst.size !== 'small' && Math.random() < 0.4) {
              playBoom(trail.burst.size === 'large' ? 0.22 : 0.13)
            }

            // Afterglow dot
            afterglowsRef.current.push({
              x: trail.p2.x,
              y: trail.p2.y,
              color: trail.burst.color,
              baseRadius: trail.burst.size === 'large' ? 6 : trail.burst.size === 'medium' ? 5 : 3.5,
              alpha: 0.9,
              phase: Math.random() * Math.PI * 2,
              holdUntil:    holdUntilRef.current,
              fadeDuration: 3000,
            })

            console.log(
              `[FireworkCanvas] Burst @ (${Math.round(trail.p2.x)},${Math.round(trail.p2.y)})`,
              trail.burst.size, trail.burst.color,
            )
          }
        }
        trailsRef.current = trailsRef.current.filter(t => !t.done)

        // ── Tick particle physics ──────────────────────────────────────────
        worldFWRef.current = tickFireworks(worldFWRef.current)
      }

      // ── Background ────────────────────────────────────────────────────────
      const hasParticles = worldFWRef.current.length > 0 || trailsRef.current.length > 0
      if (hasParticles) {
        ctx.globalAlpha = 1
        ctx.shadowBlur  = 0
        ctx.fillStyle   = 'rgba(0,0,0,0.18)'
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.clearRect(0, 0, w, h)
      }

      // ── Stars ─────────────────────────────────────────────────────────────
      drawStars(ctx, starsRef.current, frame, w, h)

      // ── Trails ────────────────────────────────────────────────────────────
      for (const trail of trailsRef.current) drawTrail(ctx, trail, now)

      // ── Burst particles ────────────────────────────────────────────────────
      if (worldFWRef.current.length > 0) {
        drawFireworks(ctx, worldFWRef.current)
      }

      // ── Afterglows ─────────────────────────────────────────────────────────
      afterglowsRef.current = afterglowsRef.current.filter(ag => drawAfterglow(ctx, ag, now))

      // ── Vignette ──────────────────────────────────────────────────────────
      drawVignette(ctx, w, h)

      // ── GIF capture ───────────────────────────────────────────────────────
      if (capturingRef.current && playback) {
        capFrames++
        if (capFrames >= CAPTURE_EVERY) {
          capFrames = 0
          framesRef.current.push(ctx.getImageData(0, 0, w, h))
        }
      }

      // ── Completion check ──────────────────────────────────────────────────
      if (
        playback &&
        !finishedRef.current &&
        pendingRef.current.length === 0 &&
        trailsRef.current.length === 0 &&
        worldFWRef.current.length === 0 &&
        afterglowsRef.current.length === 0
      ) {
        finishedRef.current = true
        capturingRef.current = false
        onFinished()
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── GIF export ───────────────────────────────────────────────────────────────

  const handleSaveGif = useCallback(() => {
    if (gifBlobRef.current) { downloadBlob(gifBlobRef.current); return }
    const canvas = canvasRef.current
    const frames = framesRef.current
    if (!canvas || frames.length === 0) return
    setGifState('encoding')

    const gif = new GIF({
      workers: 2, quality: 8,
      width: canvas.width, height: canvas.height,
      workerScript: gifWorkerUrl, repeat: 0, background: '#000000',
    })
    const off = document.createElement('canvas')
    off.width = canvas.width; off.height = canvas.height
    const offCtx = off.getContext('2d')!
    for (const f of frames) {
      offCtx.putImageData(f, 0, 0)
      gif.addFrame(off, { delay: 50, copy: true })
    }
    gif.on('finished', blob => {
      gifBlobRef.current = blob
      setGifState('done')
      downloadBlob(blob)
    })
    gif.render()
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="w-full h-full" />
      <AnimatePresence>
        {finishedRef.current && (
          <motion.button
            onClick={handleSaveGif}
            disabled={gifState === 'encoding'}
            className="absolute bottom-20 right-4 px-4 py-2 text-xs rounded
                       border border-white/15 text-white/40
                       hover:text-white/80 hover:border-white/35
                       disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors backdrop-blur-sm bg-black/20"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.4 }}
          >
            {gifState === 'encoding' ? 'Encoding…' : gifState === 'done' ? 'Download again' : 'Save GIF'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function downloadBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = `firework-${Date.now()}.gif`
  a.click()
  URL.revokeObjectURL(url)
}
