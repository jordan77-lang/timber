# Timbre Cube

Interactive 3D timbre space visualization based on Leah Reid's research and the timbre descriptors from Peeters et al. (2011).

**Live demo:** https://jordan77-lang.github.io/timber/

---

## Overview

The Timbre Cube is an interactive 3D timbre space where each axis controls a perceptual descriptor (Peeters et al., 2011). Moving the marker morphs a real clarinet sample in real time.

- **Pure origin:** (x, y, z) = (0, 0, 0) plays the unmodified clarinet sample—the most "pure/clean/dark" sound.
- **One-sided axes:** Increasing any coordinate adds that descriptor (roughness, brightness, noisiness).
- **Coherent source:** All components (sample, noise, breath) share one filter/envelope path for fusion (Gestalt common fate; Bregman, 1990).
- **Perceptual scaling:** Brightness uses a pow curve; noise follows the same tilt for one-source perception; detune jitter is slow and correlated.

---

## The Three Axes

### X-Axis: Inharmonicity (0 → rougher)

**What it is:** Deviation from perfect harmonic partials; more inharmonicity yields roughness/beating.

**What you hear:**
- **x = 0 (pure):** Unmodified clarinet sample, no pitch-shifted companion.
- **x → 1:** Increasing roughness and metallic beating from a detuned pitch-shifted copy mixed in.

**The math:**
```
inharmonicity = x               // 0..1
sampleLevel     = (x < 0.02) ? 0.99 : lerp(0.97, 0.6, x*0.8)
pitchShiftLevel = (x < 0.02) ? 0.0  : lerp(0.0, 0.5, x)

// Pitch shift amount (semitones) with slow jitter
pitchShift = lerp(0, 0.25, x) + (jitterDetune / 100) * x
```

---

### Y-Axis: Spectral Centroid (0 → brighter)

**What it is:** Perceptual brightness; the spectral "center of mass." Higher y lifts brightness.

**What you hear:**
- **y = 0:** Dark/mellow.
- **y → 1:** Bright, brilliant.

**The math:**
```
spectralCentroid = y                      // 0..1
yPerceptual = pow(y, 0.6)                 // perceptual-ish curve
cutoffBase = lerp(700, 13500, yPerceptual)
cutoff     = clamp(cutoffBase + jitterShared, 500, 14500)

filterQ  = clamp(0.8 + 1.1 * spectralCentroid, 0.3, 1.9)
highShelf = (spectralCentroid - 0.5) * 8   // softer, centered tilt
```

Brightness, noise color, and breath all share this same filter tilt for one-source coherence.

---

### Z-Axis: Noisiness (0 → noisier)

**What it is:** Amount and bandwidth of aperiodic (noise) energy.

**What you hear:**
- **z = 0:** Very clean, minimal breath.
- **z → 1:** Airier/breathier, broader noise band.

**The math:**
```
noisiness = z                       // 0..1
noiseFreqBase = lerp(600, 8000, yPerceptual)
noiseFreq     = clamp(noiseFreqBase + jitterShared * 0.35, 400, 9000)

noiseLevel = clamp(0.01 + 0.45 * noisiness^0.8 + jitterShared / 9000, 0.001, 0.55)
noiseQ     = clamp(1.2 - 0.8 * noisiness, 0.35, 2.0)
```

Noise shares the same filter tilt as the tone to preserve single-source perception.

---

## Cross-Parameter Interactions

**Reverb Send:** Increases with brightness and noisiness, capped for clarity
```
reverbAmount = min(0.28, 0.15 + spectralCentroid * 0.08 + noisiness * 0.10)
```

---

## Sound Synthesis Architecture (coherent path)

- **Base sample:** Real clarinet recording (`Clarinet_G.wav`) loops continuously as the pure source at origin (0,0,0).
- **Inharmonicity (X):** A pitch-shifted copy of the sample is mixed in; increasing X adds roughness/beating via slight detuning with slow jitter.
- **Noise:** Pink noise → bandpass; level/Q set by Z (pow curve); cutoff follows the perceptual centroid tilt.
- **Breath transient:** Short white-noise bandpass on note start.
- **Shared chain:** lowpass (centroid, pow-mapped) → gentle high-shelf → body bell (≈1.85 kHz, +2 dB) → soft saturation (tanh) → amplitude envelope → output + reverb send (capped).
- **Jitter (coherent variation):** One shared random-walk value perturbs cutoff/noise; slow detune jitter modulates the pitch-shifted companion.
- **Reverb:** Small-room convolution IR; send scaled by Y/Z and capped for clarity.

This shared path reinforces one-source perception (all components share onset, filter, and envelope), aligning with common-fate cues (Bregman, 1990) while applying timbre descriptors (Peeters et al., 2011).

---

## Controls

| Control | Action |
|---------|--------|
| **Click & Drag** | Move marker freely inside the cube (keeps current depth); scroll or Q/E for coarse depth shifts |
| **Scroll Wheel** | Adjust depth (Z axis) |
| **W/S or ↑/↓** | Move forward/backward (Z) |
| **A/D or ←/→** | Move left/right (X) |
| **Q/E** | Move up/down (Y) |
| **1-8** | Jump to corner presets |
| **0** | Return to center |
| **Drag rotation handle** | Rotate the cube view |

---

## References

- Peeters, G., Giordano, B. L., Susini, P., Misdariis, N., & McAdams, S. (2011). The Timbre Toolbox: Extracting audio descriptors from musical signals. *Journal of the Acoustical Society of America*, 130(5), 2902-2916.
- Bregman, A. S. (1990). *Auditory Scene Analysis*. MIT Press (common-fate cue for source fusion).
- Reid, L. - Timbre space visualization research
