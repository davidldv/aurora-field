import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color, MathUtils, ShaderMaterial, Vector2, Vector3 } from 'three'
import type { PerspectiveCamera, Points } from 'three'
import { SPHERE_RADIUS, useMorphTargets } from './useMorphTargets'
import vertexShader from './shaders/particles.vert.glsl?raw'
import fragmentShader from './shaders/particles.frag.glsl?raw'

// Shapes: 0 sphere, 1 galaxy, 2 torus knot, 3 black hole. The loop wraps black hole -> sphere.
const INTRO = 2.6 // burst from a single point into the sphere
const HOLD = [4, 4, 4, 4] // seconds each shape is held
const MORPH = [2.4, 2.4, 2.6, 2.8] // seconds to morph into the next shape
const SWIRL = [0.7, 0.8, 0.6, 1.3] // in-flight turbulence; leaving the black hole gets the most
const LOOP = [...HOLD, ...MORPH].reduce((a, b) => a + b)
const TRAIL = 13 // live pointer + 12 fading wake samples
const DEFINES = { TRAIL, SPHERE_RADIUS: SPHERE_RADIUS.toFixed(1) }
const HELD = { from: 0, to: 0, progress: 1, swirl: 0, loop: 0 }

function timeline(time: number) {
  if (time < INTRO) return { from: -1, to: 0, progress: time / INTRO, swirl: 0.9, loop: 0 }
  const loop = (time - INTRO) % LOOP
  let t = loop
  for (let i = 0; i < HOLD.length; i++) {
    if (t < HOLD[i]) return { from: i, to: i, progress: 1, swirl: 0, loop }
    t -= HOLD[i]
    if (t < MORPH[i]) return { from: i, to: (i + 1) % HOLD.length, progress: t / MORPH[i], swirl: SWIRL[i], loop }
    t -= MORPH[i]
  }
  return { ...HELD, loop }
}

const slopeTarget = new Vector2()

interface ParticleFieldProps {
  reducedMotion: boolean
}

export function ParticleField({ reducedMotion }: ParticleFieldProps) {
  const targets = useMorphTargets()
  const points = useRef<Points>(null!)
  const clock = useRef(0)
  const pointer = useMemo(
    () => ({ ndc: new Vector2(), slope: new Vector2(), active: false, entered: false, hover: 0, speed: 0, nextSample: 0 }),
    [],
  )
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLoopTime: { value: 0 },
      uFrom: { value: 0 },
      uTo: { value: 0 },
      uProgress: { value: 1 },
      uSwirl: { value: 0 },
      uMotion: { value: reducedMotion ? 0 : 1 },
      uSize: { value: 0.018 },
      uScale: { value: 1 },
      uMaxSize: { value: 48 },
      uFocus: { value: 10 },
      uAperture: { value: 0.016 },
      uRepel: { value: 0.045 },
      uRepelRadius: { value: 0.065 },
      uOpacity: { value: 0.6 },
      uTrail: { value: Array.from({ length: TRAIL }, () => new Vector3()) },
      uCyan: { value: new Color('#2ee6ff') },
      uViolet: { value: new Color('#7a5cff') },
      uMagenta: { value: new Color('#ff3fd2') },
      uWarm: { value: new Color('#ffb46a') },
    }),
    [reducedMotion],
  )
  // Built by hand: R3F copies a <shaderMaterial uniforms> prop into fresh objects, which would
  // detach the uniforms mutated every frame below.
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        defines: DEFINES,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    [uniforms],
  )
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    if (reducedMotion) return
    const move = (e: PointerEvent) => {
      pointer.ndc.set((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2)
      if (!pointer.active) pointer.entered = true
      pointer.active = true
    }
    const leave = () => {
      pointer.active = false
    }
    const root = document.documentElement
    addEventListener('pointermove', move)
    root.addEventListener('pointerleave', leave)
    return () => {
      removeEventListener('pointermove', move)
      root.removeEventListener('pointerleave', leave)
    }
  }, [pointer, reducedMotion])

  useFrame(({ camera, size, gl }, delta) => {
    const dt = Math.min(delta, 1 / 20) // no jumps after a hitch or a hidden tab
    const time = (clock.current += dt)
    const u = uniforms
    const cam = camera as PerspectiveCamera
    const tanHalf = Math.tan(MathUtils.degToRad(cam.fov) / 2)
    const aspect = size.width / size.height
    const dpr = gl.getPixelRatio()

    const phase = reducedMotion ? HELD : timeline(time)
    u.uTime.value = time
    u.uLoopTime.value = phase.loop
    u.uFrom.value = phase.from
    u.uTo.value = phase.to
    u.uProgress.value = phase.progress
    u.uSwirl.value = phase.swirl

    // Camera: dolly back out of the burst, then a slow drifting orbit. Narrow screens pull back
    // far enough for the word to fit.
    const fit = Math.max(9.5, 5.6 / (tanHalf * aspect))
    if (reducedMotion) cam.position.set(0, 0, fit)
    else {
      const dolly = 1 - (1 - Math.min(time / 4, 1)) ** 3
      cam.position.set(Math.sin(time * 0.07) * 1.1, Math.sin(time * 0.053) * 0.55, fit * (0.74 + 0.26 * dolly))
    }
    cam.lookAt(0, 0, 0)

    u.uFocus.value = cam.position.length()
    u.uScale.value = (size.height * dpr) / 2 / tanHalf
    u.uMaxSize.value = 48 * dpr

    // Pointer: eased position, hover strength, and a wake sampled at 30 Hz whose strength
    // follows pointer speed and fades out, so displaced particles drift back.
    const p = pointer
    const trail = u.uTrail.value
    slopeTarget.set(p.ndc.x * tanHalf * aspect, p.ndc.y * tanHalf)
    if (p.entered) p.slope.copy(slopeTarget) // no wake streaking in from the last exit point
    p.entered = false
    const prevX = p.slope.x
    const prevY = p.slope.y
    p.slope.lerp(slopeTarget, 1 - Math.exp(-dt * 12))
    p.speed = MathUtils.damp(p.speed, Math.hypot(p.slope.x - prevX, p.slope.y - prevY) / Math.max(dt, 1e-3), 8, dt)
    p.hover = MathUtils.damp(p.hover, p.active ? 1 : 0, 3, dt)
    trail[0].set(p.slope.x, p.slope.y, p.hover * 0.6)
    for (let i = 1; i < TRAIL; i++) trail[i].z *= Math.exp(-dt / 0.5)
    if ((p.nextSample -= dt) <= 0) {
      p.nextSample = 1 / 30
      const recycled = trail.pop()!
      trail.splice(1, 0, recycled.set(p.slope.x, p.slope.y, p.hover * Math.min(p.speed * 2, 1)))
    }

    // Parallax: the field leans toward the pointer.
    const field = points.current
    field.rotation.x = MathUtils.damp(field.rotation.x, p.active ? -p.ndc.y * 0.14 : 0, 2, dt)
    field.rotation.y = MathUtils.damp(field.rotation.y, p.active ? p.ndc.x * 0.2 : 0, 2, dt)
  })

  return (
    <points ref={points} material={material} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[targets.sphere, 3]} />
        <bufferAttribute attach="attributes-aGalaxy" args={[targets.galaxy, 4]} />
        <bufferAttribute attach="attributes-aKnot" args={[targets.knot, 4]} />
        <bufferAttribute attach="attributes-aHole" args={[targets.hole, 4]} />
        <bufferAttribute attach="attributes-aRandom" args={[targets.random, 4]} />
      </bufferGeometry>
    </points>
  )
}
