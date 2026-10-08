import { useMemo } from 'react'
import { Vector3 } from 'three'

export const COUNT = 150_000
export const SPHERE_RADIUS = 2

const DUST = 0.04 // share of particles left out of the shapes as ambient depth dust
const GALAXY_RADIUS = 3.9
const GALAXY_ARMS = 3
const KNOT_P = 2
const KNOT_Q = 3
const KNOT_RADIUS = 1.45
const KNOT_TUBE = 0.34
const HOLE_PHOTON_RING = 1.12
const HOLE_INNER = 1.35
const HOLE_OUTER = 4.2
const TAU = Math.PI * 2

export interface MorphTargets {
  sphere: Float32Array // xyz, doubles as the geometry's position attribute
  galaxy: Float32Array // xyz + normalised disc radius
  knot: Float32Array // xyz + position along the curve
  hole: Float32Array // xyz + normalised radius (+2 on the lensed ring)
  random: Float32Array // stagger, size, twinkle, role (< 0 marks dust)
}

/** Precomputes one position per particle for every shape the field morphs through. */
export function useMorphTargets(count = COUNT): MorphTargets {
  return useMemo(() => buildTargets(count), [count])
}

const rand = Math.random
const spread = (r: number) => (rand() * 2 - 1) * r
const gauss = () => (rand() + rand() + rand()) / 1.5 - 1 // bell-shaped, bounded to [-1, 1]
const tail = (r: number) => rand() ** 3 * (rand() < 0.5 ? -r : r) // tight centre, long tails

function buildTargets(count: number): MorphTargets {
  const sphere = new Float32Array(count * 3)
  const galaxy = new Float32Array(count * 4)
  const knot = new Float32Array(count * 4)
  const hole = new Float32Array(count * 4)
  const random = new Float32Array(count * 4)

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const i4 = i * 4
    const dust = rand() < DUST
    random[i4] = rand()
    random[i4 + 1] = rand()
    random[i4 + 2] = rand()
    random[i4 + 3] = dust ? -1 : rand()

    if (dust) {
      // a deep slab around the scene, so the depth of field has something to chew on
      const x = spread(15)
      const y = spread(8)
      const z = -14 + rand() * 19
      sphere.set([x, y, z], i3)
      for (const target of [galaxy, knot, hole]) target.set([x, y, z, 0], i4)
      continue
    }
    sphereAt(sphere, i3)
    galaxyAt(galaxy, i4)
    knotAt(knot, i4)
    blackHoleAt(hole, i4)
  }

  if (import.meta.env.DEV) {
    for (const a of [sphere, galaxy, knot, hole]) console.assert(!a.some(Number.isNaN), 'NaN in a morph target')
  }
  return { sphere, galaxy, knot, hole, random }
}

function sphereAt(out: Float32Array, o: number) {
  const y = rand() * 2 - 1
  const a = rand() * TAU
  const s = Math.sqrt(1 - y * y)
  // most particles skin the surface; the rest fill the interior so the core glows
  const r = rand() < 0.16 ? SPHERE_RADIUS * 0.8 * Math.cbrt(rand()) : SPHERE_RADIUS * (1 + gauss() * 0.015)
  out[o] = Math.cos(a) * s * r
  out[o + 1] = y * r
  out[o + 2] = Math.sin(a) * s * r
}

function galaxyAt(out: Float32Array, o: number) {
  let x: number, y: number, z: number
  if (rand() < 0.14) {
    // central bulge
    x = gauss() * 0.55
    y = gauss() * 0.3
    z = gauss() * 0.55
  } else {
    const r = 0.2 + rand() ** 1.6 * (GALAXY_RADIUS - 0.2) // denser toward the core
    const angle = (Math.floor(rand() * GALAXY_ARMS) / GALAXY_ARMS) * TAU + r * 1.15
    const scatter = 0.55 + r * 0.27 // arms fan out toward the rim
    x = Math.cos(angle) * r + tail(scatter)
    y = tail(0.35) * (1.2 - r / GALAXY_RADIUS)
    z = Math.sin(angle) * r + tail(scatter)
  }
  out[o] = x
  out[o + 1] = y
  out[o + 2] = z
  out[o + 3] = Math.min(Math.hypot(x, z) / GALAXY_RADIUS, 1)
}

const p1 = new Vector3()
const p2 = new Vector3()
const tangent = new Vector3()
const normal = new Vector3()
const binormal = new Vector3()

function knotCurve(u: number, target: Vector3) {
  const qu = (KNOT_Q / KNOT_P) * u
  const ring = KNOT_RADIUS * (2 + Math.cos(qu)) * 0.5
  return target.set(ring * Math.cos(u), ring * Math.sin(u), KNOT_RADIUS * Math.sin(qu) * 0.5)
}

function knotAt(out: Float32Array, o: number) {
  const t = rand()
  const u = t * TAU * KNOT_P
  knotCurve(u, p1)
  knotCurve(u + 0.01, p2)
  // same frame construction as three's TorusKnotGeometry
  tangent.subVectors(p2, p1)
  normal.addVectors(p2, p1)
  binormal.crossVectors(tangent, normal).normalize()
  normal.crossVectors(binormal, tangent).normalize()
  const a = rand() * TAU
  const r = KNOT_TUBE * Math.sqrt(0.5 + 0.5 * rand()) // mostly near the tube's skin
  const cx = Math.cos(a) * r
  const cy = Math.sin(a) * r
  out[o] = p1.x + cx * normal.x + cy * binormal.x
  out[o + 1] = p1.y + cx * normal.y + cy * binormal.y
  out[o + 2] = p1.z + cx * normal.z + cy * binormal.z
  out[o + 3] = t
}

/**
 * A black hole: a flat accretion disc around an empty shadow, plus the lensed image of the
 * disc's far side, a ring facing the camera that is tightest at the photon ring.
 * w is the normalised radius; the lensed ring adds 2 so the shader can tell them apart.
 */
function blackHoleAt(out: Float32Array, o: number) {
  const a = rand() * TAU
  if (rand() < 0.35) {
    const t = Math.min(rand() ** 2.2, 0.999)
    const r = HOLE_PHOTON_RING + t
    out[o] = Math.cos(a) * r
    out[o + 1] = Math.sin(a) * r
    out[o + 2] = gauss() * 0.04
    out[o + 3] = 2 + t
  } else {
    const t = Math.min(rand() ** 1.8, 0.999)
    const r = HOLE_INNER + t * (HOLE_OUTER - HOLE_INNER)
    out[o] = Math.cos(a) * r
    out[o + 1] = gauss() * (0.02 + 0.05 * t)
    out[o + 2] = Math.sin(a) * r
    out[o + 3] = t
  }
}
