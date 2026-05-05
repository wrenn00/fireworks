/**
 * Color utilities for the firework system.
 *
 * Convention: h ∈ [0, 360), s ∈ [0, 100], l ∈ [0, 100]
 */

// ── Conversion ────────────────────────────────────────────────────────────────

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const raw  = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
  const n    = parseInt(full, 16)
  const r    = ((n >> 16) & 255) / 255
  const g    = ((n >>  8) & 255) / 255
  const b    = ( n        & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l   = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l: l * 100 }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6

  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  // Normalise inputs
  const hN = (((h % 360) + 360) % 360) / 360
  const sN = Math.max(0, Math.min(100, s)) / 100
  const lN = Math.max(0, Math.min(100, l)) / 100

  if (sN === 0) {
    const v = Math.round(lN * 255)
    return `#${[v, v, v].map(x => x.toString(16).padStart(2, '0')).join('')}`
  }

  const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN
  const p = 2 * lN - q
  const hue2rgb = (t: number) => {
    const tt = ((t % 1) + 1) % 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  const r = Math.round(hue2rgb(hN + 1 / 3) * 255)
  const g = Math.round(hue2rgb(hN)         * 255)
  const b = Math.round(hue2rgb(hN - 1 / 3) * 255)
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

// ── Saturation boost (makes dull colors vivid) ────────────────────────────────

/** Ensure saturation is at least `minS`. Leaves already-vivid colors untouched. */
function ensureVivid(h: number, s: number, l: number, minS = 70): { h: number; s: number; l: number } {
  return { h, s: Math.max(minS, s), l: Math.max(40, Math.min(75, l)) }
}

// ── Per-particle color (70 / 20 / 10 rule) ────────────────────────────────────

/**
 * Given the user's base color, return a particle color following:
 *   70 % → base color exactly
 *   20 % → hue ±10° variation, same s/l
 *   10 % → lighter "core" (+20 L), same h/s
 *
 * This ensures the user's chosen color always dominates the burst.
 */
export function getParticleColor(baseColor: string): string {
  const { h, s, l } = hexToHSL(baseColor)
  const r = Math.random()

  if (r < 0.70) return baseColor

  if (r < 0.90) {
    // Hue nudge ±10° — still clearly the same color family
    const { h: h2, s: s2, l: l2 } = ensureVivid(
      h + (Math.random() - 0.5) * 20,
      s,
      l,
    )
    return hslToHex(h2, s2, l2)
  }

  // Bright core — same hue, lightness +20
  const { h: h3, s: s3, l: l3 } = ensureVivid(h, s, Math.min(85, l + 20))
  return hslToHex(h3, s3, l3)
}

// ── UI preview: deterministic variation swatches ──────────────────────────────

/**
 * Return `count` preview colors that visually represent what the firework will
 * look like. Deterministic (no Math.random) so the preview is stable.
 *
 * Distribution mirrors the 70/20/10 rule:
 *   positions 0-3 → base color
 *   position  4   → hue -10°
 *   position  5   → hue +10°
 *   position  6+  → bright core
 */
export function generateVariations(baseColor: string, count: number): string[] {
  const { h, s, l } = hexToHSL(baseColor)
  const bright  = hslToHex(h, s, Math.min(85, l + 20))
  const shiftNeg = hslToHex((h - 10 + 360) % 360, Math.max(70, s), l)
  const shiftPos = hslToHex((h + 10) % 360,        Math.max(70, s), l)

  const palette = [
    baseColor, baseColor, baseColor,   // 70 % dominant
    shiftNeg,                           // 10 % hue −
    shiftPos,                           // 10 % hue +
    bright,                             // 10 % bright core
  ]
  return palette.slice(0, count)
}

// ── Hue shift (for stroke gradient) ──────────────────────────────────────────

/**
 * Shift `hex` by `deltaDeg` degrees on the hue wheel, keeping s/l intact.
 * Used to create subtle color gradients along a drawn stroke.
 */
export function shiftHueDeg(hex: string, deltaDeg: number): string {
  const { h, s, l } = hexToHSL(hex)
  return hslToHex(h + deltaDeg, s, l)
}
