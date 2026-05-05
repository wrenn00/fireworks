import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { setMuted, isMuted } from '../lib/audioEngine'

export default function MuteButton() {
  const [muted, setMutedState] = useState(isMuted)

  const toggle = useCallback(() => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }, [muted])

  return (
    <motion.button
      onClick={toggle}
      title={muted ? 'Unmute (M)' : 'Mute (M)'}
      className="flex items-center justify-center w-8 h-8 rounded-full
                 text-white/30 hover:text-white/70 transition-colors
                 focus:outline-none select-none"
      whileTap={{ scale: 0.88 }}
    >
      {muted ? <IconMuted /> : <IconSound />}
    </motion.button>
  )
}

function IconSound() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 5.5v5l3.5-2.5v-2L3 5.5z" opacity=".5" />
      <path d="M6.5 4 10 1v14L6.5 12H3V4h3.5z" />
      <path d="M12 5a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.2"
            fill="none" strokeLinecap="round" />
      <path d="M13.5 3a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.2"
            fill="none" strokeLinecap="round" opacity=".5" />
    </svg>
  )
}

function IconMuted() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.5 4 10 1v14L6.5 12H3V4h3.5z" opacity=".5" />
      <line x1="12" y1="5" x2="15.5" y2="11" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" />
      <line x1="15.5" y1="5" x2="12" y2="11" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
