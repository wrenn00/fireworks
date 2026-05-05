/**
 * Ink-art firework system.
 *
 * Each firework is a collection of hand-drawn rays (tapered lines, dot trails)
 * radiating from a center point, with optional sub-branches.
 *
 * Design principles:
 *  - No glow / blur — clean ink art aesthetic
 *  - Lines are slightly wobbly (pre-computed, stable per frame)
 *  - Taper toward the tip (thick at base, hairline at end)
 *  - Drawn progressively from center outward, then held, then fade
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WobblyPoint { x: number; y: number }

export interface DotPosition { x: number; y: number; size: number }

export interface InkRay {
  points: WobblyPoint[]   // pre-computed path: center → tip
  maxWidth: number        // lineWidth at base; tapers to ~0.1× at tip
  isDotted: boolean
  dots: DotPosition[]     // pre-computed dot positions (dotted rays only)
}

export interface InkBranch {
  points: WobblyPoint[]
  maxWidth: number
  branchPoint: number     // 0–1 fraction along parent ray when branch starts drawing
}

export interface InkFirework {
  id: number
  cx: number; cy: number
  color: string
  rays: InkRay[]
  branches: InkBranch[]
  drawDuration: number    // ms: center→tip drawing animation
  holdDuration: number    // ms: fully drawn, static
  fadeDuration: number    // ms: alpha 1→0
  startTime: number       // performance.now()
}

// ── Internal helpers ──────────────────────────────────────────────────────────

let nextId = 0

/**
 * Generate a slightly wobbly line path from (fromX,fromY) in `angle` direction
 * for `length` px, in `segments` steps.  Wobble grows toward the tip.
 */
function wobblePath(
  fromX: number, fromY: number,
  angle: number, length: number,
  segments: number, jitterAmp: number,
): WobblyPoint[] {
  const perp = angle + Math.PI / 2
  const pts: WobblyPoint[] = [{ x: fromX, y: fromY }]
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const bx = fromX + Math.cos(angle) * length * t
    const by = fromY + Math.sin(angle) * length * t
    const j  = (Math.random() - 0.5) * jitterAmp * 2 * t  // grows toward tip
    pts.push({ x: bx + Math.cos(perp) * j, y: by + Math.sin(perp) * j })
  }
  return pts
}

/**
 * Pre-compute dot positions at `spacing`-px intervals along a wobbly path.
 */
function computeDots(points: WobblyPoint[], spacing: number): DotPosition[] {
  const dots: DotPosition[] = []
  let traveled = 0
  let nextDot  = 0

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    const dy = points[i + 1].y - points[i].y
    const d  = Math.hypot(dx, dy)

    while (nextDot <= traveled + d) {
      const t = d > 0 ? (nextDot - traveled) / d : 0
      dots.push({
        x:    points[i].x + dx * t,
        y:    points[i].y + dy * t,
        size: 0.5 + Math.random() * 1.2,
      })
      nextDot += spacing * (0.75 + Math.random() * 0.5)
    }
    traveled += d
  }
  return dots
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create one ink-art firework.
 *
 * @param power  0–1  (tap duration / 1500 ms)
 *   0.0–0.2 = small tap    → 8 rays, short, no branches
 *   0.2–0.7 = medium hold  → 10–14 rays, medium, some branches
 *   0.7–1.0 = long hold    → 14–17 rays, long, many branches + dotted trails
 */
export function createInkFirework(
  cx: number, cy: number,
  color: string,
  power: number,
): InkFirework {
  const rayCount  = 8  + Math.floor(power * 9)       // 8–17
  const maxLen    = 35 + power * 130                  // 35–165 px
  const baseWidth = 1.4 + power * 0.6                // 1.4–2 px (fine lines)
  const segments  = 10
  const jitter    = maxLen * 0.015                    // subtle wobble

  // ── Rays ──────────────────────────────────────────────────────────────────
  const rays: InkRay[] = Array.from({ length: rayCount }, (_, i) => {
    const baseAngle = (i / rayCount) * Math.PI * 2
    const angle     = baseAngle + (Math.random() - 0.5) * 0.22   // ±~12° variation
    const length    = maxLen * (0.62 + Math.random() * 0.38)      // length variation

    const points   = wobblePath(cx, cy, angle, length, segments, jitter)
    const isDotted = power > 0.25 && Math.random() < 0.08 + power * 0.32
    const dots     = isDotted ? computeDots(points, 5.5 + Math.random() * 4) : []

    return {
      points,
      maxWidth: baseWidth * (0.8 + Math.random() * 0.4),
      isDotted,
      dots,
    }
  })

  // ── Branches ──────────────────────────────────────────────────────────────
  const branches: InkBranch[] = []
  if (power > 0.22) {
    const maxPerRay = power > 0.7 ? 2 : 1
    for (const ray of rays) {
      if (Math.random() > power * 0.65) continue
      const count = 1 + (maxPerRay > 1 && Math.random() < 0.4 ? 1 : 0)

      for (let b = 0; b < count; b++) {
        const at      = 0.35 + Math.random() * 0.45           // 35–80% along ray
        const idx     = Math.floor(at * (ray.points.length - 1))
        const origin  = ray.points[idx]
        const prev    = ray.points[Math.max(0, idx - 1)]
        const rayAng  = Math.atan2(origin.y - prev.y, origin.x - prev.x)
        const side    = Math.random() < 0.5 ? 1 : -1
        const bAngle  = rayAng + side * (0.5 + Math.random() * 0.55)  // 30–60°
        const bLen    = maxLen * (0.14 + Math.random() * 0.18)

        branches.push({
          points:      wobblePath(origin.x, origin.y, bAngle, bLen, 6, bLen * 0.025),
          maxWidth:    baseWidth * 0.5,
          branchPoint: at,
        })
      }
    }
  }

  return {
    id: nextId++,
    cx, cy, color, rays, branches,
    drawDuration: 280 + power * 520,   // 280–800 ms
    holdDuration: 1500,
    fadeDuration: 1500,
    startTime: performance.now(),
  }
}

// ── State queries ─────────────────────────────────────────────────────────────

export function getInkProgress(fw: InkFirework, now: number): number {
  return Math.min(1, (now - fw.startTime) / fw.drawDuration)
}

export function getInkAlpha(fw: InkFirework, now: number): number {
  const elapsed   = now - fw.startTime
  const fadeStart = fw.drawDuration + fw.holdDuration
  if (elapsed < fadeStart) return 1
  return Math.max(0, 1 - (elapsed - fadeStart) / fw.fadeDuration)
}

export function isInkDone(fw: InkFirework, now: number): boolean {
  return now - fw.startTime >= fw.drawDuration + fw.holdDuration + fw.fadeDuration
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function drawInkRay(
  ctx: CanvasRenderingContext2D,
  ray: InkRay,
  progress: number,
  alpha: number,
): void {
  if (progress <= 0 || alpha <= 0.01) return

  if (ray.isDotted) {
    const n = Math.ceil(ray.dots.length * progress)
    for (let i = 0; i < n; i++) {
      const d = ray.dots[i]
      if (!d) break
      const t = i / Math.max(ray.dots.length - 1, 1)
      ctx.globalAlpha = alpha * (0.8 + (1 - t) * 0.2)
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.size * Math.max(0.28, 1 - t * 0.65), 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }

  // Tapered solid line — each segment drawn at decreasing lineWidth
  const pts = ray.points
  const n   = Math.max(2, Math.ceil(pts.length * progress))
  for (let i = 0; i < n - 1; i++) {
    const t = i / (pts.length - 1)                          // 0=base, 1=tip
    ctx.globalAlpha = alpha * (0.85 + (1 - t) * 0.15)
    ctx.lineWidth   = ray.maxWidth * Math.max(0.12, 1 - t * 0.88)
    ctx.beginPath()
    ctx.moveTo(pts[i].x, pts[i].y)
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y)
    ctx.stroke()
  }
}

/**
 * Draw one ink firework onto `ctx`.  Call this every rAF frame.
 * No state is mutated — `now` drives all animation.
 */
export function drawInkFirework(
  ctx: CanvasRenderingContext2D,
  fw: InkFirework,
  now: number,
): void {
  const progress = getInkProgress(fw, now)
  const alpha    = getInkAlpha(fw, now)
  if (alpha <= 0.01) return

  ctx.strokeStyle = fw.color
  ctx.fillStyle   = fw.color
  ctx.lineCap     = 'round'
  ctx.lineJoin    = 'round'
  ctx.shadowBlur  = 0   // pure ink — no glow

  // Rays
  for (const ray of fw.rays) drawInkRay(ctx, ray, progress, alpha)

  // Branches: start drawing when progress surpasses their branch point
  for (const br of fw.branches) {
    if (progress < br.branchPoint) continue
    const bProg = Math.min(1, (progress - br.branchPoint) / Math.max(0.01, 1 - br.branchPoint))
    drawInkRay(ctx, { points: br.points, maxWidth: br.maxWidth, isDotted: false, dots: [] },
      bProg, alpha * 0.72)
  }

  // Central ink blob
  ctx.globalAlpha = alpha * 0.90
  ctx.fillStyle   = fw.color
  ctx.beginPath()
  ctx.arc(fw.cx, fw.cy, 1.8 + fw.rays.length * 0.12, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
}
