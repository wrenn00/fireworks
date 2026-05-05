import type {
  Point,
  Stroke,
  Drawing,
  FireworkBlueprint,
  FireworkPattern,
  ParticleVector,
  DrawingSequence,
  ScheduledBlueprint,
  StrokeAnalysis,
  BurstSize,
  PlaybackBurst,
  DrawingPlayback,
} from './types'

// ── Low-level geometry ────────────────────────────────────────────────────────

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function arcLength(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += dist2(points[i - 1], points[i])
  return len
}

function normalizeAngle(a: number): number {
  return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
}

/**
 * Resample `points` into exactly `n` evenly-spaced positions along the arc.
 * Returns absolute (x, y) canvas coordinates.
 */
function resampleUniform(points: Point[], n: number): Array<{ x: number; y: number }> {
  if (points.length === 0 || n === 0) return []
  if (points.length === 1 || n === 1) return [{ x: points[0].x, y: points[0].y }]

  // Build cumulative arc-length table
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist2(points[i - 1], points[i]))
  const total = cum[cum.length - 1]
  if (total === 0) return Array.from({ length: n }, () => ({ x: points[0].x, y: points[0].y }))

  const result: Array<{ x: number; y: number }> = []
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total
    // Binary search for the segment containing `target`
    let lo = 0, hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= target) lo = mid; else hi = mid
    }
    const segLen = cum[hi] - cum[lo]
    const t = segLen > 0 ? (target - cum[lo]) / segLen : 0
    result.push({
      x: points[lo].x + (points[hi].x - points[lo].x) * t,
      y: points[lo].y + (points[hi].y - points[lo].y) * t,
    })
  }
  return result
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function shiftHue(hex: string, deltaDeg: number): string {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return hex
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  const h2 = ((h + deltaDeg / 360) % 1 + 1) % 1
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number) => {
    const tt = ((t % 1) + 1) % 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return `rgb(${Math.round(hue2rgb(h2 + 1/3) * 255)},${Math.round(hue2rgb(h2) * 255)},${Math.round(hue2rgb(h2 - 1/3) * 255)})`
}

function variantColor(base: string, index: number, total: number): string {
  return shiftHue(base, ((index / total) - 0.5) * 80)
}

// ── Per-stroke metrics ────────────────────────────────────────────────────────

interface StrokeMetrics {
  arc: number
  chord: number
  curvature: number
  isClosed: boolean
  avgSpeed: number
  aspectRatio: number   // always ≥ 1
  rawAspect: number     // w/h (can be < 1)
  directionVectors: Array<{ angle: number; weight: number }>
  center: { x: number; y: number }
  bounds: { w: number; h: number }
}

function measureStroke(stroke: Stroke): StrokeMetrics {
  const { points } = stroke
  if (points.length < 2) {
    const p0 = points[0] ?? { x: 0, y: 0 }
    return {
      arc: 0, chord: 0, curvature: 0, isClosed: true,
      avgSpeed: 0, aspectRatio: 1, rawAspect: 1,
      directionVectors: [],
      center: p0,
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
  const isClosed = chord < diag * 0.20 && arc > diag * 0.5

  const elapsedMs = Math.max(1, points[points.length - 1].t - points[0].t)
  const rawAspect = w / Math.max(h, 1)

  const step = Math.max(1, Math.floor(points.length / 64))
  const directionVectors: Array<{ angle: number; weight: number }> = []
  for (let i = 0; i < points.length - step; i += step) {
    const dx = points[i + step].x - points[i].x
    const dy = points[i + step].y - points[i].y
    const segLen = Math.hypot(dx, dy)
    if (segLen > 0) {
      directionVectors.push({ angle: normalizeAngle(Math.atan2(dy, dx)), weight: segLen })
    }
  }

  return {
    arc, chord, curvature, isClosed,
    avgSpeed: arc / elapsedMs,
    aspectRatio: Math.max(w, h) / Math.max(Math.min(w, h), 1),
    rawAspect,
    directionVectors,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    bounds: { w, h },
  }
}

// ── Shape classifier ──────────────────────────────────────────────────────────

/**
 * Decision tree:
 *  < 8 points         → sphere  (too few points to distinguish shape)
 *  chord/arc < 0.20   → outline (closed shape)
 *  aspect > 3 or < 0.33 → trail (long straight line)
 *  else               → arc    (general curve)
 */
export function classifyShape(stroke: Stroke): FireworkPattern {
  if (stroke.points.length < 8) return 'sphere'

  const m = measureStroke(stroke)

  if (m.isClosed) return 'outline'

  // Strongly elongated → trail (comet)
  if (m.rawAspect > 3 || m.rawAspect < 0.33) return 'trail'

  // Willow: tall stroke drawn quickly (upward sweep)
  if (m.rawAspect < 0.55 && m.avgSpeed > 0.8) return 'willow'

  // Gentle curve
  return 'arc'
}

// ── Particle vector generators ────────────────────────────────────────────────

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

function trailVectors(
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
  const meanAngle = totalW > 0 ? Math.atan2(sy / totalW, sx / totalW) : 0
  const coneHalf = Math.PI / 10

  return Array.from({ length: count }, (_, i) => ({
    angle: meanAngle + (Math.random() - 0.5) * coneHalf * 2,
    speed: baseSpeed * (0.8 + Math.random() * 0.6),
    color: variantColor(color, i, count),
    life: baseLife * (0.9 + Math.random() * 0.2),
  }))
}

/**
 * Arc: spread particles along the stroke's tangent directions.
 * Each particle's angle is sampled from one of the stroke's direction vectors,
 * spread ±45° around it — gives a curved, directional burst.
 */
function arcVectors(
  dirVectors: StrokeMetrics['directionVectors'],
  count: number,
  baseSpeed: number,
  color: string,
  baseLife: number,
): ParticleVector[] {
  if (dirVectors.length === 0) return sphereVectors(count, baseSpeed, color, baseLife)

  return Array.from({ length: count }, (_, i) => {
    const dv = dirVectors[Math.floor(Math.random() * dirVectors.length)]
    return {
      angle: dv.angle + (Math.random() - 0.5) * (Math.PI / 2),
      speed: baseSpeed * (0.5 + Math.random() * 0.9),
      color: variantColor(color, i, count),
      life: baseLife * (0.8 + Math.random() * 0.4),
    }
  })
}

/**
 * Outline: resample the stroke into `count` evenly-spaced target points.
 * Each ParticleVector carries `targetX / targetY` (absolute canvas coords).
 * The engine will use lerp-to-target for these particles instead of physics.
 */
function outlineVectors(
  stroke: Stroke,
  burstCenter: { x: number; y: number },
  count: number,
  _baseSpeed: number,
  color: string,
  baseLife: number,
): ParticleVector[] {
  const targets = resampleUniform(stroke.points, count)
  return targets.map((pt, i) => {
    // angle and speed are still provided as fallback metadata
    const angle = Math.atan2(pt.y - burstCenter.y, pt.x - burstCenter.x)
    const d = dist2(burstCenter, pt)
    return {
      angle,
      speed: Math.max(1, d / (baseLife * 0.5 * 0.4)), // speed needed to reach in 40% of life at baseLife
      color: variantColor(color, i, count),
      life: baseLife * (0.9 + Math.random() * 0.2),
      targetX: pt.x,
      targetY: pt.y,
    }
  })
}

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
  const spread = Math.PI * 0.6

  return Array.from({ length: count }, (_, i) => {
    const t = i / count
    return {
      angle: primaryAngle - spread / 2 + t * spread,
      speed: baseSpeed * (0.4 + Math.random() * 0.8),
      color: variantColor(color, i, count),
      life: baseLife * (1.2 + Math.random() * 0.4),
    }
  })
}

// ── Single-stroke blueprint ───────────────────────────────────────────────────

function analyzeOneStroke(stroke: Stroke): FireworkBlueprint {
  const m = measureStroke(stroke)
  const pattern = classifyShape(stroke)
  const color = stroke.color

  const burstPoint = { x: m.center.x, y: m.center.y }
  const launchPoint = burstPoint

  const rawCount = Math.floor(40 + stroke.points.length * 0.4 + m.arc * 0.05)
  const particleCount = Math.min(Math.max(rawCount, 50), 400)

  const baseSpeed = Math.min(8, Math.max(1.5, m.avgSpeed * 3))
  const baseLife = Math.round(Math.min(180, Math.max(60, 120 / Math.max(m.avgSpeed, 0.2))))
  const duration = baseLife * (1000 / 60)

  let particleVectors: ParticleVector[]

  switch (pattern) {
    case 'sphere':
      particleVectors = sphereVectors(particleCount, baseSpeed, color, baseLife)
      break
    case 'trail':
      particleVectors = trailVectors(m.directionVectors, particleCount, baseSpeed, color, baseLife)
      break
    case 'arc':
      particleVectors = arcVectors(m.directionVectors, particleCount, baseSpeed, color, baseLife)
      break
    case 'outline':
      particleVectors = outlineVectors(stroke, burstPoint, particleCount, baseSpeed, color, baseLife)
      break
    case 'willow':
      particleVectors = willowVectors(m.directionVectors, particleCount, baseSpeed, color, baseLife)
      break
  }

  return { launchPoint, burstPoint, particleVectors, pattern, duration }
}

// ── Grand finale ──────────────────────────────────────────────────────────────

function makeFinaleBlueprint(
  x: number,
  y: number,
  color: string,
): FireworkBlueprint {
  return {
    launchPoint: { x, y },
    burstPoint: { x, y },
    particleVectors: sphereVectors(
      60 + Math.floor(Math.random() * 40),
      3 + Math.random() * 3,
      color,
      70 + Math.floor(Math.random() * 40),
    ),
    pattern: 'sphere',
    duration: 1800,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a full multi-stroke Drawing and return a DrawingSequence.
 *
 * Each stroke becomes a timed shot (0.3–0.6 s apart).
 * Strokes with < 8 points are treated as sphere bursts.
 * Grand finale (5–8 mini sphere bursts) fires 500 ms after the last shot.
 */
export function analyzeDrawingSequence(drawing: Drawing): DrawingSequence {
  const { strokes } = drawing
  const validStrokes = strokes.filter(s => s.points.length >= 2)

  if (validStrokes.length === 0) {
    return { shots: [{ blueprint: fallbackBlueprint(drawing), delayMs: 0 }], grandFinale: [] }
  }

  // Per-stroke shots with 0.3–0.6 s between each
  let cumulativeDelay = 0
  const shots: ScheduledBlueprint[] = validStrokes.map((stroke, i) => {
    const delayMs = i === 0 ? 0 : cumulativeDelay
    cumulativeDelay += 300 + Math.random() * 300
    return { blueprint: analyzeOneStroke(stroke), delayMs }
  })

  // Grand finale — only when there are 2+ strokes
  const grandFinale: ScheduledBlueprint[] = []
  if (validStrokes.length >= 2) {
    const finaleStart = cumulativeDelay + 500
    const count = 5 + Math.floor(Math.random() * 4)   // 5–8
    const vw = typeof window !== 'undefined' ? window.innerWidth : 900
    const vh = typeof window !== 'undefined' ? window.innerHeight : 700

    // Pick colors from the drawn strokes (cycle through them)
    const colors = validStrokes.map(s => s.color)

    for (let i = 0; i < count; i++) {
      const x = 80 + Math.random() * (vw - 160)
      const y = 60 + Math.random() * (vh * 0.65)   // bias upper ⅔ of screen
      grandFinale.push({
        blueprint: makeFinaleBlueprint(x, y, colors[i % colors.length]),
        delayMs: finaleStart + i * (120 + Math.random() * 80),  // 120–200 ms stagger
      })
    }
  }

  return { shots, grandFinale }
}

/** Kept for backwards compatibility with any code that still calls this */
export function analyzeDrawing(drawing: Drawing): FireworkBlueprint {
  const seq = analyzeDrawingSequence(drawing)
  return seq.shots[0]?.blueprint ?? fallbackBlueprint(drawing)
}

function fallbackBlueprint(drawing: Drawing): FireworkBlueprint {
  const cx = (drawing.bounds.minX + drawing.bounds.maxX) / 2 || 400
  const cy = (drawing.bounds.minY + drawing.bounds.maxY) / 2 || 300
  const color = drawing.strokes[0]?.color ?? '#ffffff'
  return {
    launchPoint: { x: cx, y: cy },
    burstPoint: { x: cx, y: cy },
    particleVectors: sphereVectors(60, 3, color, 90),
    pattern: 'sphere',
    duration: 1500,
  }
}

// ── Path-based playback system (primary) ─────────────────────────────────────

interface SampledPoint { x: number; y: number; t: number }

/** Resample stroke points to exactly n positions with interpolated timestamps */
function resampleWithTime(points: Point[], n: number): SampledPoint[] {
  if (points.length === 0) return []
  if (n <= 1) return [{ x: points[0].x, y: points[0].y, t: points[0].t }]

  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist2(points[i - 1], points[i]))
  const total = cum[cum.length - 1]
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0] }))

  return Array.from({ length: n }, (_, k) => {
    const target = (k / (n - 1)) * total
    let lo = 0, hi = cum.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid }
    const seg = cum[hi] - cum[lo]
    const frac = seg > 0 ? (target - cum[lo]) / seg : 0
    return {
      x: points[lo].x + (points[hi].x - points[lo].x) * frac,
      y: points[lo].y + (points[hi].y - points[lo].y) * frac,
      t: points[lo].t  + (points[hi].t  - points[lo].t)  * frac,
    }
  })
}

/** Convert raw sample timestamps to delays (ms from 0), clamping per-gap to [minGap, maxGap] */
function computeDelays(
  samples: SampledPoint[],
  minGap = 150,   // minimum gap between bursts — enough to see each explosion
  maxGap = 300,   // maximum gap — keeps the sequence snappy
): number[] {
  if (samples.length === 0) return []
  const result = [0]
  for (let i = 1; i < samples.length; i++) {
    const raw = samples[i].t - samples[i - 1].t
    const gap = Math.max(minGap, Math.min(maxGap, isFinite(raw) && raw > 0 ? raw : minGap))
    result.push(result[result.length - 1] + gap)
  }
  return result
}

/**
 * Gentle hue gradient ±10° across n bursts.
 * Small enough that the color reads as the same hue the user chose,
 * but adds subtle life to long strokes.
 */
function burstColors(baseColor: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const t   = n > 1 ? i / (n - 1) : 0
    const deg = (t - 0.5) * 20  // −10° → +10° (was ±30°)
    return shiftHue(baseColor, deg)
  })
}

function burstSizeForStroke(strokeWidth: number): BurstSize {
  if (strokeWidth >= 10) return 'large'
  if (strokeWidth >= 4)  return 'medium'
  return 'small'
}

/**
 * Convert a single Stroke into a sorted list of PlaybackBursts.
 * `timeOffset` shifts all delays so strokes play back-to-back.
 */
function strokeToPlaybackBursts(stroke: Stroke, timeOffset: number): PlaybackBurst[] {
  const arc = arcLength(stroke.points)
  // 6–12 bursts per stroke — sparse enough that each big explosion is visible
  // and the shape is recognisable from the pattern of detonations.
  const n = Math.max(6, Math.min(12, Math.round(arc / 60)))

  const samples = resampleWithTime(stroke.points, n)
  const delays  = computeDelays(samples)
  const colors  = burstColors(stroke.color, n)
  const size    = burstSizeForStroke(stroke.width)

  return samples.map((s, i) => ({
    x: s.x,
    y: s.y,
    globalDelay:   timeOffset + delays[i],
    color:         colors[i],
    size,
    trailDuration: 500 + Math.random() * 300,  // 500–800 ms ascent
  }))
}

/**
 * Build a full DrawingPlayback from all strokes in a Drawing.
 *
 * Layout:
 *   stroke 0 bursts (6–12 big explosions) →
 *   800 ms gap →
 *   stroke 1 bursts → … →
 *   1000 ms pause → grand finale (5–8 big bursts, random screen positions)
 */
export function buildDrawingPlayback(drawing: Drawing): DrawingPlayback {
  const STROKE_GAP_MS = 800
  const FINALE_GAP_MS = 1000   // 1 s pause before finale

  const regularBursts: PlaybackBurst[] = []
  let timeOffset = 0

  for (const stroke of drawing.strokes) {
    if (stroke.points.length < 2) continue
    const bursts = strokeToPlaybackBursts(stroke, timeOffset)
    regularBursts.push(...bursts)
    const strokeEnd = bursts[bursts.length - 1]?.globalDelay ?? timeOffset
    timeOffset = strokeEnd + STROKE_GAP_MS
  }

  const lastRegularDelay = regularBursts[regularBursts.length - 1]?.globalDelay ?? 0

  // Grand finale: 5–8 big fireworks at random positions across the viewport
  const finaleStart  = lastRegularDelay + FINALE_GAP_MS
  const finaleCount  = 5 + Math.floor(Math.random() * 4)   // 5–8
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 900
  const vh = typeof window !== 'undefined' ? window.innerHeight : 700
  const strokeColors = drawing.strokes.map(s => s.color)

  const finaleBursts: PlaybackBurst[] = Array.from({ length: finaleCount }, (_, i) => ({
    x: 80 + Math.random() * (vw - 160),
    y: 60 + Math.random() * (vh * 0.65),
    globalDelay:   finaleStart + i * (100 + Math.random() * 150),   // near-simultaneous
    color:         strokeColors[i % strokeColors.length] ?? '#ffffff',
    size:          'large' as BurstSize,   // full-size bursts for the finale
    trailDuration: 500 + Math.random() * 300,
  }))

  const allBursts = [...regularBursts, ...finaleBursts]
    .sort((a, b) => a.globalDelay - b.globalDelay)

  console.log(
    `[strokeAnalyzer] DrawingPlayback: ${regularBursts.length} regular + `+
    `${finaleBursts.length} finale bursts, lastRegular=${lastRegularDelay}ms`,
  )

  return { bursts: allBursts, lastBurstDelay: lastRegularDelay }
}

// ── Legacy single-stroke API ──────────────────────────────────────────────────

export function analyzeStroke(stroke: Stroke): StrokeAnalysis {
  const { points } = stroke
  if (points.length < 2) {
    const p = points[0] ?? { x: 0, y: 0, t: 0 }
    return { length: 0, angle: -90, speed: 0, curvature: 0, launchPoint: p, burstPoint: p }
  }
  const first = points[0]
  const last = points[points.length - 1]
  const arc = arcLength(points)
  const m = measureStroke(stroke)
  const launchPoint = first.y >= last.y ? first : last
  const burstPoint = first.y >= last.y ? last : first
  return {
    length: arc,
    angle: Math.atan2(last.y - first.y, last.x - first.x) * (180 / Math.PI),
    speed: arc / Math.max(1, last.t - first.t),
    curvature: m.curvature,
    launchPoint,
    burstPoint,
  }
}
