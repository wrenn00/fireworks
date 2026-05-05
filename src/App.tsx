import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DrawingCanvas from './components/DrawingCanvas'
import type { DrawingCanvasHandle } from './components/DrawingCanvas'
import FireworkCanvas from './components/FireworkCanvas'
import TapFireworkCanvas from './components/TapFireworkCanvas'
import Controls, { type AppMode } from './components/Controls'
import MuteButton from './components/MuteButton'
import { buildDrawingPlayback } from './lib/strokeAnalyzer'
import { playWhoosh, setMuted, isMuted } from './lib/audioEngine'
import type { DrawingControls, Drawing, DrawingPlayback } from './lib/types'

// ── Draw-mode state machine ───────────────────────────────────────────────────
type DrawMode = 'drawing' | 'launching' | 'firework' | 'resetting'

const GLOW_MS       = 600
const AUTO_RESET_MS = 5000
const COUNTDOWN_SEC = 5

export default function App() {
  const [appMode, setAppMode]   = useState<AppMode>('tap')   // default: tap for immediate fun
  const [drawMode, setDrawMode] = useState<DrawMode>('drawing')
  const [controls, setControls] = useState<DrawingControls>({ color: '#ffffff', lineWidth: 3 })
  const [playback, setPlayback] = useState<DrawingPlayback | null>(null)
  const [drawingKey, setDrawingKey] = useState(0)
  const [countdown, setCountdown]   = useState(COUNTDOWN_SEC)

  const drawingRef           = useRef<DrawingCanvasHandle>(null)
  const resetTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Draw mode: launch ─────────────────────────────────────────────────────

  const handleLaunch = useCallback((drawing: Drawing) => {
    if (drawing.strokes.length === 0) return
    playWhoosh(0.5 + Math.min(0.4, drawing.strokes.length * 0.1))
    setDrawMode('launching')
    setTimeout(() => {
      const pb = buildDrawingPlayback(drawing)
      setPlayback(pb)
      setDrawMode('firework')
    }, GLOW_MS)
  }, [])

  // ── Draw mode: firework finished ──────────────────────────────────────────

  const handleFireworkFinished = useCallback(() => {
    setDrawMode('resetting')
    setCountdown(COUNTDOWN_SEC)
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)
    resetTimerRef.current = setTimeout(() => {
      clearInterval(countdownIntervalRef.current!)
      setDrawingKey(k => k + 1)
      setPlayback(null)
      setDrawMode('drawing')
    }, AUTO_RESET_MS)
  }, [])

  const handleDrawAgain = useCallback(() => {
    clearTimeout(resetTimerRef.current!)
    clearInterval(countdownIntervalRef.current!)
    setDrawingKey(k => k + 1)
    setPlayback(null)
    setDrawMode('drawing')
  }, [])

  // Reset draw state when switching to tap mode
  const handleModeChange = useCallback((m: AppMode) => {
    if (m === 'tap') {
      clearTimeout(resetTimerRef.current!)
      clearInterval(countdownIntervalRef.current!)
      setPlayback(null)
      setDrawingKey(k => k + 1)
      setDrawMode('drawing')
    }
    setAppMode(m)
  }, [])

  useEffect(() => () => {
    clearTimeout(resetTimerRef.current!)
    clearInterval(countdownIntervalRef.current!)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return

      if (e.code === 'KeyM' && !e.metaKey && !e.ctrlKey) { setMuted(!isMuted()); return }

      // Tab / T — toggle between tap and draw
      if (e.code === 'KeyT' && !e.metaKey && !e.ctrlKey) {
        handleModeChange(appMode === 'tap' ? 'draw' : 'tap'); return
      }

      if (appMode === 'draw') {
        if (drawMode === 'drawing' || drawMode === 'launching') {
          if (e.code === 'Space')                                { e.preventDefault(); drawingRef.current?.launch() }
          else if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) drawingRef.current?.clear()
          else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); drawingRef.current?.undo() }
        } else if (drawMode === 'resetting' || drawMode === 'firework') {
          if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); handleDrawAgain() }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [appMode, drawMode, handleDrawAgain, handleModeChange])

  // ── Render ─────────────────────────────────────────────────────────────────
  //
  // Layout:  Controls bar (always) → content area
  // In draw-firework state the Controls is hidden (fullscreen firework)

  const showControls = !(appMode === 'draw' && (drawMode === 'firework' || drawMode === 'resetting'))

  return (
    <div className="h-full w-full flex flex-col bg-black font-sans overflow-hidden">

      {/* Controls — always on top, hidden during firework playback */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            key="controls"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="flex-shrink-0 z-40"
          >
            <Controls
              controls={controls}
              onChange={setControls}
              appMode={appMode}
              onModeChange={handleModeChange}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content area */}
      <div className="relative flex-1 min-h-0 overflow-hidden">

        {/* Mute button */}
        <div className="absolute top-2 right-3 z-50"><MuteButton /></div>

        {/* ── TAP MODE ── */}
        <AnimatePresence>
          {appMode === 'tap' && (
            <motion.div
              key="tap-screen"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <TapFireworkCanvas color={controls.color} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── DRAW MODE: drawing ── */}
        <AnimatePresence>
          {appMode === 'draw' && (drawMode === 'drawing' || drawMode === 'launching') && (
            <motion.div
              key="draw-screen"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            >
              <DrawingCanvas
                key={drawingKey}
                ref={drawingRef}
                color={controls.color}
                lineWidth={controls.lineWidth}
                isLaunching={drawMode === 'launching'}
                onStrokeComplete={() => {}}
                onLaunch={handleLaunch}
                onClear={() => {}}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── DRAW MODE: firework playback ── */}
        <AnimatePresence>
          {appMode === 'draw' && (drawMode === 'firework' || drawMode === 'resetting') && (
            <motion.div
              key="firework-screen"
              className="absolute inset-0 bg-black"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <FireworkCanvas playback={playback} onFinished={handleFireworkFinished} />

              <AnimatePresence>
                {drawMode === 'resetting' && (
                  <motion.div
                    className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-10 gap-4"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                  >
                    <div className="w-32 h-px bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-white/40 rounded-full"
                        initial={{ width: '100%' }}
                        animate={{ width: '0%' }}
                        transition={{ duration: AUTO_RESET_MS / 1000, ease: 'linear' }}
                      />
                    </div>
                    <p className="text-white/25 text-xs tracking-widest">returning in {countdown}s</p>
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
    </div>
  )
}
