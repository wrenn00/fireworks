import {
  useRef, useEffect, useCallback, useState,
  forwardRef, useImperativeHandle,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Point, Stroke, Drawing } from '../lib/types'

// ── Public handle exposed via ref ─────────────────────────────────────────────

export interface DrawingCanvasHandle {
  launch: () => void
  clear: () => void
  undo: () => void
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  color: string
  lineWidth: number
  isLaunching: boolean
  onStrokeComplete: (stroke: Stroke) => void
  onLaunch: (drawing: Drawing) => void
  onClear: () => void
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function computeBounds(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return { minX, minY, maxX, maxY }
}

function redrawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  glowScale = 1,
) {
  for (const s of strokes) {
    drawSmooth(ctx, s.points, s.color, s.width, 1, glowScale)
  }
}

function drawSmooth(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number,
  alpha: number,
  glowScale = 1,
) {
  if (points.length < 2) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = width * 1.5 * glowScale
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my)
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
  ctx.stroke()
  ctx.restore()
}

// ── Component ─────────────────────────────────────────────────────────────────

const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(function DrawingCanvas(
  { color, lineWidth, isLaunching, onStrokeComplete, onLaunch, onClear },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const currentPoints = useRef<Point[]>([])
  const committedStrokes = useRef<Stroke[]>([])
  const glowRafRef = useRef<number>(0)
  const [strokeCount, setStrokeCount] = useState(0)

  // ── Canvas sizing ─────────────────────────────────────────────────────────

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const ctx = canvas.getContext('2d')
    if (ctx) redrawStrokes(ctx, committedStrokes.current)
  }, [])

  useEffect(() => {
    resize()
    const observer = new ResizeObserver(resize)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [resize])

  // ── Glow burst animation when isLaunching ─────────────────────────────────

  useEffect(() => {
    if (!isLaunching) {
      cancelAnimationFrame(glowRafRef.current)
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const start = performance.now()
    const dur = 600

    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1)
      const glowScale = 1 + t * t * 24
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      redrawStrokes(ctx, committedStrokes.current, glowScale)
      if (t < 1) glowRafRef.current = requestAnimationFrame(tick)
    }
    glowRafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(glowRafRef.current)
  }, [isLaunching])

  // ── Pointer helpers ───────────────────────────────────────────────────────

  const getPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      t: performance.now(),
      pressure: e.pressure > 0 ? e.pressure : undefined,
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLaunching) return
    isDrawing.current = true
    currentPoints.current = [getPoint(e)]
    canvasRef.current?.setPointerCapture(e.pointerId)
  }, [getPoint, isLaunching])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    currentPoints.current.push(getPoint(e))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    redrawStrokes(ctx, committedStrokes.current)
    drawSmooth(ctx, currentPoints.current, color, lineWidth, 0.9)
  }, [color, getPoint, lineWidth])

  const onPointerUp = useCallback(() => {
    if (!isDrawing.current) return
    isDrawing.current = false

    const points = currentPoints.current
    currentPoints.current = []
    if (points.length < 2) return

    const stroke: Stroke = { points, color, width: lineWidth }
    committedStrokes.current = [...committedStrokes.current, stroke]
    setStrokeCount(committedStrokes.current.length)

    const ctx = canvasRef.current?.getContext('2d')
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      redrawStrokes(ctx, committedStrokes.current)
    }
    onStrokeComplete(stroke)
  }, [color, lineWidth, onStrokeComplete])

  // ── Clear / Undo / Launch ─────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    committedStrokes.current = []
    setStrokeCount(0)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    onClear()
  }, [onClear])

  const handleUndo = useCallback(() => {
    if (committedStrokes.current.length === 0) return
    committedStrokes.current = committedStrokes.current.slice(0, -1)
    setStrokeCount(committedStrokes.current.length)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      redrawStrokes(ctx, committedStrokes.current)
    }
  }, [])

  const handleLaunch = useCallback(() => {
    const strokes = committedStrokes.current
    if (strokes.length === 0) return
    onLaunch({ strokes, bounds: computeBounds(strokes) })
  }, [onLaunch])

  // ── Imperative handle for keyboard shortcuts in App ───────────────────────

  useImperativeHandle(ref, () => ({
    launch: handleLaunch,
    clear: handleClear,
    undo: handleUndo,
  }), [handleLaunch, handleClear, handleUndo])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Big heading — "Draw something." fades out on first stroke */}
      <AnimatePresence>
        {strokeCount === 0 && !isLaunching && (
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center
                       pointer-events-none select-none z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-thin tracking-tight text-white/20">
              Draw something.
            </h1>
            <p className="mt-3 text-xs text-white/10 tracking-widest uppercase">
              Space to launch &middot; ⌘Z to undo
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="flex-1 w-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      {/* Stroke counter */}
      <AnimatePresence>
        {strokeCount > 0 && !isLaunching && (
          <motion.p
            className="absolute top-3 left-3 text-white/20 text-xs select-none pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {strokeCount} stroke{strokeCount !== 1 ? 's' : ''}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      <div className="flex gap-2 p-3 sm:p-4 border-t border-white/10">
        <button
          onClick={handleUndo}
          disabled={strokeCount === 0 || isLaunching}
          title="Undo (⌘Z)"
          className="px-3 py-2.5 text-xs sm:text-sm rounded border border-white/10
                     text-white/35 hover:text-white/70 hover:border-white/25
                     transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          Undo
        </button>

        <button
          onClick={handleClear}
          disabled={strokeCount === 0 || isLaunching}
          title="Clear (C)"
          className="px-3 py-2.5 text-xs sm:text-sm rounded border border-white/10
                     text-white/35 hover:text-white/70 hover:border-white/25
                     transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          Clear
        </button>

        <button
          onClick={handleLaunch}
          disabled={strokeCount === 0 || isLaunching}
          title="Launch (Space)"
          className="flex-1 py-2.5 text-xs sm:text-sm rounded font-medium
                     bg-white/8 border border-white/15 text-white/70
                     hover:bg-white/15 hover:border-white/35 hover:text-white
                     transition-colors disabled:opacity-20 disabled:cursor-not-allowed
                     active:scale-95"
        >
          {isLaunching ? 'Launching…' : 'Launch 🎆'}
        </button>
      </div>
    </div>
  )
})

export default DrawingCanvas
