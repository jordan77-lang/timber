# Timbre Cube

Interactive 3D timbre space visualization based on Leah Reid's research and the timbre descriptors from Peeters et al. (2011).

**Live demo:** https://jordan77-lang.github.io/timber/

---

## Overview

The Timbre Cube allows you to explore a three-dimensional sound space by dragging a marker inside a cube. Each axis controls a different perceptual quality of sound (timbre descriptor), allowing you to morph a clarinet-like base tone through a vast range of timbral variations.

The **center of the cube** represents a neutral, unmodified clarinet G4 tone. Moving away from the center in any direction increases that dimension's effect on the sound.

---

## The Three Axes

### X-Axis: Inharmonicity (Left ↔ Right)

**What it is:** Inharmonicity measures how much the frequency components of a sound deviate from perfect integer multiples of the fundamental frequency.

**What you hear:**
- **Center (neutral):** A pure, clean clarinet tone with harmonically-related partials
- **Edges (left or right):** Increased "roughness" and beating as detuned oscillators are mixed in

**The math:**
```
inharmonicity = (x - 0.5) × 2    // Converts 0-1 position to -1 to +1
inharmonicAmount = |inharmonicity|   // Distance from center (0 to 1)

harmonicLevel = lerp(0.85, 0.5, inharmonicAmount)   // Main tone reduces
inharmonicLevel = inharmonicAmount × 0.4            // Detuned osc increases
```

The effect is achieved by mixing in an oscillator detuned by ~1% (about 17 cents), creating audible beating and roughness characteristic of inharmonic sounds like bells or struck metal.

---

### Y-Axis: Spectral Centroid (Bottom ↔ Top)

**What it is:** Spectral centroid is the "center of mass" of a sound's frequency spectrum—essentially, how bright or dark it sounds.

**What you hear:**
- **Bottom:** Dark, muffled tone (low-pass filtered heavily)
- **Center:** Natural clarinet brightness
- **Top:** Bright, brilliant, almost piercing tone

**The math:**
```
spectralCentroid = (y - 0.5) × 2    // -1 (bottom) to +1 (top)

// Filter cutoff frequency
neutralCutoff = 4000 Hz
minCutoff = 600 Hz      // At bottom
maxCutoff = 14000 Hz    // At top

cutoffFreq = spectralCentroid ≥ 0 
  ? lerp(4000, 14000, spectralCentroid)    // Brighter going up
  : lerp(4000, 600, -spectralCentroid)     // Darker going down

// High shelf EQ boost/cut
highBoost = spectralCentroid × 10 dB   // -10 to +10 dB
```

A low-pass filter controls the overall brightness, while a high-shelf EQ provides additional boost or cut to the upper frequencies. The filter's Q (resonance) also varies slightly with position.

---

### Z-Axis: Noisiness (Front ↔ Back)

**What it is:** Noisiness represents the amount of aperiodic, noise-like components in a sound versus pure tonal content.

**What you hear:**
- **Front:** Pure, clean tonal sound with minimal breath noise
- **Center:** Natural clarinet with subtle breath noise (realistic)
- **Back:** Breathy, airy, noise-dominated sound

**The math:**
```
noisiness = (z - 0.5) × 2    // -1 (front) to +1 (back)

// Noise level (pink noise through bandpass filter)
noiseLevel = clamp(0.08 + noisiness × 0.5, 0.001, 0.6)

// Noise bandwidth (Q of bandpass filter)
noiseQ = clamp(1.2 - |noisiness| × 0.9, 0.3, 2.0)
```

Pink noise is filtered through a bandpass filter that follows the spectral centroid setting, ensuring the noise character matches the overall brightness of the sound.

---

## Cross-Parameter Interactions

The cube also implements subtle interactions between parameters:

**Reverb Send:** Increases with both brightness (Y) and noisiness (Z)
```
reverbAmount = 0.15 + max(0, spectralCentroid) × 0.1 + max(0, noisiness) × 0.15
```

---

## Sound Synthesis Architecture

The base tone is constructed from multiple oscillators with clarinet-like odd-harmonic partials:

1. **Main harmonic oscillator** - Odd partials [1, 0, 0.5, 0, 0.25, 0, 0.12, 0, 0.06]
2. **Second oscillator** - Slightly sharp (+3 cents) for natural richness
3. **Third oscillator** - Slightly flat (-3 cents) for ensemble effect
4. **Inharmonic oscillator** - Detuned +17 cents for roughness (controlled by X)
5. **Noise source** - Pink noise through bandpass filter (controlled by Z)

All sources are mixed and pass through:
- **Centroid Filter** (lowpass, controlled by Y)
- **High Shelf EQ** (controlled by Y)
- **Amplitude Envelope** (soft attack, sustained tone)
- **Reverb Send** (for spatial depth)

---

## Controls

| Control | Action |
|---------|--------|
| **Click & Drag** | Move marker within cube |
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
- Reid, L. - Timbre space visualization research
