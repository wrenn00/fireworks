/** Minimal floating toolbar: Size · Reset · Save only. No color or preset options. */

interface Props {
  brush:         number
  onBrushChange: (v: number) => void
  onReset:       () => void
  onSave:        () => void
}

export default function FogToolbar({ brush, onBrushChange, onReset, onSave }: Props) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2
                 flex items-center gap-5 px-6 py-3 rounded-2xl select-none"
      style={{
        background:          'rgba(12, 22, 40, 0.58)',
        border:              '1px solid rgba(255,255,255,0.13)',
        backdropFilter:      'blur(14px)',
        WebkitBackdropFilter:'blur(14px)',
        zIndex:              50,
      }}
    >
      {/* Brush size */}
      <div className="flex items-center gap-2.5">
        <span className="text-white/35 text-[10px] uppercase tracking-widest font-medium">Size</span>
        <input
          type="range" min={10} max={30} value={brush}
          onChange={e => onBrushChange(Number(e.target.value))}
          className="w-24"
          style={{ accentColor: 'rgba(140,185,230,0.9)' }}
        />
        {/* Live size preview dot */}
        <div
          className="rounded-full bg-white/35 flex-shrink-0 transition-all duration-100"
          style={{
            width:  Math.round(brush * 0.5),
            height: Math.round(brush * 0.5),
            minWidth: 6, minHeight: 6,
          }}
        />
      </div>

      <div className="w-px h-5 bg-white/15 flex-shrink-0" />

      {/* Reset */}
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/80
                   transition-colors text-xs"
        title="안개 초기화"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        Reset
      </button>

      {/* Save */}
      <button
        onClick={onSave}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/80
                   transition-colors text-xs"
        title="PNG 저장"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Save
      </button>
    </div>
  )
}
