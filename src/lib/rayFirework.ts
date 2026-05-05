/**
 * Monochrome ray-based firework engine.
 * Everything is white on black. No colour system.
 *
 * One firework = core flash + light rays + sparkles + falling embers.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ray {
  angle:       number   // radians
  maxLength:   number   // px
  wobblePhase: number   // sin phase for micro-tremor
}

interface Sparkle {
  angle: number         // direction from centre
  dist:  number         // 0–1, fraction of ray length
  size:  number         // 1–2.5 px
  phase: number         // sin flicker phase
  speed: number         // flicker speed
}

interface Ember {
  x:    number; y:    number
  vx:   number; vy:   number
  r:    number          // radius px
  born: number          // perf.now()
  life: number          // ms
}

export interface RayFirework {
  id:             number
  cx:             number; cy: number
  rays:           Ray[]
  sparkles:       Sparkle[]
  embers:         Ember[]
  startTime:      number
  maxRayLen:      number
  embersSpawned:  boolean
}

// ── Factory ───────────────────────────────────────────────────────────────────

let nextId = 0

export function createRayFirework(
  cx: number, cy: number,
  screenMin: number,          // Math.min(width, height)
): RayFirework {
  const rayCount  = 30 + Math.floor(Math.random() * 31)    // 30–60
  const maxRayLen = screenMin * (0.14 + Math.random() * 0.16) // 14–30%

  const rays: Ray[] = Array.from({ length: rayCount }, () => ({
    angle:       Math.random() * Math.PI * 2,
    maxLength:   maxRayLen * (0.65 + Math.random() * 0.35),
    wobblePhase: Math.random() * Math.PI * 2,
  }))

  const sparkles: Sparkle[] = Array.from({ length: 60 + Math.floor(Math.random() * 41) }, () => ({
    angle: Math.random() * Math.PI * 2,
    dist:  0.15 + Math.random() * 0.75,
    size:  1.0  + Math.random() * 1.5,
    phase: Math.random() * Math.PI * 2,
    speed: 0.003 + Math.random() * 0.004,
  }))

  return {
    id: nextId++, cx, cy,
    rays, sparkles, embers: [],
    startTime:     performance.now(),
    maxRayLen,
    embersSpawned: false,
  }
}

// ── Draw + update ─────────────────────────────────────────────────────────────

const GROW_MS  = 400    // rays grow to full length
const FADE_MS  = 1100   // rays fade after growing
const CORE_MS  = 220    // core flash duration
const TOTAL_MS = GROW_MS + FADE_MS   // 1500 ms

/** Draw one firework frame. Mutates embers (physics). Returns false when done. */
export function drawRayFirework(
  ctx: CanvasRenderingContext2D,
  fw:  RayFirework,
  now: number,
): boolean {
  const elapsed = now - fw.startTime
  if (elapsed > TOTAL_MS + 1200) return false    // all done

  // ── Spawn embers at 800 ms ────────────────────────────────────────────────
  if (!fw.embersSpawned && elapsed > 800) {
    fw.embersSpawned = true
    const count = 20 + Math.floor(Math.random() * 21)
    for (let i = 0; i < count; i++) {
      const ray  = fw.rays[i % fw.rays.length]
      const frac = 0.45 + Math.random() * 0.55
      const ex   = fw.cx + Math.cos(ray.angle) * ray.maxLength * frac
      const ey   = fw.cy + Math.sin(ray.angle) * ray.maxLength * frac
      const spd  = 0.3 + Math.random() * 0.8
      const ang  = ray.angle + (Math.random() - 0.5) * 0.6
      fw.embers.push({
        x: ex, y: ey,
        vx: Math.cos(ang) * spd * 0.3,
        vy: Math.sin(ang) * spd * 0.3,
        r:  0.5 + Math.random(),
        born: now,
        life: 700 + Math.random() * 700,
      })
    }
  }

  // ── Ray animation ─────────────────────────────────────────────────────────
  const rawLife  = Math.min(1, elapsed / GROW_MS)
  const eased    = 1 - (1 - rawLife) ** 2            // easeOut growth
  const rayAlpha = Math.max(0, 1 - Math.max(0, elapsed - GROW_MS) / FADE_MS)

  if (rayAlpha > 0.01) {
    ctx.lineWidth = 0.6
    ctx.lineCap   = 'round'

    for (const ray of fw.rays) {
      const wobble = Math.sin(now * 0.003 + ray.wobblePhase) * 0.008
      const ang    = ray.angle + wobble
      const len    = ray.maxLength * eased
      const ex     = fw.cx + Math.cos(ang) * len
      const ey     = fw.cy + Math.sin(ang) * len

      const g = ctx.createLinearGradient(fw.cx, fw.cy, ex, ey)
      g.addColorStop(0,    `rgba(255,255,255,${(0.9  * rayAlpha).toFixed(3)})`)
      g.addColorStop(0.65, `rgba(255,255,255,${(0.35 * rayAlpha).toFixed(3)})`)
      g.addColorStop(1,    'rgba(255,255,255,0)')

      ctx.strokeStyle = g
      ctx.shadowBlur  = 2
      ctx.shadowColor = '#fff'
      ctx.beginPath(); ctx.moveTo(fw.cx, fw.cy); ctx.lineTo(ex, ey); ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  // ── Core flash ────────────────────────────────────────────────────────────
  if (elapsed < CORE_MS) {
    const ca = Math.max(0, 1 - elapsed / CORE_MS)
    const cr = 4 + Math.random() * 4
    ctx.save()
    ctx.globalAlpha = ca
    ctx.fillStyle   = '#fff'
    ctx.shadowBlur  = 28
    ctx.shadowColor = '#fff'
    ctx.beginPath(); ctx.arc(fw.cx, fw.cy, cr, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // ── Sparkles ──────────────────────────────────────────────────────────────
  if (elapsed > 150 && rayAlpha > 0.01) {
    for (const s of fw.sparkles) {
      const sa = (0.3 + 0.7 * Math.abs(Math.sin(now * s.speed + s.phase))) * rayAlpha
      if (sa < 0.06) continue

      const dist = fw.maxRayLen * s.dist * eased
      const sx   = fw.cx + Math.cos(s.angle) * dist
      const sy   = fw.cy + Math.sin(s.angle) * dist

      ctx.save()
      ctx.globalAlpha = sa
      ctx.fillStyle   = '#fff'
      ctx.shadowBlur  = s.size * 5
      ctx.shadowColor = '#fff'
      // Cross shape
      const sz = s.size
      ctx.fillRect(sx - sz,  sy - 0.35, sz * 2, 0.7)
      ctx.fillRect(sx - 0.35, sy - sz,  0.7, sz * 2)
      ctx.restore()
    }
  }

  // ── Embers ────────────────────────────────────────────────────────────────
  for (const e of fw.embers) {
    const age = now - e.born
    if (age > e.life) continue
    // Physics
    e.vy += 0.05
    e.x  += e.vx
    e.y  += e.vy

    const ea = 0.85 * Math.max(0, 1 - age / e.life)
    if (ea < 0.02) continue

    ctx.save()
    ctx.globalAlpha = ea
    ctx.fillStyle   = '#fff'
    ctx.shadowBlur  = e.r * 4
    ctx.shadowColor = '#fff'
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  return true
}

export function isRayFireworkDone(fw: RayFirework, now: number): boolean {
  return now - fw.startTime > TOTAL_MS + 1200
}
