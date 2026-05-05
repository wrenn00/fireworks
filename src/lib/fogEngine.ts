/** Core types and data for the foggy-window experience. */

// ── Background presets ─────────────────────────────────────────────────────────

export interface CityLight { x: number; y: number; r: number; color: string }

export interface BackgroundPreset {
  key:       string
  label:     string
  gradient:  string[]   // top → bottom CSS colour stops
  rainColor: string
  fogColor:  string     // rgba for the fog fill
  lights:    CityLight[]
}

export const BACKGROUNDS: BackgroundPreset[] = [
  {
    key: 'night', label: '밤',
    gradient:  ['#060d1a', '#0e2540', '#1a3a5c'],
    rainColor: 'rgba(100,160,220,0.13)',
    fogColor:  'rgba(185,208,228,0.92)',
    lights: [
      { x: 0.25, y: 0.70, r: 90,  color: 'rgba(255,190,80,0.45)'  },
      { x: 0.60, y: 0.80, r: 70,  color: 'rgba(255,210,120,0.35)' },
      { x: 0.80, y: 0.65, r: 110, color: 'rgba(255,160,60,0.30)'  },
      { x: 0.10, y: 0.85, r: 55,  color: 'rgba(200,220,255,0.25)' },
    ],
  },
  {
    key: 'dusk', label: '황혼',
    gradient:  ['#180b28', '#4a2040', '#c07040'],
    rainColor: 'rgba(200,140,90,0.12)',
    fogColor:  'rgba(218,202,192,0.90)',
    lights: [
      { x: 0.50, y: 0.60, r: 160, color: 'rgba(255,140,40,0.40)'  },
      { x: 0.20, y: 0.75, r: 60,  color: 'rgba(255,200,100,0.30)' },
      { x: 0.75, y: 0.80, r: 50,  color: 'rgba(255,180,80,0.25)'  },
    ],
  },
  {
    key: 'dawn', label: '새벽',
    gradient:  ['#070912', '#121e38', '#1e3550'],
    rainColor: 'rgba(140,185,220,0.13)',
    fogColor:  'rgba(192,212,232,0.91)',
    lights: [
      { x: 0.50, y: 0.90, r: 120, color: 'rgba(180,220,255,0.25)' },
      { x: 0.15, y: 0.70, r: 70,  color: 'rgba(255,200,130,0.30)' },
      { x: 0.85, y: 0.75, r: 55,  color: 'rgba(200,180,255,0.20)' },
    ],
  },
  {
    key: 'rain', label: '비',
    gradient:  ['#070a10', '#0e1520', '#16222e'],
    rainColor: 'rgba(100,140,190,0.20)',
    fogColor:  'rgba(175,198,218,0.93)',
    lights: [
      { x: 0.35, y: 0.72, r: 80,  color: 'rgba(255,210,120,0.35)' },
      { x: 0.65, y: 0.80, r: 65,  color: 'rgba(255,180,80,0.28)'  },
      { x: 0.80, y: 0.65, r: 50,  color: 'rgba(200,230,255,0.20)' },
    ],
  },
]

// ── Rain streaks ───────────────────────────────────────────────────────────────

export interface RainStreak {
  x:       number
  y:       number
  length:  number   // px
  speed:   number   // px / frame
  opacity: number
}

export function generateRain(count: number, w: number, h: number): RainStreak[] {
  return Array.from({ length: count }, () => ({
    x:       Math.random() * w * 1.4,
    y:       Math.random() * h,
    length:  8 + Math.random() * 24,
    speed:   4 + Math.random() * 6,
    opacity: 0.05 + Math.random() * 0.14,
  }))
}

export function stepRain(streaks: RainStreak[], w: number, h: number): void {
  for (const s of streaks) {
    s.y += s.speed
    s.x -= s.speed * 0.18         // slight diagonal (right → left)
    if (s.y > h + s.length) {
      s.y = -s.length
      s.x = Math.random() * w * 1.4
    }
  }
}

// ── Droplets ───────────────────────────────────────────────────────────────────

export interface Droplet {
  x:              number
  y:              number
  radius:         number
  vy:             number    // current downward velocity
  dripping:       boolean
  fallen:         number    // px already fallen
  maxFall:        number    // stop after this many px
}

export function createDroplet(x: number, y: number): Droplet {
  const dripping = Math.random() < 0.11
  return {
    x: x + (Math.random() - 0.5) * 6,
    y: y + (Math.random() - 0.5) * 6,
    radius:  1.2 + Math.random() * 2.8,
    vy:      dripping ? 0.25 + Math.random() * 0.5 : 0,
    dripping,
    fallen:  0,
    maxFall: dripping ? 55 + Math.random() * 110 : 0,
  }
}

/**
 * Advance dripping droplets one frame.
 * Returns positions where the fog should be wiped (drip trail).
 */
export function stepDroplets(droplets: Droplet[]): Array<{ x: number; y: number }> {
  const wipePositions: Array<{ x: number; y: number }> = []
  for (const d of droplets) {
    if (!d.dripping || d.fallen >= d.maxFall) continue
    d.vy   = Math.min(d.vy * 1.012, 2.5)   // gentle acceleration, capped
    d.y   += d.vy
    d.fallen += d.vy
    wipePositions.push({ x: d.x, y: d.y })
  }
  return wipePositions
}

/** Remove droplets that have stopped dripping AND fallen off screen */
export function pruneDroplets(droplets: Droplet[], h: number): Droplet[] {
  return droplets.filter(d => d.y < h + 20)
}
