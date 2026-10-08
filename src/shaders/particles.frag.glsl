// Aurora Field — particle fragment shader: a soft glowing dot that opens into a bokeh disc
// as it leaves the focus plane. Drawn with additive blending, no depth.

uniform float uOpacity;

varying vec3 vColor;
varying float vAlpha;
varying float vBlur;

void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-6.0 * r * r) - 0.0025;                     // hot centre, soft falloff
  float disc = smoothstep(1.0, 0.8, r) * (0.75 + 0.25 * r) * 0.3; // flat bokeh with a faint rim
  float a = mix(core, disc, smoothstep(0.1, 0.7, vBlur));
  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
}
