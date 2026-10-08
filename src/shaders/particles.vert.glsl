// Aurora Field — particle vertex shader.
// Every particle carries one precomputed position per shape. Per frame the CPU only sets
// uniforms; morphing, motion, pointer repulsion, depth of field and colour all happen here.

#define PI 3.141592653589793
#define STAGGER 0.4 // share of a morph spent staggering particle start times

uniform float uTime;
uniform float uLoopTime;     // seconds since the shape loop restarted (drives galaxy and disc winding)
uniform float uFrom;         // -1 origin (intro), 0 sphere, 1 galaxy, 2 torus knot, 3 black hole
uniform float uTo;
uniform float uProgress;     // 0 -> 1 across a morph, 1 while a shape is held
uniform float uSwirl;        // turbulence while particles are in flight
uniform float uMotion;       // 0 under prefers-reduced-motion
uniform float uSize;         // base particle size, world units
uniform float uScale;        // drawing-buffer px per world unit at distance 1
uniform float uMaxSize;      // px
uniform float uFocus;        // focus distance, world units
uniform float uAperture;     // blur gained per unit of defocus
uniform float uRepel;        // max push, view-space slope units
uniform float uRepelRadius;  // slope units
uniform vec3 uTrail[TRAIL];  // live pointer, then wake samples: xy = view-space slope, z = strength
uniform vec3 uCyan;
uniform vec3 uViolet;
uniform vec3 uMagenta;
uniform vec3 uWarm;

attribute vec4 aGalaxy;      // xyz, w = normalised disc radius
attribute vec4 aKnot;        // xyz, w = position along the curve
attribute vec4 aHole;        // xyz, w = normalised radius (+2 on the lensed ring)
attribute vec4 aRandom;      // x stagger, y size, z twinkle, w role (< 0 dust, > 0.98 hero)

varying vec3 vColor;
varying float vAlpha;
varying float vBlur;

// 3D simplex noise — Ian McEwan, Ashima Arts (MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

mat2 rotate(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c);
}

// cyan -> violet -> magenta
vec3 aurora(float t) {
  t = clamp(t, 0.0, 1.0);
  return mix(mix(uCyan, uViolet, smoothstep(0.0, 0.5, t)), uMagenta, smoothstep(0.5, 1.0, t));
}

vec3 origin(out vec3 col) {
  col = vec3(1.0);
  return (aRandom.xyz - 0.5) * 0.2;
}

vec3 sphere(out vec3 col) {
  vec3 p = position;
  float r = length(p);
  vec3 n = p / max(r, 1e-4);
  // breathing: a slow global pulse plus travelling swells, along the normal
  float swell = sin(uTime * 1.3) * 0.04 + snoise(n * 1.6 + uTime * 0.3) * 0.09;
  p += n * r * swell * uMotion;
  p.xz = rotate(uTime * 0.16) * p.xz;
  // swells read magenta, troughs and the core read cyan
  col = aurora((length(p) / SPHERE_RADIUS - 0.87) * 3.8);
  return p;
}

vec3 galaxy(out vec3 col) {
  vec3 p = aGalaxy.xyz;
  float r = aGalaxy.w;
  // differential rotation: the core turns faster than the rim, winding the arms
  p.xz = rotate(-uLoopTime * (0.12 + 0.22 / (1.0 + 6.0 * r))) * p.xz;
  p.yz = rotate(0.52) * p.yz;  // tip the disc toward the camera
  p.xy = rotate(-0.3) * p.xy;
  // warm core -> cool rim
  col = mix(uWarm, uMagenta, smoothstep(0.03, 0.32, r));
  col = mix(col, uViolet, smoothstep(0.3, 0.58, r));
  col = mix(col, uCyan, smoothstep(0.55, 0.95, r));
  col *= 1.0 + (1.0 - smoothstep(0.0, 0.1, r)) * 1.2;
  return p;
}

vec3 knot(out vec3 col) {
  vec3 p = aKnot.xyz;
  p.xy = rotate(p.z * 0.5 * sin(uTime * 0.45) * uMotion) * p.xy; // twist through depth
  p.xz = rotate(uTime * 0.23) * p.xz;
  p.yz = rotate(0.5 + sin(uTime * 0.19) * 0.45) * p.yz;
  col = aurora((length(aKnot.xyz) - 0.6) / 1.8);
  // pulses of light racing along the tube
  col *= 1.0 + 2.0 * pow(0.5 + 0.5 * sin(aKnot.w * PI * 10.0 - uTime * 2.6), 14.0);
  return p;
}

vec3 blackHole(out vec3 col) {
  vec3 p = aHole.xyz;
  bool lensed = aHole.w > 1.5;
  float r = fract(aHole.w); // 0 at the inner edge -> 1 at the rim
  // streaks fixed to the gas, so the orbit reads
  float streak = 0.5 + 0.5 * sin(atan(lensed ? p.y : p.z, p.x) * 7.0 + r * 12.0);
  if (lensed) {
    p.xy = rotate(uLoopTime * 0.5) * p.xy; // the far side's image, bent around the shadow
  } else {
    p.xz = rotate(-uLoopTime * (0.3 + 0.9 * (1.0 - r))) * p.xz; // inner gas orbits faster
    p.yz = rotate(0.2) * p.yz; // seen from just above the plane
  }
  // white-hot inner edge -> amber -> magenta -> violet rim
  col = mix(vec3(1.0, 0.95, 0.85), uWarm, smoothstep(0.0, 0.25, r));
  col = mix(col, uMagenta, smoothstep(0.25, 0.6, r));
  col = mix(col, uViolet, smoothstep(0.6, 1.0, r));
  // the side orbiting toward us beams brighter
  col *= (0.5 + 0.9 * streak * streak) * (1.0 + 0.6 * clamp(-p.x / 3.0, -1.0, 1.0));
  return p;
}

vec3 shape(float id, out vec3 col) {
  if (id < -0.5) return origin(col);
  if (id < 0.5) return sphere(col);
  if (id < 1.5) return galaxy(col);
  if (id < 2.5) return knot(col);
  return blackHole(col);
}

void main() {
  float role = aRandom.w;
  float hero = step(0.98, role);
  float glow = 1.0;
  vec3 col;
  vec3 pos;

  if (role < 0.0) {
    // ambient dust: never morphs, drifts slowly through the depth of field
    pos = position + sin(vec3(0.11, 0.09, 0.07) * uTime + aRandom.xyz * 40.0) * 0.35 * uMotion;
    col = mix(uViolet, uCyan, aRandom.z) * 1.5;
  } else {
    pos = shape(uTo, col);

    if (uProgress < 1.0) {
      vec3 fromCol;
      vec3 from = shape(uFrom, fromCol);

      // the black hole forms and unravels from the inside out; everything else staggers randomly
      bool holeMorph = uFrom > 2.5 || uTo > 2.5;
      float order = holeMorph ? fract(aHole.w) * 0.85 + aRandom.x * 0.15 : aRandom.x;
      float t = clamp((uProgress - order * STAGGER) / (1.0 - STAGGER), 0.0, 1.0);
      bool intro = uFrom < -0.5;
      t = intro
        ? (1.0 - exp2(-10.0 * t)) / (1.0 - exp2(-10.0))  // explosive ease-out
        : t * t * t * (t * (t * 6.0 - 15.0) + 10.0);     // smootherstep

      float flight = sin(PI * t);
      pos = mix(from, pos, t);
      col = mix(fromCol, col, t);

      vec3 q = pos * 0.4 + uTime * 0.15;
      pos += vec3(snoise(q), snoise(q + 31.7), snoise(q - 17.3)) * flight * uSwirl;
      if (intro) pos += normalize(pos + 1e-4) * flight * 0.9; // overshooting shockwave
      if (uFrom > 2.5) pos.xz = rotate(flight * 2.5) * pos.xz; // flung out of the hole on a spiral
      glow += flight * 0.7;
    }
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);

  // Pointer repulsion in view-space slope coordinates (x/z, y/z): pushes look the same on
  // screen at every depth. Consecutive trail samples form segments, so a fast stroke carves one
  // continuous channel, and as their strength fades the particles ease back.
  vec2 slope = mv.xy / -mv.z;
  vec2 push = vec2(0.0);
  for (int i = 0; i < TRAIL - 1; i++) {
    vec3 a = uTrail[i];
    vec3 b = uTrail[i + 1];
    vec2 ab = b.xy - a.xy;
    float h = clamp(dot(slope - a.xy, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    vec2 d = slope - a.xy - ab * h;
    float d2 = dot(d, d);
    push += d * inversesqrt(d2 + 1e-6) * mix(a.z, b.z, h) * exp(-d2 / (uRepelRadius * uRepelRadius));
  }
  push /= 1.0 + length(push); // overlapping wake samples saturate instead of stacking
  mv.xy += push * uRepel * -mv.z;
  glow += length(push) * 1.2;

  gl_Position = projectionMatrix * mv;

  // Depth of field per particle: the circle of confusion grows the sprite and spreads the
  // same energy over it. Behind the focus plane blurs more than in front.
  float depth = -mv.z;
  float defocus = depth - uFocus;
  float coc = (defocus > 0.0 ? defocus : -0.5 * defocus) * uAperture;
  float size = uSize * (0.5 + aRandom.y) * (1.0 + hero * 0.8);
  float sharpPx = size * uScale / depth;
  float px = clamp((size + coc) * uScale / depth, 1.0, uMaxSize);
  gl_PointSize = px;
  vBlur = coc / (size + coc);
  vAlpha = min(sharpPx * sharpPx / (px * px), 1.0);
  vAlpha *= smoothstep(0.0, role < 0.0 ? 2.0 : 0.4, uTime); // fade in on load

  float twinkle = pow(0.5 + 0.5 * sin(uTime * (1.5 + 3.0 * aRandom.z) + aRandom.x * 60.0), 6.0);
  glow *= 0.85 + 0.3 * twinkle;
  col = mix(col, vec3(1.0), hero * 0.8);
  glow *= 1.0 + hero * (4.0 * twinkle - 0.5); // heroes rest dim and flash on their peaks
  vColor = col * glow;
}
