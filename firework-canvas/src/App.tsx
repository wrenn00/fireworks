import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DrawingCanvas from './components/DrawingCanvas'
import FireworkCanvas from './components/FireworkCanvas'
import Controls from './components/Controls'
import { analyzeDrawing } from './lib/strokeAnalyzer'
import type { DrawingControls, Drawing, FireworkBlueprint } from './lib/types'

// ── App modes ─────────────────────────────────────────────────────────────────
//
//  drawing   → user is drawing on the canvas
//  launching → glow animation plays (600 ms), then transitions to firework
//  firework  → fullscreen firework canvas shown until all particles die
//  resetting → brief pause before returning to drawing mode

type Mode = 'drawing' | 'launching' | 'firework' | 'resetting'

const GLOW_DURATION = 600   // ms — matches DrawingCanvas glow animation
const RESET_DELAY   = 1200  // ms — how long "Draw again" overlay lingers

export default function App() {
  const [mode, setMode] = useState<Mode>('drawing')
  const [controls, setControls] = useState<DrawingControls>({
    color: '#ffffff',
    lineWidth: 3,
  })
  const [blueprint, setBlueprint] = useState<FireworkBlueprint | null>(null)
  const [drawingKey, setDrawingKey] = useState(0)   // remounts DrawingCanvas to reset it

  // Called by DrawingCanvas when the user clicks Launch
  const handleLaunch = useCallback((drawing: Drawing) => {
    if (drawing.strokes.length === 0) return

    // 1. Enter launching mode — triggers glow animation in DrawingCanvas
    setMode('launching')

    // 2. After glow completes, analyse the drawing and switch to firework view
    setTimeout(() => {
      const bp = analyzeDrawing(drawing)

      // Map burst point from drawing-canvas space to screen space.
      // DrawingCanvas occupies the full viewport in 'launching' mode already,
      // so coordinates are already in screen space — no transform needed.
      setBlueprint(bp)
      setMode('firework')
    }, GLOW_DURATION)
  }, [])

  // Called by FireworkCanvas when all particles have faded
  const handleFireworkFinished = useCallback(() => {
    setMode('resetting')
    setTimeout(() => {
      // Remount DrawingCanvas so it starts fresh
      setDrawingKey(k => k + 1)
      setBlueprint(null)
      setMode('drawing')
    }, RESET_DELAY)
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden bg-black font-sans">

      {/* ── Drawing mode ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(mode === 'drawing' || mode === 'launching') && (
          <motion.div
            key="drawing-screen"
            className="absolute inset-0 flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.06 }}
            transition={{ duration: 0.5, ease: 'easeIn' }}
          >
            {/* Controls bar */}
            <Controls
              controls={controls}
              onChange={setControls}
            />

            {/* Canvas fills remaining space */}
            <div className="flex-1 min-h-0">
              <DrawingCanvas
                key={drawingKey}
                color={controls.color}
                lineWidth={controls.lineWidth}
                isLaunching={mode === 'launching'}
                onStrokeComplete={() => {}}   // no per-stroke preview needed
                onLaunch={handleLaunch}
                onClear={() => {}}            // internal clear is enough
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Firework mode ──────────────────────────────────────────────────── */}
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
                className="absolute top-4 left-1/2 -translate-x-1/2 text-white/25 text-xs tracking-widest uppercase select-none"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {blueprint.pattern}
              </motion.span>
            )}

            {/* "Draw again" prompt appears after firework fades */}
            <AnimatePresence>
              {mode === 'resetting' && (
                <motion.div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <p className="text-white/40 text-sm tracking-wide">Draw again</p>
                  {/* Minimal spinner */}
                  <motion.div
                    className="w-5 h-5 rounded-full border border-white/20 border-t-white/60"
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
