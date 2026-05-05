import { BACKGROUNDS, type BackgroundPreset } from '../lib/fogEngine'

interface Props {
  brush:         number
  onBrushChange: (v: number) => void
  preset:        BackgroundPreset
  onPreset:      (p: BackgroundPreset) => void
  onReset:       () => void
  onSave:        () => void
}

export default function FogToolbar({ brush, onBrushChange, preset, onPreset, onReset, onSave }: Props) {
  return (
    <div
      className="absolute bottom-5 left-1/2 -translate-x-1/2
                 flex items-center gap-3 px-4 py-2.5 rounded-2xl
                 backdrop-blur-md select-none z-50"
      style={{ background: 'rgba(10,20,40,0.55)', border: '1px solid rgba(255,255,255,0.10)' }}
    >
      {/* Brush size */}
      <div className="flex items-center gap-2">
        <span className="text-white/35 text-[10px] tracking-widest uppercase">Size</span>
        <input
          type="range" min={8} max={38} value={brush}
          onChange={e => onBrushChange(Number(e.target.value))}
          className="w-20 accent-white/60"
          style={{ accentColor: 'rgba(150,190,230,0.8)' }}
        />
        {/* Visual size preview */}
        <div
          className="rounded-full bg-white/40 flex-shrink-0"
          style={{ width: Math.round(brush * 0.5), height: Math.round(brush * 0.5) }}
        />
      </div>

      <div className="w-px h-5 bg-white/15" />

      {/* Background preset swatches */}
      <div className="flex gap-1.5">
        {BACKGROUNDS.map(p => (
          <button
            key={p.key}
            onClick={() => onPreset(p)}
            title={p.label}
            className="w-5 h-5 rounded-full transition-transform hover:scale-110"
            style={{
              background: `linear-gradient(135deg, ${p.gradient[0]}, ${p.gradient[p.gradient.length - 1]})`,
              boxShadow: preset.key === p.key ? '0 0 0 2px rgba(255,255,255,0.7)' : 'none',
            }}
          />
        ))}
      </div>

      <div className="w-px h-5 bg-white/15" />

      {/* Reset */}
      <button
        onClick={onReset}
        title="Clear (reset fog)"
        className="text-white/35 hover:text-white/80 transition-colors text-xs
                   flex items-center gap-1 px-1"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        Reset
      </button>

      {/* Save */}
      <button
        onClick={onSave}
        title="Save as PNG"
        className="text-white/35 hover:text-white/80 transition-colors text-xs
                   flex items-center gap-1 px-1"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Save
      </button>
    </div>
  )
}
