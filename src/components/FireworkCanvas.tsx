/**
 * FireworkCanvas
 *
 * "그린 선이 빛의 궤적이 되어, 그린 순서대로 폭죽이 라인을 그리며 펑펑 터진다."
 *
 * Each burst in the DrawingPlayback fires a medium-sized explosion at the
 * position on the user's drawn path.  A short local pop-trail (80–150 ms,
 * launches just below the burst point) gives a quick "whoosh" before the
 * explosion — NOT a long ascending rocket from the screen bottom.
 *
 * Motion blur at rgba(0,0,0,0.10) lets particle trails persist ~1–2 s so the
 * line shape is visible while the sequence plays, then naturally fades.
 *
 * No persistent afterglow dots.  Screen is clean once all particles die.
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GIF from 'gif.js'
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url'
import type { DrawingPlayback, PlaybackBurst, Firework } from '../lib/types'
import { createMediumBurst, tickFireworks, drawFireworks } from '../lib/fireworkEngine'
import { playBoom } from '../lib/audioEngine'

interface Props {
  playback: DrawingPlayback | null
  onFinished: () => void
}

// ── Short local pop-trail ─────────────────────────────────────────────────────

interface ActiveTrail {
  p0: { x: number; y: number }   // slightly below burst point
  p1: { x: number; y: number }   // control point (near midway)
  p2: { x: number; y: number }   // burst destination
  color: string
  startTime: number
  duration: number                // 80–150 ms
  burst: PlaybackBurst
  done: boolean
}

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

function drawTrail(ctx: CanvasRenderingContext2D, trail: ActiveTrail, now: number) {
  const t    = Math.min(1, (now - trail.startTime) / trail.duration)
  const TAIL = 0.5    // short burst: render the full tail half

  ctx.fillStyle   = trail.color
  ctx.shadowColor = trail.color

  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps
    const ti   = Math.max(0, t - TAIL + frac * TAIL)
    const pos  = quadBez(trail.p0, trail.p1, trail.p2, ti)
    ctx.globalAlpha = frac * 0.85
    ctx.shadowBlur  = frac * 12
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 0.5 + frac * 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // Bright head
  const head = quadBez(trail.p0, trail.p1, trail.p2, t)
  ctx.globalAlpha = 1
  ctx.shadowBlur  = 22
  ctx.beginPath()
  ctx.arc(head.x, head.y, 3, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
  ctx.shadowBlur  = 0
}

// ── Star field ────────────────────────────────────────────────────────────────

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

const STAR_COLORS = ['#ffffff', '#ffffff', '#ffffff', '#fffde4', '#eeeeff']

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], frame: number, w: number, h: number) {
  ctx.shadowBlur = 0
  for (const s of stars) {
    const a = Math.max(0, Math.min(1, s.baseAlpha + Math.sin(frame * s.speed + s.phase) * 0.28))
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
  ctx.globalAlpha = 1; ctx.shadowBlur = 0
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FireworkCanvas({ playback, onFinished }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fireworksRef = useRef<Firework[]>([])
  const pendingRef   = useRef<Array<{ burst: PlaybackBurst; trailStartAt: number }>>([])
  const trailsRef    = useRef<ActiveTrail[]>([])
  const seqStartRef  = useRef(0)
  const finishedRef  = useRef(false)
  const rafRef       = useRef(0)

  const starsRef = useRef<Star[]>(generateStars(200))
  const frameRef = useRef(0)

  // GIF
  const framesRef    = useRef<ImageData[]>([])
  const capturingRef = useRef(false)
  const [gifState, setGifState] = useState<'idle' | 'encoding' | 'done'>('idle')
  const gifBlobRef   = useRef<Blob | null>(null)

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

  // ── Load playback ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!playback) return

    finishedRef.current  = false
    framesRef.current    = []
    capturingRef.current = true
    setGifState('idle')
    gifBlobRef.current   = null
    fireworksRef.current = []
    trailsRef.current    = []

    const now = performance.now()
    seqStartRef.current = now

    // Trail starts trailDuration ms before the burst fires
    pendingRef.current = playback.bursts.map(b => ({
      burst: b,
      trailStartAt: b.globalDelay - b.trailDuration,
    }))

    console.log(`[FireworkCanvas] ${playback.bursts.length} bursts, ` +
      `total duration ~${(playback.lastBurstDelay / 1000).toFixed(1)}s`)
  }, [playback])

  // ── Animation loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let capFrames = 0

    const loop = () => {
      const w   = canvas.width
      const h   = canvas.height
      const now = performance.now()
      const frame = frameRef.current++

      if (playback) {
        const elapsed = now - seqStartRef.current

        // ── Spawn pop-trails for due bursts ──────────────────────────────────
        const stillPending: typeof pendingRef.current = []
        for (const item of pendingRef.current) {
          if (elapsed >= item.trailStartAt) {
            const b = item.burst
            // Pop-trail: starts 25–45 px directly below the burst point
            const dropY = 25 + Math.random() * 20
            const p0 = { x: b.x + (Math.random() - 0.5) * 15, y: b.y + dropY }
            const p1 = { x: (p0.x + b.x) / 2 + (Math.random() - 0.5) * 20, y: (p0.y + b.y) / 2 }
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

        // ── Fire arrived trails ───────────────────────────────────────────────
        for (const trail of trailsRef.current) {
          if (!trail.done && now - trail.startTime >= trail.duration) {
            trail.done = true
            fireworksRef.current.push(
              createMediumBurst(trail.p2.x, trail.p2.y, trail.burst.color, trail.burst.dirAngle ?? 0),
            )
            // Subtle sound — not every burst to avoid audio overload
            if (Math.random() < 0.5) playBoom(0.15 + Math.random() * 0.15)
          }
        }
        trailsRef.current = trailsRef.current.filter(t => !t.done)

        // ── Physics tick ──────────────────────────────────────────────────────
        fireworksRef.current = tickFireworks(fireworksRef.current)
      }

      // ── Background ───────────────────────────────────────────────────────────
      // Motion blur 0.20 → particles persist ~0.5–1 s; each burst is distinct.
      // Stronger than before so adjacent small bursts don't accumulate into one blob.
      const hasActive = fireworksRef.current.length > 0 || trailsRef.current.length > 0
      if (hasActive) {
        ctx.globalAlpha = 1; ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(0,0,0,0.20)'
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.clearRect(0, 0, w, h)
      }

      // ── Stars ─────────────────────────────────────────────────────────────────
      drawStars(ctx, starsRef.current, frame, w, h)

      // ── Pop-trails ────────────────────────────────────────────────────────────
      for (const trail of trailsRef.current) drawTrail(ctx, trail, now)

      // ── Firework particles ────────────────────────────────────────────────────
      if (fireworksRef.current.length > 0) drawFireworks(ctx, fireworksRef.current)

      // ── Vignette ──────────────────────────────────────────────────────────────
      drawVignette(ctx, w, h)

      // ── GIF capture ───────────────────────────────────────────────────────────
      if (capturingRef.current && playback) {
        capFrames++
        if (capFrames >= 3) { capFrames = 0; framesRef.current.push(ctx.getImageData(0, 0, w, h)) }
      }

      // ── Completion ────────────────────────────────────────────────────────────
      if (
        playback && !finishedRef.current &&
        pendingRef.current.length === 0 &&
        trailsRef.current.length === 0 &&
        fireworksRef.current.length === 0
      ) {
        finishedRef.current  = true
        capturingRef.current = false
        onFinished()
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── GIF export ────────────────────────────────────────────────────────────────

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
      gifBlobRef.current = blob; setGifState('done'); downloadBlob(blob)
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
  const a = document.createElement('a')
  a.href = url; a.download = `firework-${Date.now()}.gif`; a.click()
  URL.revokeObjectURL(url)
}
