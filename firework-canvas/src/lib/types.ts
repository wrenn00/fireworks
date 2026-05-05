export interface Point {
  x: number
  y: number
  t: number          // timestamp (ms, from performance.now())
  pressure?: number  // 0–1, undefined if device doesn't report it
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
  angle: number      // degrees, direction the stroke points
  speed: number      // pixels per ms
  curvature: number  // 0 = straight, 1 = very curved
  launchPoint: Point
  burstPoint: Point
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  alpha: number
  color: string
  size: number
  decay: number      // alpha reduction per frame
  gravity: number
}

export interface Firework {
  id: number
  particles: Particle[]
  alive: boolean
}

export interface DrawingControls {
  color: string
  lineWidth: number
}

// ── Firework blueprint ────────────────────────────────────────────────────────

export type FireworkPattern = 'sphere' | 'trail' | 'outline' | 'willow'

export interface ParticleVector {
  angle: number   // radians
  speed: number   // pixels per frame
  color: string
  life: number    // frames until fully faded (controls decay rate)
}

export interface FireworkBlueprint {
  launchPoint: { x: number; y: number }
  burstPoint: { x: number; y: number }
  particleVectors: ParticleVector[]
  pattern: FireworkPattern
  duration: number  // ms — how long the burst animation runs
}
