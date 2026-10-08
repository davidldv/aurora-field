import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { ParticleField } from './ParticleField'

const HANDLE = '@nulodev'
// ponytail: read once at load; add a matchMedia change listener if live toggling ever matters
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches
const MAX_DPR = Math.min(devicePixelRatio, 2)

function App() {
  const [dpr, setDpr] = useState(MAX_DPR)
  return (
    <>
      <Canvas
        dpr={dpr}
        camera={{ fov: 40, near: 0.1, far: 100, position: [0, 0, 10] }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#05060a']} />
        <PerformanceMonitor onDecline={() => setDpr(1)} />
        <ParticleField reducedMotion={REDUCED_MOTION} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.35} luminanceThreshold={0.1} luminanceSmoothing={0.4} radius={0.8} />
          <Vignette offset={0.22} darkness={0.82} />
          <Noise opacity={0.045} />
        </EffectComposer>
      </Canvas>
      <footer className="overlay">
        <span>{HANDLE}</span>
        <span className="credit">built with React · Three.js · Opus 5.5</span>
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
