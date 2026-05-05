/**
 * Web Audio API sound synthesis — zero external files.
 *
 * Global mute is stored in module scope so it survives re-renders.
 * Call setMuted(true/false) to toggle; isMuted() to read the state.
 */

// ── AudioContext (lazy, unlocked on first user gesture) ───────────────────────

let ac: AudioContext | null = null
let masterGain: GainNode | null = null
let muted = false

function getAc(): { ctx: AudioContext; out: GainNode } {
  if (!ac) {
    ac = new AudioContext()
    masterGain = ac.createGain()
    masterGain.gain.value = muted ? 0 : 1
    masterGain.connect(ac.destination)
  }
  if (ac.state === 'suspended') ac.resume()
  return { ctx: ac, out: masterGain! }
}

// ── Mute control ──────────────────────────────────────────────────────────────

export function setMuted(value: boolean): void {
  muted = value
  if (masterGain) masterGain.gain.setTargetAtTime(value ? 0 : 1, ac!.currentTime, 0.02)
}

export function isMuted(): boolean {
  return muted
}

// ── Noise source ──────────────────────────────────────────────────────────────

function noiseSource(ctx: AudioContext, durationSec: number): AudioBufferSourceNode {
  const len = Math.floor(ctx.sampleRate * durationSec)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  return src
}

// ── Whoosh ────────────────────────────────────────────────────────────────────

/**
 * Downward-swept lowpass noise: 2000 Hz → 200 Hz in 0.4 s.
 * intensity 0–1 scales volume and starting frequency.
 */
export function playWhoosh(intensity: number): void {
  try {
    const { ctx, out } = getAc()
    const dur = 0.38 + intensity * 0.12   // 0.38–0.5 s

    const src = noiseSource(ctx, dur)

    // Lowpass swept downward (missile falling)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 2.5
    lp.frequency.setValueAtTime(1800 + intensity * 1200, ctx.currentTime)
    lp.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.4)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)

    src.connect(lp)
    lp.connect(gain)
    gain.connect(out)
    src.start(ctx.currentTime)
    src.stop(ctx.currentTime + dur)
  } catch { /* silently ignore */ }
}

// ── Boom ──────────────────────────────────────────────────────────────────────

/**
 * Explosion: sine sub-bass + bandpass noise burst.
 *
 * intensity 0–1:
 *  - sine frequency: 60–90 Hz
 *  - sine gain:      0.4 (fades in 0.3 s)
 *  - noise gain:     0.2 (fades in 0.5 s)
 *  - noise bandpass: 800 Hz centred (± intensity spread)
 */
export function playBoom(intensity: number): void {
  try {
    const { ctx, out } = getAc()
    const now = ctx.currentTime

    // ── Sine sub-bass ─────────────────────────────────────────────────────
    const sineFreq = 60 + intensity * 30   // 60–90 Hz
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(sineFreq, now)
    // Short pitch drop for impact
    osc.frequency.exponentialRampToValueAtTime(sineFreq * 0.3, now + 0.3)

    const sineGain = ctx.createGain()
    sineGain.gain.setValueAtTime(0.4 * (0.6 + intensity * 0.4), now)
    sineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)

    osc.connect(sineGain)
    sineGain.connect(out)
    osc.start(now)
    osc.stop(now + 0.31)

    // ── Bandpass noise burst ──────────────────────────────────────────────
    const noiseDur = 0.5
    const nSrc = noiseSource(ctx, noiseDur)

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(800 + intensity * 400, now)
    bp.Q.value = 1.5 + intensity * 1.5

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.2 * (0.5 + intensity * 0.5), now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur)

    nSrc.connect(bp)
    bp.connect(noiseGain)
    noiseGain.connect(out)
    nSrc.start(now)
    nSrc.stop(now + noiseDur)

    // ── Crackle tail (타닥타닥) ───────────────────────────────────────────
    playCrackle(intensity)
  } catch { /* silently ignore */ }
}

// ── Crackle ───────────────────────────────────────────────────────────────────

/**
 * 5–12 short noise bursts scattered 0.3–1.5 s after the boom.
 * Each burst: ~30 ms, gain 0.05–0.1, highpass-filtered snap.
 */
export function playCrackle(intensity: number): void {
  try {
    const { ctx, out } = getAc()
    const burstCount = 5 + Math.floor(Math.random() * 8)   // 5–12

    for (let i = 0; i < burstCount; i++) {
      const delay  = 0.3 + Math.random() * 1.2              // 0.3–1.5 s
      const dur    = 0.02 + Math.random() * 0.015           // 20–35 ms
      const vol    = 0.05 + Math.random() * 0.055           // 0.05–0.105
      const freq   = 1500 + Math.random() * 3000            // 1.5–4.5 kHz snap
      const when   = ctx.currentTime + delay

      const nSrc = noiseSource(ctx, dur + 0.01)

      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = freq

      const g = ctx.createGain()
      g.gain.setValueAtTime(vol * (0.6 + intensity * 0.4), when)
      g.gain.exponentialRampToValueAtTime(0.001, when + dur)

      nSrc.connect(hp)
      hp.connect(g)
      g.connect(out)
      nSrc.start(when)
      nSrc.stop(when + dur + 0.01)
    }
  } catch { /* silently ignore */ }
}
