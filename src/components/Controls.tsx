import { useMemo } from 'react'
import type { DrawingControls } from '../lib/types'
import { generateVariations } from '../lib/colorUtils'

const PRESET_COLORS = [
  '#ffffff', '#ff4444', '#ff9900', '#ffff00',
  '#44ff44', '#44ddff', '#aa44ff', '#ff44aa',
]

interface Props {
  controls: DrawingControls
  onChange: (controls: DrawingControls) => void
}

export default function Controls({ controls, onChange }: Props) {
  // Deterministic preview of actual firework colors (stable per color choice)
  const preview = useMemo(() => generateVariations(controls.color, 6), [controls.color])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5
                    bg-white/4 border-b border-white/8 select-none">

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

      {/* Firework color preview — shows actual 70/20/10 distribution */}
      <div
        className="flex items-center gap-0.5"
        title="Firework color preview"
      >
        {preview.map((c, i) => (
          <div
            key={i}
            className="rounded-full flex-shrink-0"
            style={{
              width:  i === 0 ? 8 : 5,   // main color slightly larger
              height: i === 0 ? 8 : 5,
              backgroundColor: c,
              boxShadow: `0 0 ${i === 0 ? 5 : 3}px 1px ${c}88`,
            }}
          />
        ))}
      </div>

      <div className="hidden sm:block w-px h-4 bg-white/15 flex-shrink-0" />

      {/* Width slider */}
      <div className="flex items-center gap-2">
        <span className="text-white/35 text-[10px] uppercase tracking-widest hidden sm:block">
          Width
        </span>
        <input
          type="range"
          min={1}
          max={20}
          value={controls.lineWidth}
          onChange={(e) => onChange({ ...controls, lineWidth: Number(e.target.value) })}
          className="w-20 sm:w-28 accent-white"
        />
        <span className="text-white/50 text-xs w-4 text-right">{controls.lineWidth}</span>
      </div>

      {/* Keyboard hint — desktop only */}
      <div className="hidden md:flex flex-1 justify-end">
        <span className="text-white/15 text-[10px] tracking-wide">
          Space · C · ⌘Z · M
        </span>
      </div>
    </div>
  )
}
