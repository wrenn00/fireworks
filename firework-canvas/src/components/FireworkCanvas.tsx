import { useRef, useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GIF from 'gif.js'
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url'
import type { Firework, FireworkBlueprint } from '../lib/types'
import { createFireworkFromBlueprint, tickFireworks, drawFireworks } from '../lib/fireworkEngine'

interface Props {
  blueprint: FireworkBlueprint | null
  onFinished: () => void
}

export default function FireworkCanvas({ blueprint, onFinished }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fireworksRef = useRef<Firework[]>([])
  const rafRef = useRef<number>(0)
  const finishedRef = useRef(false)

  // GIF capture
  const framesRef = useRef<ImageData[]>([])
  const capturingRef = useRef(false)
  const [gifState, setGifState] = useState<'idle' | 'encoding' | 'done'>('idle')
  const gifBlobRef = useRef<Blob | null>(null)

  // ── Canvas sizing ─────────────────────────────────────────────────────────

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
  }, [])

  useEffect(() => {
    resize()
    const observer = new ResizeObserver(resize)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [resize])

  // ── Launch when blueprint changes ─────────────────────────────────────────

  useEffect(() => {
    if (!blueprint) return
    finishedRef.current = false
    framesRef.current = []
    capturingRef.current = true
    setGifState('idle')
    gifBlobRef.current = null
    fireworksRef.current = [createFireworkFromBlueprint(blueprint)]
  }, [blueprint])

  // ── Animation + GIF frame capture ────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let framesSinceCapture = 0
    const CAPTURE_EVERY = 3  // capture 1 in 3 frames → ~20fps GIF

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (fireworksRef.current.length > 0) {
        fireworksRef.current = tickFireworks(fireworksRef.current)
        drawFireworks(ctx, fireworksRef.current)

        // Capture GIF frame every N ticks
        if (capturingRef.current) {
          framesSinceCapture++
          if (framesSinceCapture >= CAPTURE_EVERY) {
            framesSinceCapture = 0
            framesRef.current.push(
              ctx.getImageData(0, 0, canvas.width, canvas.height),
            )
          }
        }

        if (fireworksRef.current.length === 0 && !finishedRef.current) {
          finishedRef.current = true
          capturingRef.current = false
          onFinished()
        }
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── GIF encoding ──────────────────────────────────────────────────────────

  const handleSaveGif = useCallback(() => {
    if (gifBlobRef.current) {
      downloadBlob(gifBlobRef.current)
      return
    }

    const canvas = canvasRef.current
    const frames = framesRef.current
    if (!canvas || frames.length === 0) return

    setGifState('encoding')

    const gif = new GIF({
      workers: 2,
      quality: 8,
      width: canvas.width,
      height: canvas.height,
      workerScript: gifWorkerUrl,
      repeat: 0,
      background: '#000000',
    })

    // Reuse an offscreen canvas to convert ImageData → canvas frames
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

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* Save GIF button — appears after firework ends */}
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
