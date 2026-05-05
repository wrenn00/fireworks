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
      className="fixed bottom-5 left-1/2 -translate-x-1/2
                 flex items-center gap-4 px-5 py-3 rounded-2xl
                 select-none"
      style={{
        background: 'rgba(15,25,45,0.60)',
        border:     '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 50,
      }}
    >
      {/* Brush size */}
      <div className="flex items-center gap-2.5">
        <span className="text-white/35 text-[10px] uppercase tracking-widest">Size</span>
        <input
          type="range" min={8} max={36} value={brush}
          onChange={e => onBrushChange(Number(e.target.value))}
          className="w-20"
          style={{ accentColor: 'rgba(140,185,230,0.85)' }}
        />
        {/* Dot preview */}
        <div
          className="rounded-full bg-white/40 flex-shrink-0 transition-all"
          style={{
            width:  Math.max(6, Math.round(brush * 0.45)),
            height: Math.max(6, Math.round(brush * 0.45)),
          }}
        />
      </div>

      <div className="w-px h-5 bg-white/15" />

      {/* Background presets */}
      <div className="flex gap-2">
        {BACKGROUNDS.map(p => (
          <button
            key={p.key}
            onClick={() => onPreset(p)}
            title={p.label}
            className="w-6 h-6 rounded-full flex-shrink-0 transition-all hover:scale-110"
            style={{
              background: `linear-gradient(160deg, ${p.stops[0][1]}, ${p.stops[p.stops.length - 1][1]})`,
              boxShadow: preset.key === p.key
                ? '0 0 0 2px rgba(255,255,255,0.80)'
                : '0 0 0 1px rgba(255,255,255,0.15)',
            }}
          />
        ))}
      </div>

      <div className="w-px h-5 bg-white/15" />

      {/* Reset */}
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors text-xs"
        title="안개 초기화"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        Reset
      </button>

      {/* Save */}
      <button
        onClick={onSave}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors text-xs"
        title="PNG 저장"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Save
      </button>
    </div>
  )
}
