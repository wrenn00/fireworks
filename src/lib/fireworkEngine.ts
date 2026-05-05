import type {
  Firework, Particle, TrailPoint, Flash, WorldState,
  StrokeAnalysis, FireworkBlueprint, FireworkPattern,
} from './types'

let nextId = 0

// ── Colour palettes ───────────────────────────────────────────────────────────

const PALETTES = {
  vivid:  ['#FF1B6B', '#FF6B35', '#FFD93D', '#6BCB77', '#4D96FF', '#9B59FF', '#FF6BCB'],
  neon:   ['#00FFE5', '#FF00E5', '#FFFC00', '#00FF85', '#FF3D00', '#B800FF'],
  pastel: ['#FFB3C6', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF'],
  warm:   ['#FF6B35', '#F7931E', '#FFD23F', '#FF1B6B', '#FF8C42', '#EE4266'],
} as const

type PaletteName = keyof typeof PALETTES
const PALETTE_KEYS = Object.keys(PALETTES) as PaletteName[]

function buildColorSet(mainColor: string): { main: string; accents: string[] } {
  const palette = PALETTES[PALETTE_KEYS[Math.floor(Math.random() * PALETTE_KEYS.length)]]
  const shuffled = [...palette].sort(() => Math.random() - 0.5)
  return { main: mainColor, accents: shuffled.slice(0, 3) }
}

function pickColor(main: string, accents: string[]): string {
  return Math.random() < 0.70
    ? main
    : accents[Math.floor(Math.random() * accents.length)]
}

// ── Colour math ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hslToHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number) => {
    const tt = ((t % 1) + 1) % 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const r = Math.round(hue2rgb(h + 1 / 3) * 255)
  const g = Math.round(hue2rgb(h) * 255)
  const b = Math.round(hue2rgb(h - 1 / 3) * 255)
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/** Return the complementary colour (hue rotated 180°) */
function complementColor(hex: string): string {
  const [rr, gg, bb] = hexToRgb(hex).map(v => v / 255)
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return hex

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr)      h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else                 h = ((rr - gg) / d + 4) / 6

  return hslToHex((h + 0.5) % 1, s, l)
}

/** Pick a random accent from the palette instead of direct complement */
function secondaryColor(mainColor: string): string {
  // 50% chance to use true complement, 50% random palette accent
  if (Math.random() < 0.5) return complementColor(mainColor)
  const palette = PALETTES[PALETTE_KEYS[Math.floor(Math.random() * PALETTE_KEYS.length)]]
  return palette[Math.floor(Math.random() * palette.length)]
}

// ── Size / speed / life helpers ───────────────────────────────────────────────

function pickSize(): number {
  const r = Math.random()
  if (r < 0.20) return 3.5 + Math.random() * 1.5   // large  20 %: 3.5–5
  if (r < 0.70) return 1.8 + Math.random() * 1.2   // medium 50 %: 1.8–3
  return 0.5 + Math.random() * 1.0                  // small  30 %: 0.5–1.5
}

function pickSpeed(mult = 1): number {
  const raw = Math.random() < 0.80
    ? 8  + Math.random() * 6    // fast 80 %: 8–14
    : 2  + Math.random() * 3    // slow 20 %: 2–5
  return raw * mult
}

function pickLife(): number {
  return 100 + Math.floor(Math.random() * 80)   // 100–180 frames
}

function lifeAlpha(life: number, maxLife: number): number {
  const ratio = life / maxLife
  return ratio >= 0.30 ? 1 : ratio / 0.30
}

// ── Per-pattern gravity ───────────────────────────────────────────────────────

const GRAVITY: Record<FireworkPattern, number> = {
  sphere:  0.06,
  trail:   0.025,
  outline: 0.0,    // outline particles are position-controlled; no gravity applied
  willow:  0.13,
  arc:     0.045,
}

// ── Particle spawning ─────────────────────────────────────────────────────────

const SEED_RATE = 0.08          // 8% of main particles become secondary seeds
const SEED_DELAY_MIN = 24       // earliest secondary trigger (frames)
const SEED_DELAY_MAX = 48       // latest  (≈ 0.4–0.8 s at 60 fps)

function spawnParticle(
  x: number, y: number,
  angle: number,
  speedMult: number,
  color: string,
  gravity: number,
): Particle {
  const speed   = pickSpeed(speedMult)
  const maxLife = pickLife()
  const isSeed  = Math.random() < SEED_RATE
  const delay   = SEED_DELAY_MIN + Math.floor(Math.random() * (SEED_DELAY_MAX - SEED_DELAY_MIN))

  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    alpha: 1,
    color,
    size: pickSize(),
    gravity: gravity * (0.6 + Math.random() * 0.8),
    life: maxLife,
    maxLife,
    trail: [],
    decay: 0,
    secondaryAt: isSeed ? maxLife - delay : undefined,
  }
}

// ── Outline particle factory ──────────────────────────────────────────────────

/**
 * Spawn a particle that will lerp toward (targetX, targetY), arriving at the
 * 50% life mark, then glow in place until it fades.
 * Secondary sparks fire on arrival via secondaryAt.
 */
function spawnOutlineParticle(
  originX: number, originY: number,
  targetX: number, targetY: number,
  color: string,
): Particle {
  const maxLife = 120 + Math.floor(Math.random() * 60)  // 120–180 frames
  const arrivalLife = Math.floor(maxLife * OUTLINE_TRAVEL_FRAC)

  return {
    x: originX,
    y: originY,
    vx: 0, vy: 0,
    alpha: 1,
    color,
    size: 1.0 + Math.random() * 2.0,   // outline dots: modest size
    gravity: 0,
    life: maxLife,
    maxLife,
    trail: [],
    decay: 0,
    mode: 'outline' as const,
    originX, originY,
    targetX, targetY,
    // Fire a secondary micro-burst when the particle arrives at its target
    secondaryAt: arrivalLife + 2,
  }
}

// ── Secondary explosion ───────────────────────────────────────────────────────

function spawnSecondaryFirework(
  x: number, y: number,
  seedColor: string,
): Firework {
  const count   = 20 + Math.floor(Math.random() * 16)   // 20–35
  const color   = secondaryColor(seedColor)
  const gravity = 0.08

  const particles: Particle[] = Array.from({ length: count }, () => {
    const angle   = Math.random() * Math.PI * 2
    const speed   = 3 + Math.random() * 5               // 3–8 (moderate)
    const maxLife = 30 + Math.floor(Math.random() * 21) // 30–50 frames (fast fade)
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      color,
      size: 0.5 + Math.random() * 1.0,                  // 0.5–1.5 (small only)
      gravity: gravity * (0.7 + Math.random() * 0.6),
      life: maxLife,
      maxLife,
      trail: [],
      decay: 0,
      secondaryAt: undefined,
    }
  })

  return { id: nextId++, particles, alive: true }
}

// ── Legacy factory ────────────────────────────────────────────────────────────

function randomVariant(base: [number, number, number]): string {
  const shift = () => Math.floor((Math.random() - 0.5) * 60)
  const clamp = (v: number) => Math.min(255, Math.max(0, v))
  const [r, g, b] = base
  return `rgb(${clamp(r + shift())},${clamp(g + shift())},${clamp(b + shift())})`
}

export function createFirework(analysis: StrokeAnalysis, baseColor: string): Firework {
  const { burstPoint, length, speed, curvature } = analysis
  const { main, accents } = buildColorSet(baseColor)
  const count    = Math.min(600, Math.floor(250 + length * 0.3 + speed * 40))
  const gravity  = 0.06
  const rgb      = hexToRgb(baseColor)
  const particles: Particle[] = []

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    particles.push(spawnParticle(
      burstPoint.x, burstPoint.y,
      angle,
      0.8 + curvature * 0.8,
      Math.random() < 0.7 ? main : randomVariant(hexToRgb(accents[0] ?? baseColor) as [number,number,number]) || randomVariant(rgb),
      gravity,
    ))
  }
  return { id: nextId++, particles, alive: true }
}

// ── Blueprint-based factory ───────────────────────────────────────────────────

export function createFireworkFromBlueprint(blueprint: FireworkBlueprint): Firework {
  const { burstPoint, particleVectors, pattern } = blueprint
  const gravity   = GRAVITY[pattern]
  const hintColor = particleVectors[0]?.color ?? '#ffffff'
  const { main, accents } = buildColorSet(hintColor)

  // ── Outline: one physics-free particle per target point ─────────────────────
  if (pattern === 'outline') {
    // Use each vector's targetX/targetY; cycle if we want more density
    const density  = Math.min(3, Math.max(1, Math.floor(300 / Math.max(particleVectors.length, 1))))
    const particles: Particle[] = []

    for (const vec of particleVectors) {
      const tx = vec.targetX ?? burstPoint.x
      const ty = vec.targetY ?? burstPoint.y
      for (let d = 0; d < density; d++) {
        // slight position jitter so overlapping dots look like a glowing node
        const ox = burstPoint.x + (Math.random() - 0.5) * 4
        const oy = burstPoint.y + (Math.random() - 0.5) * 4
        particles.push(spawnOutlineParticle(ox, oy, tx, ty, pickColor(main, accents)))
      }
    }
    return { id: nextId++, particles, alive: true }
  }

  // ── All other patterns: physics-based particles ──────────────────────────────
  const scale = Math.min(1, Math.max(0, (particleVectors.length - 50) / 350))
  const count = Math.floor(250 + scale * 350)
  const particles: Particle[] = []

  for (let i = 0; i < count; i++) {
    const vec    = particleVectors[i % particleVectors.length]
    const angle  = vec.angle + (Math.random() - 0.5) * 0.12
    const speedN = Math.min(1, Math.max(0, (vec.speed - 1.5) / 6.5))
    particles.push(spawnParticle(
      burstPoint.x, burstPoint.y,
      angle,
      0.7 + speedN * 0.6,
      pickColor(main, accents),
      gravity,
    ))
  }
  return { id: nextId++, particles, alive: true }
}

// ── World-state factory ───────────────────────────────────────────────────────

/**
 * Create the initial WorldState for a blueprint launch.
 * Returns fireworks + flash + global glow ready for the first tick.
 */
export function createWorldState(blueprint: FireworkBlueprint): WorldState {
  const firework = createFireworkFromBlueprint(blueprint)
  const mainColor = firework.particles[0]?.color ?? '#ffffff'

  const flash: Flash = {
    x: blueprint.burstPoint.x,
    y: blueprint.burstPoint.y,
    radius: 80 + Math.random() * 70,   // 80–150 px
    alpha: 0.6,
    life: 9,                            // ≈ 0.15 s at 60 fps
    maxLife: 9,
    color: mainColor,
  }

  return {
    fireworks: [firework],
    flashes: [flash],
    globalGlowAlpha: 0.22,
  }
}

// ── Simulation ────────────────────────────────────────────────────────────────

const TRAIL_MAX      = 8
const AIR_RESISTANCE = 0.985

// Fraction of particle life used for the approach phase in outline mode
const OUTLINE_TRAVEL_FRAC = 0.50

function tickParticle(p: Particle): Particle | null {
  const newLife = p.life - 1
  if (newLife <= 0) return null

  // ── Outline mode: lerp toward target, then stay ─────────────────────────────
  if (
    p.mode === 'outline' &&
    p.targetX !== undefined && p.targetY !== undefined &&
    p.originX !== undefined && p.originY !== undefined
  ) {
    const elapsed = p.maxLife - p.life        // frames since spawn
    const travelFrames = p.maxLife * OUTLINE_TRAVEL_FRAC

    if (elapsed < travelFrames) {
      // Approaching: cubic ease-out lerp
      const t = elapsed / travelFrames
      const eased = 1 - (1 - t) ** 3
      return {
        ...p,
        x: p.originX + (p.targetX - p.originX) * eased,
        y: p.originY + (p.targetY - p.originY) * eased,
        vx: 0, vy: 0,
        life: newLife,
        alpha: lifeAlpha(newLife, p.maxLife),
        trail: [],   // no trail during approach (cleaner look)
      }
    }

    // Arrived: glow at the target point, then fade
    return {
      ...p,
      x: p.targetX,
      y: p.targetY,
      vx: 0, vy: 0,
      life: newLife,
      alpha: lifeAlpha(newLife, p.maxLife),
      trail: [],
    }
  }

  // ── Normal physics ───────────────────────────────────────────────────────────
  let trail: TrailPoint[] = p.trail
  if (p.size >= 1.8) {
    trail = [...p.trail, { x: p.x, y: p.y }]
    if (trail.length > TRAIL_MAX) trail = trail.slice(trail.length - TRAIL_MAX)
  }

  const vx = p.vx * AIR_RESISTANCE
  const vy = p.vy * AIR_RESISTANCE + p.gravity

  return {
    ...p,
    x: p.x + vx,
    y: p.y + vy,
    vx, vy,
    life: newLife,
    alpha: p.maxLife > 0
      ? lifeAlpha(newLife, p.maxLife)
      : Math.max(0, p.alpha - p.decay),
    trail,
  }
}

function tickFlash(f: Flash): Flash | null {
  const newLife = f.life - 1
  if (newLife <= 0) return null
  return { ...f, life: newLife, alpha: (newLife / f.maxLife) * 0.6 }
}

/**
 * Advance the world by one frame.
 * Handles particle physics, secondary explosion spawning, flash fade,
 * and global glow decay — all in one pass.
 */
export function tickWorld(world: WorldState): WorldState {
  const spawnedSecondary: Firework[] = []

  const fireworks = world.fireworks
    .map(fw => {
      const particles: Particle[] = []

      for (const p of fw.particles) {
        const ticked = tickParticle(p)
        if (!ticked) continue

        // Secondary explosion: trigger when life crosses secondaryAt
        if (
          p.secondaryAt !== undefined &&
          p.life >= p.secondaryAt &&
          ticked.life < p.secondaryAt
        ) {
          spawnedSecondary.push(spawnSecondaryFirework(p.x, p.y, p.color))
        }

        particles.push(ticked)
      }

      return { ...fw, particles, alive: particles.length > 0 }
    })
    .filter(fw => fw.alive)

  const flashes = world.flashes
    .map(tickFlash)
    .filter((f): f is Flash => f !== null)

  return {
    fireworks: [...fireworks, ...spawnedSecondary],
    flashes,
    globalGlowAlpha: world.globalGlowAlpha * 0.84,  // exponential decay ~15 frames
  }
}

/** Legacy shim — kept for code paths that haven't migrated to WorldState */
export function tickFireworks(fireworks: Firework[]): Firework[] {
  return tickWorld({ fireworks, flashes: [], globalGlowAlpha: 0 }).fireworks
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Draw the full world: global glow → flashes → particle trails → halos → cores.
 */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  canvasW: number,
  canvasH: number,
): void {
  // ── Global glow overlay (full-screen brightening at burst moment) ──────────
  if (world.globalGlowAlpha > 0.002) {
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = world.globalGlowAlpha
    ctx.shadowBlur = 0
    ctx.fillRect(0, 0, canvasW, canvasH)
    ctx.globalAlpha = 1
  }

  // ── Flashes (radial gradient at burst point) ──────────────────────────────
  for (const f of world.flashes) {
    if (f.alpha < 0.005) continue
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius)
    grad.addColorStop(0, hexWithAlpha(f.color, f.alpha))
    grad.addColorStop(0.4, hexWithAlpha(f.color, f.alpha * 0.35))
    grad.addColorStop(1, hexWithAlpha(f.color, 0))
    ctx.fillStyle = grad
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  if (world.fireworks.length === 0) return

  // ── Pass 1: trails ────────────────────────────────────────────────────────
  for (const fw of world.fireworks) {
    for (const p of fw.particles) {
      if (p.trail.length < 2) continue
      const len = p.trail.length
      for (let i = 0; i < len; i++) {
        const t = p.trail[i]
        const ratio = i / len
        ctx.globalAlpha = ratio * p.alpha * 0.45
        ctx.fillStyle = p.color
        ctx.shadowColor = p.color
        ctx.shadowBlur = p.size * ratio * 3
        ctx.beginPath()
        ctx.arc(t.x, t.y, Math.max(0.3, p.size * ratio * 0.65), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // ── Pass 2: glow halos ────────────────────────────────────────────────────
  for (const fw of world.fireworks) {
    for (const p of fw.particles) {
      ctx.globalAlpha = p.alpha * 0.30
      ctx.fillStyle = p.color
      ctx.shadowColor = p.color
      ctx.shadowBlur = p.size * 10
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Pass 3: bright cores ──────────────────────────────────────────────────
  for (const fw of world.fireworks) {
    for (const p of fw.particles) {
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      ctx.shadowColor = p.color
      ctx.shadowBlur = p.size * 4
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Reset
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
}

/** Legacy shim */
export function drawFireworks(ctx: CanvasRenderingContext2D, fireworks: Firework[]): void {
  drawWorld(ctx, { fireworks, flashes: [], globalGlowAlpha: 0 }, ctx.canvas.width, ctx.canvas.height)
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Convert a hex color + alpha 0-1 to a CSS rgba() string */
function hexWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
}
