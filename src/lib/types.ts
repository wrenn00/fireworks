export interface Point {
  x: number
  y: number
  t: number
  pressure?: number
}

export interface Stroke {
  points: Point[]
  color: string
  width: number
}

export interface Drawing {
  strokes: Stroke[]
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
}

export interface StrokeAnalysis {
  length: number
  angle: number
  speed: number
  curvature: number
  launchPoint: Point
  burstPoint: Point
}

export interface TrailPoint {
  x: number
  y: number
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  alpha: number
  color: string
  size: number
  gravity: number
  life: number
  maxLife: number
  trail: TrailPoint[]
  decay: number
  secondaryAt?: number
  // ── Outline mode: position managed by lerp-to-target, not velocity physics ──
  mode?: 'outline'
  originX?: number
  originY?: number
  targetX?: number
  targetY?: number
}

export interface Firework {
  id: number
  particles: Particle[]
  alive: boolean
}

// ── World-level effects ───────────────────────────────────────────────────────

export interface Flash {
  x: number
  y: number
  radius: number
  alpha: number
  life: number
  maxLife: number
  color: string
}

export interface WorldState {
  fireworks: Firework[]
  flashes: Flash[]
  globalGlowAlpha: number
}

export interface DrawingControls {
  color: string
  lineWidth: number
}

// ── Firework blueprint ────────────────────────────────────────────────────────

export type FireworkPattern = 'sphere' | 'trail' | 'outline' | 'willow' | 'arc'

export interface ParticleVector {
  angle: number
  speed: number
  color: string
  life: number
  // For outline pattern: absolute canvas coordinates of the destination point.
  // When set, the engine ignores angle/speed and uses lerp-to-target instead.
  targetX?: number
  targetY?: number
}

export interface FireworkBlueprint {
  launchPoint: { x: number; y: number }
  burstPoint: { x: number; y: number }
  particleVectors: ParticleVector[]
  pattern: FireworkPattern
  duration: number
}

// ── Multi-stroke sequencing ───────────────────────────────────────────────────

export interface ScheduledBlueprint {
  blueprint: FireworkBlueprint
  delayMs: number  // time from sequence start to fire this blueprint
}

/**
 * Result of analysing a full Drawing.
 * `shots` = one blueprint per stroke, staggered 0.3–0.6 s apart.
 * `grandFinale` = 5–8 mini sphere bursts fired 0.5 s after the last stroke.
 */
export interface DrawingSequence {
  shots: ScheduledBlueprint[]
  grandFinale: ScheduledBlueprint[]
}
