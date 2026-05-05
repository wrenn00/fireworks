import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DrawingCanvas from './components/DrawingCanvas'
import type { DrawingCanvasHandle } from './components/DrawingCanvas'
import FireworkCanvas from './components/FireworkCanvas'
import { buildDrawingPlayback } from './lib/strokeAnalyzer'
import { playWhoosh } from './lib/audioEngine'
import type { Drawing, DrawingPlayback } from './lib/types'

type Mode = 'drawing' | 'launching' | 'firework' | 'resetting'

const GLOW_MS       = 500
const AUTO_RESET_MS = 4000
const COUNTDOWN_SEC = 4

export default function App() {
  const [mode, setMode]     = useState<Mode>('drawing')
  const [playback, setPlayback] = useState<DrawingPlayback | null>(null)
  const [drawingKey, setDrawingKey] = useState(0)
  const [countdown, setCountdown]   = useState(COUNTDOWN_SEC)

  const drawingRef           = useRef<DrawingCanvasHandle>(null)
  const resetTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Launch ────────────────────────────────────────────────────────────────

  const handleLaunch = useCallback((drawing: Drawing) => {
    if (!drawing.strokes.length) return
    playWhoosh(0.5)
    setMode('launching')
    setTimeout(() => {
      const pb = buildDrawingPlayback(drawing)
      setPlayback(pb)
      setMode('firework')
    }, GLOW_MS)
  }, [])

  // ── Firework finished ────────────────────────────────────────────────────

  const handleFireworkFinished = useCallback(() => {
    setMode('resetting')
    setCountdown(COUNTDOWN_SEC)
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)
    resetTimerRef.current = setTimeout(() => {
      clearInterval(countdownIntervalRef.current!)
      setDrawingKey(k => k + 1)
      setPlayback(null)
      setMode('drawing')
    }, AUTO_RESET_MS)
  }, [])

  const handleDrawAgain = useCallback(() => {
    clearTimeout(resetTimerRef.current!)
    clearInterval(countdownIntervalRef.current!)
    setDrawingKey(k => k + 1)
    setPlayback(null)
    setMode('drawing')
  }, [])

  useEffect(() => () => {
    clearTimeout(resetTimerRef.current!)
    clearInterval(countdownIntervalRef.current!)
  }, [])

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input')) return
      if ((mode === 'drawing' || mode === 'launching') && e.code === 'Space') {
        e.preventDefault(); drawingRef.current?.launch()
      }
      if ((mode === 'drawing' || mode === 'launching') && e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) {
        drawingRef.current?.clear()
      }
      if ((mode === 'drawing' || mode === 'launching') && e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); drawingRef.current?.undo()
      }
      if ((mode === 'firework' || mode === 'resetting') && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault(); handleDrawAgain()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, handleDrawAgain])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full w-full bg-black overflow-hidden font-sans">

      {/* Drawing screen */}
      <AnimatePresence>
        {(mode === 'drawing' || mode === 'launching') && (
          <motion.div
            key="draw"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.5 }}
          >
            <DrawingCanvas
              key={drawingKey}
              ref={drawingRef}
              color="#ffffff"
              lineWidth={2}
              isLaunching={mode === 'launching'}
              onStrokeComplete={() => {}}
              onLaunch={handleLaunch}
              onClear={() => {}}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Firework screen */}
      <AnimatePresence>
        {(mode === 'firework' || mode === 'resetting') && (
          <motion.div
            key="firework"
            className="absolute inset-0 bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <FireworkCanvas playback={playback} onFinished={handleFireworkFinished} />

            <AnimatePresence>
              {mode === 'resetting' && (
                <motion.div
                  className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <p className="text-white/25 text-xs tracking-widest">
                    returning in {countdown}s
                  </p>
                  <button
                    onClick={handleDrawAgain}
                    className="px-5 py-2 text-xs border border-white/15
                               text-white/45 hover:text-white/85 hover:border-white/35
                               rounded transition-colors tracking-widest"
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
