/** Minimal types for the fog-window system. No preset choices — single background. */

// ── Rain (background atmosphere) ──────────────────────────────────────────────

export interface RainStreak { x: number; y: number; len: number; speed: number; opacity: number }

export function generateRain(count: number, w: number, h: number): RainStreak[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w * 1.3, y: Math.random() * h,
    len: 6 + Math.random() * 18, speed: 5 + Math.random() * 8,
    opacity: 0.04 + Math.random() * 0.10,
  }))
}

export function stepRain(s: RainStreak[], w: number, h: number): void {
  for (const r of s) {
    r.y += r.speed; r.x -= r.speed * 0.14
    if (r.y > h + r.len) { r.y = -r.len; r.x = Math.random() * w * 1.3 }
  }
}

// ── Droplets ───────────────────────────────────────────────────────────────────

export interface Droplet {
  x:          number
  y:          number
  radius:     number
  isDripping: boolean
  vy:         number        // downward velocity px/frame
  driftPhase: number        // for sin-wave lateral drift
  totalDrift: number        // px fallen so far
  maxDrift:   number
  alpha:      number        // 0→1 fade-in
}

/**
 * Create a droplet near the edge of a brush stroke.
 * brushR = radius of the wipe brush at this position.
 */
export function createDroplet(cx: number, cy: number, brushR: number): Droplet {
  const angle = Math.random() * Math.PI * 2
  const dist  = brushR * (0.65 + Math.random() * 0.5)
  const isDripping = Math.random() < 0.12

  return {
    x:          cx + Math.cos(angle) * dist,
    y:          cy + Math.sin(angle) * dist,
    radius:     1.5 + Math.random() * 2.5,
    isDripping,
    vy:         isDripping ? 0.15 + Math.random() * 0.25 : 0,
    driftPhase: Math.random() * Math.PI * 2,
    totalDrift: 0,
    maxDrift:   isDripping ? 40 + Math.random() * 80 : 0,
    alpha:      0,
  }
}
