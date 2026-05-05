import type {
  Point,
  Stroke,
  Drawing,
  FireworkBlueprint,
  FireworkPattern,
  ParticleVector,
} from './types'

// ── Low-level geometry helpers ────────────────────────────────────────────────

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function arcLength(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += dist2(points[i - 1], points[i])
  return len
}

/** Normalise angle to [0, 2π) */
function normalizeAngle(a: number): number {
  return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
}


// ── Color helpers ─────────────────────────────────────────────────────────────

/** Parse any CSS hex color (#rgb, #rrggbb) into [r, g, b] 0-255 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Shift hue by `delta` degrees, keeping saturation/lightness roughly intact.
 *  Operates in a simplified RGB ↔ HSL space. */
function shiftHue(hex: string, deltaDeg: number): string {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return hex // achromatic

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6

  const h2 = ((h + deltaDeg / 360) % 1 + 1) % 1

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number) => {
    const tt = ((t % 1) + 1) % 1
    if (tt < 1/6) return p + (q - p) * 6 * tt
    if (tt < 1/2) return q
    if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6
    return p
  }
  const nr = Math.round(hue2rgb(h2 + 1/3) * 255)
  const ng = Math.round(hue2rgb(h2) * 255)
  const nb = Math.round(hue2rgb(h2 - 1/3) * 255)
  return `rgb(${nr},${ng},${nb})`
}

/** Pick a hue-shifted variant for visual spread */
function variantColor(base: string, index: number, total: number): string {
  const spread = 40 // ±40° hue spread
  const delta = ((index / total) - 0.5) * spread * 2
  return shiftHue(base, delta)
}

// ── Per-stroke metrics ────────────────────────────────────────────────────────

interface StrokeMetrics {
  arc: number          // total arc length in px
  chord: number        // straight-line distance first→last
  curvature: number    // 0 = straight, 1 = very curved
  isClosed: boolean    // start and end within 10% of bounding diagonal
  avgSpeed: number     // px / ms
  aspectRatio: number  // bounding-box width / height (or height/width, always ≥ 1)
  directionVectors: Array<{ angle: number; weight: number }> // sub-segment directions
  center: { x: number; y: number }
  bounds: { w: number; h: number }
}

function measureStroke(stroke: Stroke): StrokeMetrics {
  const { points } = stroke
  if (points.length < 2) {
    return {
      arc: 0, chord: 0, curvature: 0, isClosed: true,
      avgSpeed: 0, aspectRatio: 1,
      directionVectors: [],
      center: points[0] ?? { x: 0, y: 0 },
      bounds: { w: 0, h: 0 },
    }
  }

  const arc = arcLength(points)
  const chord = dist2(points[0], points[points.length - 1])
  const curvature = arc > 0 ? Math.min(1, Math.max(0, 1 - chord / arc)) : 0

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const w = maxX - minX
  const h = maxY - minY
  const diag = Math.hypot(w, h)
  const isClosed = chord < diag * 0.15 && arc > diag * 0.5

  const elapsedMs = Math.max(1, points[points.length - 1].t - points[0].t)
  const avgSpeed = arc / elapsedMs

  const a = Math.max(w, h)
  const b = Math.max(Math.min(w, h), 1)
  const aspectRatio = a / b

  // Build direction vectors from sub-segments (sample ≤ 64 segments for perf)
  const step = Math.max(1, Math.floor(points.length / 64))
  const directionVectors: Array<{ angle: number; weight: number }> = []
  for (let i = 0; i < points.length - step; i += step) {
    const dx = points[i + step].x - points[i].x
    const dy = points[i + step].y - points[i].y
    const segLen = Math.hypot(dx, dy)
    if (segLen > 0) {
      directionVectors.push({
        angle: normalizeAngle(Math.atan2(dy, dx)),
        weight: segLen,
      })
    }
  }

  return {
    arc, chord, curvature, isClosed, avgSpeed,
    aspectRatio,
    directionVectors,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    bounds: { w, h },
  }
}

// ── Shape classifier ─────────────────────────────────────────────────────────

/**
 * Classify a single stroke into a firework pattern.
 *
 * Decision tree:
 *  closed shape          → outline  (particles trace the drawn outline)
 *  curvature < 0.12      → trail    (comet-like: narrow directional burst)
 *  aspect ratio > 2.5    → willow   (long elongated → drooping willow tail)
 *  else                  → sphere   (generic radial burst)
 */
export function classifyShape(stroke: Stroke): FireworkPattern {
  const m = measureStroke(stroke)

  if (m.isClosed)          return 'outline'
  if (m.curvature < 0.12)  return 'trail'
  if (m.aspectRatio > 2.5) return 'willow'
  return 'sphere'
}

// ── Particle vector generators (one per pattern) ──────────────────────────────

/** Radial burst in all directions */
function sphereVectors(
  count: number,
  baseSpeed: number,
  color: string,
  baseLife: number,
): ParticleVector[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2,
    speed: baseSpeed * (0.6 + Math.random() * 0.8),
    color: variantColor(color, i, count),
    life: baseLife * (0.8 + Math.random() * 0.4),
  }))
}

/** Narrow cone in the stroke's primary direction */
function trailVectors(
  dirVectors: StrokeMetrics['directionVectors'],
  count: number,
  baseSpeed: number,
  color: string,
  baseLife: number,
): ParticleVector[] {
  // Weighted mean angle
  let sx = 0, sy = 0, totalW = 0
  for (const { angle, weight } of dirVectors) {
    sx += Math.cos(angle) * weight
    sy += Math.sin(angle) * weight
    totalW += weight
  }
  const meanAngle = totalW > 0 ? Math.atan2(sy / totalW, sx / totalW) : 0
  const coneHalf = Math.PI / 10 // ±18°

  return Array.from({ length: count }, (_, i) => ({
    angle: meanAngle + (Math.random() - 0.5) * coneHalf * 2,
    speed: baseSpeed * (0.8 + Math.random() * 0.6),
    color: variantColor(color, i, count),
    life: baseLife * (0.9 + Math.random() * 0.2),
  }))
}

/**
 * Particles placed along the drawn outline, fired outward from the center.
 * Preserves the recognisable shape of the original stroke.
 */
function outlineVectors(
  stroke: Stroke,
  center: { x: number; y: number },
  count: number,
  baseSpeed: number,
  color: string,
  baseLife: number,
): ParticleVector[] {
  const { points } = stroke
  const step = Math.max(1, Math.floor(points.length / count))
  const result: ParticleVector[] = []

  for (let i = 0; i < points.length && result.length < count; i += step) {
    const p = points[i]
    const angle = Math.atan2(p.y - center.y, p.x - center.x)
    result.push({
      angle,
      speed: baseSpeed * (0.5 + Math.random() * 0.5),
      color: variantColor(color, result.length, count),
      life: baseLife * (0.7 + Math.random() * 0.5),
    })
  }
  return result
}

/**
 * Willow: initial upward burst then particles arc downward with high gravity.
 * Represented by angles biased toward the stroke's primary axis with a
 * downward skew — the fireworkEngine applies extra gravity for willow pattern.
 */
function willowVectors(
  dirVectors: StrokeMetrics['directionVectors'],
  count: number,
  baseSpeed: number,
  color: string,
  baseLife: number,
): ParticleVector[] {
  let sx = 0, sy = 0, totalW = 0
  for (const { angle, weight } of dirVectors) {
    sx += Math.cos(angle) * weight
    sy += Math.sin(angle) * weight
    totalW += weight
  }
  const primaryAngle = totalW > 0 ? Math.atan2(sy / totalW, sx / totalW) : -Math.PI / 2
  const spread = Math.PI * 0.6  // 108° fan

  return Array.from({ length: count }, (_, i) => {
    const t = i / count
    const angle = primaryAngle - spread / 2 + t * spread
    return {
      angle,
      speed: baseSpeed * (0.4 + Math.random() * 0.8),
      color: variantColor(color, i, count),
      life: baseLife * (1.2 + Math.random() * 0.4), // willow hangs longer
    }
  })
}

// ── Drawing-level analysis ────────────────────────────────────────────────────

/**
 * Merge all stroke metrics to determine:
 *  - dominant pattern (majority vote weighted by arc length)
 *  - overall speed, size, density
 */
function mergeMetrics(strokes: Stroke[]): {
  dominantPattern: FireworkPattern
  avgSpeed: number
  totalArc: number
  totalPoints: number
  allMetrics: StrokeMetrics[]
} {
  const allMetrics = strokes.map(measureStroke)
  const totalArc = allMetrics.reduce((s, m) => s + m.arc, 0)
  const totalPoints = strokes.reduce((s, st) => s + st.points.length, 0)

  const patternScore: Record<FireworkPattern, number> = {
    sphere: 0, trail: 0, outline: 0, willow: 0,
  }
  strokes.forEach((stroke, i) => {
    const pattern = classifyShape(stroke)
    // Weight by arc length so a tiny scribble doesn't override a big sweep
    patternScore[pattern] += allMetrics[i].arc
  })
  const dominantPattern = (Object.entries(patternScore) as [FireworkPattern, number][])
    .reduce((best, cur) => cur[1] > best[1] ? cur : best)[0]

  const speedNumer = allMetrics.reduce((s, m) => s + m.avgSpeed * m.arc, 0)
  const avgSpeed = totalArc > 0 ? speedNumer / totalArc : 1

  return { dominantPattern, avgSpeed, totalArc, totalPoints, allMetrics }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a full Drawing (one or more strokes drawn by the user) and return
 * a FireworkBlueprint that the fireworkEngine can consume directly.
 */
export function analyzeDrawing(drawing: Drawing): FireworkBlueprint {
  const { strokes, bounds } = drawing
  if (strokes.length === 0 || strokes.every(s => s.points.length < 2)) {
    return fallbackBlueprint(drawing)
  }

  const { dominantPattern, avgSpeed, totalArc, totalPoints, allMetrics } =
    mergeMetrics(strokes)

  // Burst at the visual centroid of the whole drawing
  const burstPoint = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }

  // Launch from directly below the burst on the canvas bottom edge
  const launchPoint = { x: burstPoint.x, y: burstPoint.y }

  // Base particle count: driven by density (point count) and size (arc)
  const rawCount = Math.floor(
    40 + totalPoints * 0.4 + totalArc * 0.05,
  )
  const particleCount = Math.min(Math.max(rawCount, 50), 400)

  // Base speed: fast drawing → energetic burst; slow → gentle drift
  //   avgSpeed is px/ms; typical range 0.1–3. Map to 1.5–8 px/frame.
  const baseSpeed = Math.min(8, Math.max(1.5, avgSpeed * 3))

  // Lifetime: inversely tied to speed (fast = shorter flash, slow = lingering)
  const baseLife = Math.round(Math.min(180, Math.max(60, 120 / Math.max(avgSpeed, 0.2))))

  // Duration: how long the whole firework animation runs (ms)
  const duration = baseLife * (1000 / 60)  // convert frames → ms at 60fps

  // Use primary stroke color (first stroke wins; multi-stroke gets first)
  const primaryColor = strokes[0].color

  // Build particle vectors based on pattern
  let particleVectors: ParticleVector[]

  switch (dominantPattern) {
    case 'sphere':
      particleVectors = sphereVectors(particleCount, baseSpeed, primaryColor, baseLife)
      break

    case 'trail': {
      // Combine all direction vectors from all strokes
      const allDirs = allMetrics.flatMap(m => m.directionVectors)
      particleVectors = trailVectors(allDirs, particleCount, baseSpeed, primaryColor, baseLife)
      break
    }

    case 'outline': {
      // Use the largest stroke (by arc) as the outline template
      const longestIdx = allMetrics.reduce(
        (best, m, i) => m.arc > allMetrics[best].arc ? i : best, 0,
      )
      particleVectors = outlineVectors(
        strokes[longestIdx],
        allMetrics[longestIdx].center,
        particleCount,
        baseSpeed,
        primaryColor,
        baseLife,
      )
      break
    }

    case 'willow': {
      const allDirs = allMetrics.flatMap(m => m.directionVectors)
      particleVectors = willowVectors(allDirs, particleCount, baseSpeed, primaryColor, baseLife)
      break
    }
  }

  // If the drawing has multiple strokes with distinct colors, overlay their
  // color contributions by patching a portion of the vectors
  if (strokes.length > 1) {
    let offset = 0
    strokes.forEach((stroke, i) => {
      const share = Math.floor(
        particleVectors.length * (allMetrics[i].arc / Math.max(1, totalArc)),
      )
      for (let j = offset; j < Math.min(offset + share, particleVectors.length); j++) {
        particleVectors[j].color = variantColor(stroke.color, j - offset, share)
      }
      offset += share
    })
  }

  return { launchPoint, burstPoint, particleVectors, pattern: dominantPattern, duration }
}

/** Fallback for degenerate input (single dot, empty drawing) */
function fallbackBlueprint(drawing: Drawing): FireworkBlueprint {
  const cx = (drawing.bounds.minX + drawing.bounds.maxX) / 2 || 0
  const cy = (drawing.bounds.minY + drawing.bounds.maxY) / 2 || 0
  const color = drawing.strokes[0]?.color ?? '#ffffff'
  return {
    launchPoint: { x: cx, y: cy },
    burstPoint:  { x: cx, y: cy },
    particleVectors: sphereVectors(60, 3, color, 90),
    pattern: 'sphere',
    duration: 1500,
  }
}

// ── Legacy single-stroke API (keeps FireworkCanvas working unchanged) ─────────

import type { StrokeAnalysis } from './types'

export function analyzeStroke(stroke: Stroke): StrokeAnalysis {
  const { points } = stroke
  if (points.length < 2) {
    const p = points[0] ?? { x: 0, y: 0, t: 0 }
    return { length: 0, angle: -90, speed: 0, curvature: 0, launchPoint: p, burstPoint: p }
  }

  const first = points[0]
  const last = points[points.length - 1]
  const arc = arcLength(points)
  const angle = Math.atan2(last.y - first.y, last.x - first.x) * (180 / Math.PI)
  const elapsedMs = Math.max(1, last.t - first.t)
  const m = measureStroke(stroke)

  const launchPoint = first.y >= last.y ? first : last
  const burstPoint = first.y >= last.y ? last : first

  return {
    length: arc,
    angle,
    speed: arc / elapsedMs,
    curvature: m.curvature,
    launchPoint,
    burstPoint,
  }
}
