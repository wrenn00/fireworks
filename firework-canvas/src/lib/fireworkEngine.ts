import type { Firework, Particle, StrokeAnalysis, FireworkBlueprint, FireworkPattern } from './types'

let nextId = 0

// ── Legacy helpers (kept for analyzeStroke path) ──────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function randomVariant(base: [number, number, number]): string {
  const shift = () => Math.floor((Math.random() - 0.5) * 60)
  const clamp = (v: number) => Math.min(255, Math.max(0, v))
  const [r, g, b] = base
  return `rgb(${clamp(r + shift())},${clamp(g + shift())},${clamp(b + shift())})`
}

export function createFirework(analysis: StrokeAnalysis, baseColor: string): Firework {
  const { burstPoint, length, speed, curvature } = analysis
  const rgb = hexToRgb(baseColor)
  const count = Math.floor(60 + length * 0.3 + speed * 40)
  const particles: Particle[] = []

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const spreadFactor = 0.8 + curvature * 0.8
    const v = (1.5 + Math.random() * 3.5) * spreadFactor
    particles.push({
      x: burstPoint.x, y: burstPoint.y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      alpha: 1,
      color: randomVariant(rgb),
      size: 1.5 + Math.random() * 2,
      decay: 0.012 + Math.random() * 0.01,
      gravity: 0.05 + Math.random() * 0.03,
    })
  }
  return { id: nextId++, particles, alive: true }
}

// ── Blueprint-based factory ───────────────────────────────────────────────────

/** Per-pattern gravity multiplier — willow drapes heavily, trail barely falls */
const GRAVITY: Record<FireworkPattern, number> = {
  sphere:  0.06,
  trail:   0.02,
  outline: 0.05,
  willow:  0.14,
}

/**
 * Spawn a Firework from a fully-analysed FireworkBlueprint.
 * The blueprint already contains per-particle angle/speed/color/life, so this
 * function is pure geometry — no random shape decisions here.
 */
export function createFireworkFromBlueprint(blueprint: FireworkBlueprint): Firework {
  const { burstPoint, particleVectors, pattern } = blueprint
  const gravity = GRAVITY[pattern]

  const particles: Particle[] = particleVectors.map(({ angle, speed, color, life }) => {
    // Small jitter so identical blueprints don't look robotic
    const jitterA = angle + (Math.random() - 0.5) * 0.08
    const jitterS = speed * (0.85 + Math.random() * 0.3)

    return {
      x: burstPoint.x,
      y: burstPoint.y,
      vx: Math.cos(jitterA) * jitterS,
      vy: Math.sin(jitterA) * jitterS,
      alpha: 1,
      color,
      size: 1.2 + Math.random() * 2.2,
      decay: 1 / Math.max(life, 1),
      gravity,
    }
  })

  return { id: nextId++, particles, alive: true }
}

// ── Simulation ────────────────────────────────────────────────────────────────

export function tickFireworks(fireworks: Firework[]): Firework[] {
  return fireworks
    .map((fw) => {
      const particles = fw.particles
        .map((p) => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vx: p.vx * 0.97,
          vy: p.vy * 0.97 + p.gravity,
          alpha: p.alpha - p.decay,
        }))
        .filter((p) => p.alpha > 0.01)
      return { ...fw, particles, alive: particles.length > 0 }
    })
    .filter((fw) => fw.alive)
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export function drawFireworks(
  ctx: CanvasRenderingContext2D,
  fireworks: Firework[],
): void {
  for (const fw of fireworks) {
    for (const p of fw.particles) {
      ctx.save()
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      // Glow: shadow matches particle colour
      ctx.shadowColor = p.color
      ctx.shadowBlur = p.size * 2.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}
