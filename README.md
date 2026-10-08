# Aurora Field

150,000 GPU particles that burst into a breathing sphere, then morph through a spiral galaxy,
a torus knot and a black hole before spiralling back into the sphere and looping. React + TypeScript +
Vite, three.js via @react-three/fiber and drei, @react-three/postprocessing.

## Run

```bash
npm install && npm run dev
```

Open http://localhost:5173. `npm run build` type-checks and writes `dist/`.

## Controls

- **Pointer:** particles part around it and ease back, and the whole field leans toward it.
- **Handle:** set by `HANDLE` in `src/main.tsx`. Timings are in `src/ParticleField.tsx`.

## How it works

| File | Role |
| --- | --- |
| `src/useMorphTargets.ts` | Precomputes one position per particle for every shape plus per-particle seeds. The black hole is an accretion disc around an empty shadow, plus the lensed image of its far side as a ring facing the camera. 4% of particles are ambient dust that never morphs. |
| `src/ParticleField.tsx` | Timeline, camera and pointer. Per frame it only writes uniforms (`uFrom`, `uTo`, `uProgress`, a 13-point pointer trail). There are no CPU loops over particles. |
| `src/shaders/particles.vert.glsl` | Staggered, eased morph with in-flight turbulence. Also per-shape motion, pointer repulsion, colour and depth of field. |
| `src/shaders/particles.frag.glsl` | A soft additive dot that opens into a bokeh disc out of focus. |

Depth of field is computed per particle in the vertex shader. Each particle's circle of
confusion grows its sprite and spreads the same light over it. A screen-space `DepthOfField`
pass would have nothing to read, because additive particles don't write depth. The post stack
is mipmap bloom, vignette and film grain.

## Accessibility and performance

- **`prefers-reduced-motion`:** a slowly rotating sphere with no morphing, burst, camera drift
  or pointer effects.
- **Pixel ratio:** capped at 2. drei's `PerformanceMonitor` drops it to 1 if the frame rate sags.
- **Measured:** a steady 60 fps at 1920×1080 on an Intel UHD 630 integrated GPU.
