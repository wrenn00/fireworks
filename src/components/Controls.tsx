import { useMemo } from 'react'
import type { DrawingControls } from '../lib/types'
import { generateVariations } from '../lib/colorUtils'

const PRESET_COLORS = [
  '#ffffff', '#ff4444', '#ff9900', '#ffff00',
  '#44ff44', '#44ddff', '#aa44ff', '#ff44aa',
]

export type AppMode = 'tap' | 'draw'

interface Props {
  controls: DrawingControls
  onChange: (controls: DrawingControls) => void
  appMode: AppMode
  onModeChange: (mode: AppMode) => void
}

export default function Controls({ controls, onChange, appMode, onModeChange }: Props) {
  const preview = useMemo(() => generateVariations(controls.color, 6), [controls.color])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5
                    bg-white/4 border-b border-white/8 select-none flex-shrink-0">

      {/* Mode toggle — Draw / Tap */}
      <div className="flex rounded border border-white/15 overflow-hidden flex-shrink-0">
        {(['tap', 'draw'] as AppMode[]).map(m => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`px-3 py-1 text-[11px] font-medium uppercase tracking-widest
                        transition-colors
                        ${appMode === m
                          ? 'bg-white/15 text-white/80'
                          : 'text-white/30 hover:text-white/60'}`}
          >
            {m === 'tap' ? '✦ Tap' : '✎ Draw'}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-white/12 flex-shrink-0 hidden sm:block" />

      {/* Color swatches */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange({ ...controls, color: c })}
            className="w-5 h-5 sm:w-6 sm:h-6 rounded-full transition-transform
                       hover:scale-110 focus:outline-none flex-shrink-0"
            style={{
              backgroundColor: c,
              boxShadow: controls.color === c ? `0 0 0 2px #fff` : 'none',
            }}
            aria-label={c}
          />
        ))}

        {/* Custom color picker */}
        <label
          className="relative w-5 h-5 sm:w-6 sm:h-6 rounded-full overflow-hidden
                     cursor-pointer border border-white/20 hover:scale-110
                     transition-transform flex-shrink-0 flex items-center justify-center"
          style={{ backgroundColor: controls.color }}
          title="Custom color"
        >
          <input
            type="color"
            value={controls.color}
            onChange={(e) => onChange({ ...controls, color: e.target.value })}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <span className="text-[9px] text-white/70 pointer-events-none z-10">+</span>
        </label>
      </div>

      {/* Color preview dots (ink firework: tap mode) */}
      {appMode === 'tap' && (
        <div className="flex items-center gap-0.5" title="Ink firework color preview">
          {preview.map((c, i) => (
            <div
              key={i}
              className="rounded-full flex-shrink-0"
              style={{ width: i === 0 ? 7 : 4, height: i === 0 ? 7 : 4, backgroundColor: c }}
            />
          ))}
        </div>
      )}

      {/* Width slider (draw mode only) */}
      {appMode === 'draw' && (
        <>
          <div className="hidden sm:block w-px h-4 bg-white/15 flex-shrink-0" />
          <div className="flex items-center gap-2">
            <span className="text-white/35 text-[10px] uppercase tracking-widest hidden sm:block">
              Width
            </span>
            <input
              type="range" min={1} max={20}
              value={controls.lineWidth}
              onChange={(e) => onChange({ ...controls, lineWidth: Number(e.target.value) })}
              className="w-20 sm:w-28 accent-white"
            />
            <span className="text-white/50 text-xs w-4 text-right">{controls.lineWidth}</span>
          </div>
        </>
      )}

      {/* Keyboard hint */}
      <div className="hidden md:flex flex-1 justify-end">
        <span className="text-white/12 text-[10px] tracking-wide">
          {appMode === 'tap' ? 'Tap · Hold longer = bigger' : 'Space · C · ⌘Z · M'}
        </span>
      </div>
    </div>
  )
}
