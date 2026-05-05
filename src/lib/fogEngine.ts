/** Types and data for the foggy-window experience. */

// ── Background presets ─────────────────────────────────────────────────────────

export interface CityLight { x: number; y: number; r: number; color: string }

export interface BackgroundPreset {
  key:    string
  label:  string
  stops:  Array<[number, string]>   // [position 0-1, css color]
  lights: CityLight[]
  rain:   string                    // rgba for rain streaks
}

// Bright enough that wiped areas clearly show blue (not dark/black)
export const BACKGROUNDS: BackgroundPreset[] = [
  {
    key: 'night', label: '밤',
    stops:  [[0, '#1e3a5f'], [0.4, '#3a6b8f'], [0.7, '#5a8aa8'], [1, '#7ba0bd']],
    lights: [
      { x: 0.22, y: 0.72, r: 90,  color: 'rgba(255,210,110,0.40)' },
      { x: 0.65, y: 0.80, r: 70,  color: 'rgba(255,185,80,0.35)'  },
      { x: 0.85, y: 0.63, r: 55,  color: 'rgba(210,200,255,0.28)' },
      { x: 0.10, y: 0.85, r: 45,  color: 'rgba(180,220,255,0.22)' },
    ],
    rain: 'rgba(120,170,220,0.18)',
  },
  {
    key: 'sunset', label: '석양',
    stops:  [[0, '#22103a'], [0.35, '#8b3a5a'], [0.7, '#e07a40'], [1, '#f5c070']],
    lights: [
      { x: 0.50, y: 0.55, r: 170, color: 'rgba(255,150,50,0.42)'  },
      { x: 0.18, y: 0.78, r: 60,  color: 'rgba(255,120,80,0.35)'  },
      { x: 0.80, y: 0.75, r: 50,  color: 'rgba(255,200,100,0.30)' },
    ],
    rain: 'rgba(220,140,90,0.14)',
  },
  {
    key: 'dawn', label: '새벽',
    stops:  [[0, '#0d1828'], [0.4, '#1e3a5a'], [0.7, '#2e5a80'], [1, '#4a7a9a']],
    lights: [
      { x: 0.50, y: 0.88, r: 140, color: 'rgba(180,225,255,0.32)' },
      { x: 0.15, y: 0.70, r: 65,  color: 'rgba(255,215,150,0.30)' },
      { x: 0.80, y: 0.75, r: 50,  color: 'rgba(200,185,255,0.22)' },
    ],
    rain: 'rgba(140,195,225,0.15)',
  },
  {
    key: 'rain', label: '비',
    stops:  [[0, '#10181f'], [0.4, '#1a2c3a'], [0.7, '#244050'], [1, '#304e62']],
    lights: [
      { x: 0.35, y: 0.70, r: 80,  color: 'rgba(255,215,130,0.38)' },
      { x: 0.70, y: 0.78, r: 65,  color: 'rgba(200,235,255,0.28)' },
      { x: 0.88, y: 0.65, r: 45,  color: 'rgba(255,190,90,0.25)'  },
    ],
    rain: 'rgba(100,150,200,0.22)',
  },
]

// ── Droplets ───────────────────────────────────────────────────────────────────

export interface Droplet {
  x:          number
  y:          number
  radius:     number
  isDripping: boolean
  vy:         number        // downward velocity px/frame
  driftPhase: number        // for sinusoidal lateral drift
  totalDrift: number        // px fallen so far
  maxDrift:   number        // stop after this
  alpha:      number        // 0→1 fade-in on creation
}

export function createDroplet(x: number, y: number): Droplet {
  const isDripping = Math.random() < 0.15
  return {
    x: x + (Math.random() - 0.5) * 10,
    y: y + (Math.random() - 0.5) * 10,
    radius:     1.5 + Math.random() * 2.5,
    isDripping,
    vy:         isDripping ? 0.2 + Math.random() * 0.4 : 0,
    driftPhase: Math.random() * Math.PI * 2,
    totalDrift: 0,
    maxDrift:   isDripping ? 30 + Math.random() * 90 : 0,
    alpha:      0,   // starts invisible, fades in
  }
}

// ── Rain streaks ───────────────────────────────────────────────────────────────

export interface RainStreak {
  x: number; y: number
  len: number; speed: number; opacity: number
}

export function generateRain(count: number, w: number, h: number): RainStreak[] {
  return Array.from({ length: count }, () => ({
    x:       Math.random() * w * 1.3,
    y:       Math.random() * h,
    len:     8 + Math.random() * 22,
    speed:   5 + Math.random() * 7,
    opacity: 0.04 + Math.random() * 0.13,
  }))
}

export function stepRain(s: RainStreak[], w: number, h: number): void {
  for (const r of s) {
    r.y += r.speed
    r.x -= r.speed * 0.15
    if (r.y > h + r.len) { r.y = -r.len; r.x = Math.random() * w * 1.3 }
  }
}
