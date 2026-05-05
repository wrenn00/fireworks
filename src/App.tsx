import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DrawingCanvas from './components/DrawingCanvas'
import type { DrawingCanvasHandle } from './components/DrawingCanvas'
import FireworkCanvas from './components/FireworkCanvas'
import Controls from './components/Controls'
import { analyzeDrawing } from './lib/strokeAnalyzer'
import { playWhoosh, playBoom } from './lib/audioEngine'
import type { DrawingControls, Drawing, FireworkBlueprint } from './lib/types'

// ── Mode state machine ────────────────────────────────────────────────────────
//
//  drawing   → user draws freely
//  launching → 600ms glow animation, then transitions to firework view
//  firework  → fullscreen firework plays; auto-resets after AUTO_RESET_MS
//  resetting → countdown shown; DrawingCanvas remounts when timer expires

type Mode = 'drawing' | 'launching' | 'firework' | 'resetting'

const GLOW_MS       = 600    // must match DrawingCanvas glow duration
const AUTO_RESET_MS = 5000   // ms after firework finishes → return to drawing
const COUNTDOWN_SEC = 5

export default function App() {
  const [mode, setMode] = useState<Mode>('drawing')
  const [controls, setControls] = useState<DrawingControls>({
    color: '#ffffff',
    lineWidth: 3,
  })
  const [blueprint, setBlueprint] = useState<FireworkBlueprint | null>(null)
  const [drawingKey, setDrawingKey] = useState(0)
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC)

  const drawingRef = useRef<DrawingCanvasHandle>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Launch flow ───────────────────────────────────────────────────────────

  const handleLaunch = useCallback((drawing: Drawing) => {
    if (drawing.strokes.length === 0) return

    const intensity = Math.min(1, blueprint?.particleVectors.length ?? 0 / 300)
    playWhoosh(0.4 + intensity * 0.5)

    setMode('launching')

    setTimeout(() => {
      const bp = analyzeDrawing(drawing)
      const bpIntensity = Math.min(1, bp.particleVectors.length / 300)
      playBoom(0.35 + bpIntensity * 0.6)
      setBlueprint(bp)
      setMode('firework')
    }, GLOW_MS)
  }, [blueprint])

  // ── Firework finished — start auto-reset countdown ────────────────────────

  const handleFireworkFinished = useCallback(() => {
    setMode('resetting')
    setCountdown(COUNTDOWN_SEC)

    // Tick countdown each second
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1))
    }, 1000)

    // Auto-reset after full duration
    resetTimerRef.current = setTimeout(() => {
      clearInterval(countdownIntervalRef.current!)
      setDrawingKey((k) => k + 1)
      setBlueprint(null)
      setMode('drawing')
    }, AUTO_RESET_MS)
  }, [])

  // Manual "Draw again" — cancels the auto timer
  const handleDrawAgain = useCallback(() => {
    clearTimeout(resetTimerRef.current!)
    clearInterval(countdownIntervalRef.current!)
    setDrawingKey((k) => k + 1)
    setBlueprint(null)
    setMode('drawing')
  }, [])

  // Cleanup on unmount
  useEffect(() => () => {
    clearTimeout(resetTimerRef.current!)
    clearInterval(countdownIntervalRef.current!)
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't steal keys from inputs
      if ((e.target as HTMLElement).closest('input, textarea')) return

      if (mode === 'drawing' || mode === 'launching') {
        if (e.code === 'Space') {
          e.preventDefault()
          drawingRef.current?.launch()
        } else if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) {
          drawingRef.current?.clear()
        } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          drawingRef.current?.undo()
        }
      } else if (mode === 'resetting' || mode === 'firework') {
        // Any key in firework view returns to drawing
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault()
          handleDrawAgain()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, handleDrawAgain])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-full w-full overflow-hidden bg-black font-sans">

      {/* ── Drawing screen ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {(mode === 'drawing' || mode === 'launching') && (
          <motion.div
            key="drawing-screen"
            className="absolute inset-0 flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
          >
            <Controls controls={controls} onChange={setControls} />

            <div className="flex-1 min-h-0">
              <DrawingCanvas
                key={drawingKey}
                ref={drawingRef}
                color={controls.color}
                lineWidth={controls.lineWidth}
                isLaunching={mode === 'launching'}
                onStrokeComplete={() => {}}
                onLaunch={handleLaunch}
                onClear={() => {}}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Firework screen ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {(mode === 'firework' || mode === 'resetting') && (
          <motion.div
            key="firework-screen"
            className="absolute inset-0 bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <FireworkCanvas
              blueprint={blueprint}
              onFinished={handleFireworkFinished}
            />

            {/* Pattern badge */}
            {blueprint && mode === 'firework' && (
              <motion.span
                className="absolute top-4 left-1/2 -translate-x-1/2
                           text-white/20 text-[11px] tracking-[0.25em] uppercase select-none"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                {blueprint.pattern}
              </motion.span>
            )}

            {/* Auto-reset overlay */}
            <AnimatePresence>
              {mode === 'resetting' && (
                <motion.div
                  className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-10 gap-4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  {/* Countdown progress bar */}
                  <div className="w-32 h-px bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-white/40 rounded-full"
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: AUTO_RESET_MS / 1000, ease: 'linear' }}
                    />
                  </div>

                  <p className="text-white/25 text-xs tracking-widest">
                    returning in {countdown}s
                  </p>

                  <button
                    onClick={handleDrawAgain}
                    className="mt-1 px-5 py-2 text-xs rounded border border-white/15
                               text-white/50 hover:text-white/90 hover:border-white/35
                               transition-colors backdrop-blur-sm"
                  >
                    Draw again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
