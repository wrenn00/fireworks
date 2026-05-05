// Web Audio API synthesis — no external files.
// AudioContext is created lazily on first call (requires a user gesture to unlock).

let ac: AudioContext | null = null

function getAc(): AudioContext {
  if (!ac) ac = new AudioContext()
  // Resume if suspended (browser autoplay policy)
  if (ac.state === 'suspended') ac.resume()
  return ac
}

function noise(ctx: AudioContext, durationSec: number): AudioBufferSourceNode {
  const len = Math.floor(ctx.sampleRate * durationSec)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  return src
}

/**
 * Whoosh — rising bandpass-filtered noise sweep.
 * intensity 0–1: louder + higher pitch + longer duration.
 */
export function playWhoosh(intensity: number): void {
  try {
    const ctx = getAc()
    const dur = 0.35 + intensity * 0.35

    const src = noise(ctx, dur)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 4
    filter.frequency.setValueAtTime(150 + intensity * 100, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(
      1800 + intensity * 2500,
      ctx.currentTime + dur,
    )

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.12 + intensity * 0.22, ctx.currentTime + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(ctx.currentTime)
    src.stop(ctx.currentTime + dur)
  } catch {
    // Silently ignore if AudioContext is unavailable (e.g. blocked by policy)
  }
}

/**
 * Boom — sub-bass pitch-drop + high-freq crack.
 * intensity 0–1: louder + lower fundamental + more crackling overtones.
 */
export function playBoom(intensity: number): void {
  try {
    const ctx = getAc()

    // Sub-bass: sine oscillator falling from ~80Hz to inaudible
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const startFreq = 55 + intensity * 65
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(18, ctx.currentTime + 0.6)

    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(0.5 + intensity * 0.45, ctx.currentTime)
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75)

    osc.connect(oscGain)
    oscGain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.75)

    // Crack: short burst of high-passed noise
    const crackDur = 0.06 + intensity * 0.04
    const crack = noise(ctx, crackDur)

    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 900 + intensity * 600

    const crackGain = ctx.createGain()
    crackGain.gain.setValueAtTime(0.25 + intensity * 0.3, ctx.currentTime)
    crackGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + crackDur)

    crack.connect(hp)
    hp.connect(crackGain)
    crackGain.connect(ctx.destination)
    crack.start(ctx.currentTime)
    crack.stop(ctx.currentTime + crackDur)

    // Shimmer: mid-range noise tail (simulates particle hiss)
    if (intensity > 0.3) {
      const shimDur = 0.5 + intensity * 0.6
      const shim = noise(ctx, shimDur)

      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 3000 + intensity * 2000
      bp.Q.value = 1.5

      const shimGain = ctx.createGain()
      shimGain.gain.setValueAtTime(0.05 + intensity * 0.08, ctx.currentTime)
      shimGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + shimDur)

      shim.connect(bp)
      bp.connect(shimGain)
      shimGain.connect(ctx.destination)
      shim.start(ctx.currentTime)
      shim.stop(ctx.currentTime + shimDur)
    }
  } catch {
    // Silently ignore
  }
}
