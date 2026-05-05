import { useRef, useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GIF from 'gif.js'
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url'
import type { WorldState, DrawingSequence, ScheduledBlueprint, FireworkPattern } from '../lib/types'
import { createWorldState, tickWorld, drawWorld } from '../lib/fireworkEngine'
import { playBoom } from '../lib/audioEngine'

interface Props {
  sequence: DrawingSequence | null
  onFinished: () => void
  /** Called once when the first shot fires, with the primary pattern */
  onPatternDetected?: (pattern: FireworkPattern) => void
}

// ── Star field ────────────────────────────────────────────────────────────────

const STAR_COLORS = ['#ffffff', '#ffffff', '#ffffff', '#fffde4', '#eeeeff']

interface Star {
  x: number; y: number
  radius: number
  baseAlpha: number
  phaseOffset: number
  speed: number
}

function generateStars(count = 200): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(), y: Math.random(),
    radius: Math.random() < 0.01 ? 1.5 : 0.5 + Math.random() * 0.5,
    baseAlpha: 0.35 + Math.random() * 0.35,
    phaseOffset: Math.random() * Math.PI * 2,
    speed: 0.01 + Math.random() * 0.025,
  }))
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: Star[], frame: number, w: number, h: number, brightnessMult = 1,
) {
  ctx.shadowBlur = 0
  for (const s of stars) {
    const alpha = Math.max(0, Math.min(1,
      (s.baseAlpha + Math.sin(frame * s.speed + s.phaseOffset) * 0.28) * brightnessMult,
    ))
    if (alpha < 0.01) continue
    ctx.globalAlpha = alpha
    ctx.fillStyle = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
    ctx.beginPath()
    ctx.arc(s.x * w, s.y * h, s.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2, cy = h / 2
  const r = Math.max(w, h) * 0.72
  const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.30)')
  ctx.fillStyle = grad
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  ctx.fillRect(0, 0, w, h)
}

// ── Merge a new WorldState into an existing one ───────────────────────────────

function mergeWorld(base: WorldState, incoming: WorldState): WorldState {
  return {
    fireworks: [...base.fireworks, ...incoming.fireworks],
    flashes:   [...base.flashes,   ...incoming.flashes],
    globalGlowAlpha: Math.max(base.globalGlowAlpha, incoming.globalGlowAlpha),
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FireworkCanvas({ sequence, onFinished, onPatternDetected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef  = useRef<WorldState>({ fireworks: [], flashes: [], globalGlowAlpha: 0 })
  const rafRef    = useRef<number>(0)
  const finishedRef = useRef(false)
  const starsRef  = useRef<Star[]>(generateStars(200))
  const frameRef  = useRef(0)

  // Sequence scheduling
  const pendingRef   = useRef<ScheduledBlueprint[]>([])
  const startTimeRef = useRef<number>(0)
  const patternSentRef = useRef(false)

  // GIF capture
  const framesRef   = useRef<ImageData[]>([])
  const capturingRef = useRef(false)
  const [gifState, setGifState] = useState<'idle' | 'encoding' | 'done'>('idle')
  const gifBlobRef  = useRef<Blob | null>(null)

  // ── Resize ────────────────────────────────────────────────────────────────

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
  }, [])

  useEffect(() => {
    resize()
    const observer = new ResizeObserver(resize)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [resize])

  // ── Load new sequence ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!sequence) return
    finishedRef.current = false
    patternSentRef.current = false
    framesRef.current = []
    capturingRef.current = true
    setGifState('idle')
    gifBlobRef.current = null

    worldRef.current  = { fireworks: [], flashes: [], globalGlowAlpha: 0 }
    pendingRef.current = [...sequence.shots, ...sequence.grandFinale]
      .sort((a, b) => a.delayMs - b.delayMs)
    startTimeRef.current = performance.now()
  }, [sequence])

  // ── Animation loop ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let framesSinceCapture = 0
    const CAPTURE_EVERY = 3

    const loop = () => {
      const w = canvas.width
      const h = canvas.height
      const frame = frameRef.current++

      // ── Fire scheduled shots ────────────────────────────────────────────
      if (pendingRef.current.length > 0) {
        const elapsed = performance.now() - startTimeRef.current
        const ready = pendingRef.current.filter(s => s.delayMs <= elapsed)
        if (ready.length > 0) {
          pendingRef.current = pendingRef.current.filter(s => s.delayMs > elapsed)
          for (const shot of ready) {
            const incoming = createWorldState(shot.blueprint)
            worldRef.current = mergeWorld(worldRef.current, incoming)
            // Sound: intensity based on particle count
            const intensity = Math.min(1, shot.blueprint.particleVectors.length / 300)
            playBoom(0.35 + intensity * 0.55)
            // Notify parent of first pattern
            if (!patternSentRef.current) {
              patternSentRef.current = true
              onPatternDetected?.(shot.blueprint.pattern)
            }
          }
        }
      }

      const hasActivity =
        pendingRef.current.length > 0 ||
        worldRef.current.fireworks.length > 0 ||
        worldRef.current.flashes.length > 0 ||
        worldRef.current.globalGlowAlpha > 0.002

      // ── Background ─────────────────────────────────────────────────────
      if (worldRef.current.fireworks.length > 0 || worldRef.current.globalGlowAlpha > 0.002) {
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.clearRect(0, 0, w, h)
      }

      // ── Stars ───────────────────────────────────────────────────────────
      const glowBoost = 1 + worldRef.current.globalGlowAlpha * 1.2
      drawStars(ctx, starsRef.current, frame, w, h, glowBoost)

      // ── Fireworks ───────────────────────────────────────────────────────
      if (hasActivity) {
        worldRef.current = tickWorld(worldRef.current)
        drawWorld(ctx, worldRef.current, w, h)

        if (capturingRef.current) {
          framesSinceCapture++
          if (framesSinceCapture >= CAPTURE_EVERY) {
            framesSinceCapture = 0
            framesRef.current.push(ctx.getImageData(0, 0, w, h))
          }
        }

        // Completion check: no more pending shots AND world is empty
        const next = worldRef.current
        if (
          pendingRef.current.length === 0 &&
          next.fireworks.length === 0 &&
          next.flashes.length === 0 &&
          next.globalGlowAlpha <= 0.002 &&
          !finishedRef.current
        ) {
          finishedRef.current = true
          capturingRef.current = false
          onFinished()
        }
      }

      // ── Vignette ────────────────────────────────────────────────────────
      drawVignette(ctx, w, h)

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── GIF export ────────────────────────────────────────────────────────────

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
    const offscreen = document.createElement('canvas')
    offscreen.width = canvas.width
    offscreen.height = canvas.height
    const offCtx = offscreen.getContext('2d')!
    for (const frame of frames) {
      offCtx.putImageData(frame, 0, 0)
      gif.addFrame(offscreen, { delay: 50, copy: true })
    }
    gif.on('finished', (blob) => {
      gifBlobRef.current = blob
      setGifState('done')
      downloadBlob(blob)
    })
    gif.render()
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

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
  a.href = url
  a.download = `firework-${Date.now()}.gif`
  a.click()
  URL.revokeObjectURL(url)
}
