// Menu spaces (prefabs/spaces/*.tscn + scripts/spaces/*.cs) other than waves, void and solid, drawn with a small scene renderer.
// Scene data (nodes, transforms, meshes, materials, environments) is generated from the .tscn files (tools/gen-spaces.py).
// What the renderer reproduces of Godot (Forward+): StandardMaterial3D albedo colour x texture x vertex colour, unshaded or lit
// (no lights in these scenes and black ambient, so lit surfaces come out black), alpha / additive blending, cull mode, uv1 scale
// and offset, distance fade (pixel alpha), disable_fog, GeometryInstance3D transparency; Environment background colour / sky,
// depth fog (begin, end, curve, density, light colour x energy, sky affect); opaque then back-to-front transparent passes;
// CPUParticles3D / GPUParticles3D for the features these scenes use (random positions, so not the same particles as Godot's).
import { compile, loadImage, makeTexture, GLSL_COLOR } from './gl.js';
import { SPACES } from './spaces.data.js';

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV;
uniform mat4 uModel, uView, uProj; uniform vec2 uUvScale, uUvOff; out vec2 vUV; out vec3 vViewP;
void main(){ vec4 v = uView * uModel * vec4(aPos, 1.0); vViewP = v.xyz; vUV = aUV * uUvScale + uUvOff; gl_Position = uProj * v; }`;
const FS = `#version 300 es
precision highp float; ${GLSL_COLOR}
in vec2 vUV; in vec3 vViewP; out vec4 o;
uniform sampler2D uTex; uniform bool uHasTex, uLit, uFogOn, uFade, uAdd; uniform vec4 uColor; uniform vec3 uFogColor;
uniform float uFogBegin, uFogEnd, uFogCurve, uFogDensity, uFadeMin, uFadeMax, uAlphaMul;
void main(){
  vec4 c = uColor; if (uHasTex) c *= texture(uTex, vUV);
  if (uLit) c.rgb = vec3(0.0);   // no lights, ambient / reflections from a black background
  if (uFade) c.a *= clamp(smoothstep(uFadeMin, uFadeMax, length(vViewP)), 0.0, 1.0);
  c.a *= uAlphaMul;
  if (uFogOn) { float f = pow(smoothstep(uFogBegin, uFogEnd, length(vViewP)), uFogCurve) * uFogDensity; c.rgb = mix(c.rgb, uFogColor, clamp(f, 0.0, 1.0)); }
  o = c;
}`;
// PanoramaSkyMaterial: equirectangular, cube_normal = sky rotation * view direction; fog_sky_affect mixes toward the fog colour
const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vP; void main(){ vP = aPos; gl_Position = vec4(aPos, 0.999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float; ${GLSL_COLOR} in vec2 vP; out vec4 o;
uniform mat3 uInvViewRot, uSkyRot; uniform float uTanHalf, uAspect, uSkyAffect; uniform vec3 uFogColor; uniform bool uFogOn; uniform sampler2D uTex;
const float PI = 3.14159265359;
void main(){
  vec3 d = normalize(uInvViewRot * vec3(vP.x * uTanHalf * uAspect, vP.y * uTanHalf, -1.0));
  vec3 n = uSkyRot * d;
  vec2 uv = vec2((atan(n.x, -n.z) + PI) / (2.0 * PI), acos(clamp(n.y, -1.0, 1.0)) / PI);
  vec3 c = texture(uTex, uv).rgb;
  if (uFogOn) c = mix(c, uFogColor, uSkyAffect);
  o = vec4(c, 1.0);
}`;
const BLIT_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUV; void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es
precision highp float; ${GLSL_COLOR} in vec2 vUV; uniform sampler2D uTex; out vec4 o;
void main(){ o = vec4(lin2srgb(clamp(texture(uTex, vUV).rgb, 0.0, 1.0)), 1.0); }`;

const srgb2lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linColor = (c) => [srgb2lin(c[0]), srgb2lin(c[1]), srgb2lin(c[2]), c[3] ?? 1];

// OBJ as Godot's importer reads it: faces fanned, first two indices of each triangle swapped (Godot's front faces are clockwise)
function parseOBJ(text) {
  const v = [], idx = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('f ')) {
      const f = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
      for (let i = 1; i < f.length - 1; i++) idx.push(f[i], f[0], f[i + 1]);
    }
  }
  return { pos: v, uv: null, idx };
}

// ---- small math (column-major 4x4) ----
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
// Godot Transform3D(text): basis rows then origin
const fromT3D = (t) => [t[0], t[3], t[6], 0, t[1], t[4], t[7], 0, t[2], t[5], t[8], 0, t[9], t[10], t[11], 1];
const xform = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
// Basis.FromEuler (YXZ) with scale kept from an existing basis
function eulerBasis(x, y, z) {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Ry * Rx * Rz
  const Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx], Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy], Rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  const m3 = (a, b) => { const o = new Array(9).fill(0); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k]; return o; };
  return m3(m3(Ry, Rx), Rz);
}

// ---- Godot primitive meshes (positions + UVs, triangles) ----
function planeMesh(w, d) {   // PlaneMesh (FACE_Y): uv = (x / w + 0.5, z / d + 0.5) as PlaneMesh's 1 - u / 1 - v over (-x, -z)
  const p = [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2], uv = [0, 0, 1, 0, 1, 1, 0, 1];
  return { pos: p, uv, idx: [0, 1, 2, 0, 2, 3] };
}
function quadMesh(w, h) {    // QuadMesh (FACE_Z), texture upright when seen from +Z
  const p = [-w / 2, h / 2, 0, w / 2, h / 2, 0, w / 2, -h / 2, 0, -w / 2, -h / 2, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1];
  return { pos: p, uv, idx: [0, 1, 2, 0, 2, 3] };
}
function boxMesh(sx, sy, sz) {   // BoxMesh: front (+Z) uses the atlas cell (0..1/3, 0..1/2), back (-Z) (2/3..1, 0..1/2); the other faces have no area here (size.z = 0)
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const pos = [-x, y, z, x, y, z, x, -y, z, -x, -y, z, x, y, -z, -x, y, -z, -x, -y, -z, x, -y, -z];
  const uv = [0, 0, 1 / 3, 0, 1 / 3, 0.5, 0, 0.5, 2 / 3, 0, 1, 0, 1, 0.5, 2 / 3, 0.5];
  return { pos, uv, idx: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] };
}
// GradientTexture2D (64 x 64, linear fill from -> to)
function gradientTexture2D(grad, from, to) {
  const W = 64, c = new OffscreenCanvas(W, W), g = c.getContext('2d'), img = g.createImageData(W, W);
  const dx = to[0] - from[0], dy = to[1] - from[1], l2 = dx * dx + dy * dy;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W, v = (j + 0.5) / W, t = Math.min(1, Math.max(0, ((u - from[0]) * dx + (v - from[1]) * dy) / l2));
    const col = sampleGradient(grad, t), k = (j * W + i) * 4;
    for (let n = 0; n < 4; n++) img.data[k + n] = Math.round(col[n] * 255);
  }
  g.putImageData(img, 0, 0); return c;
}
function sampleGradient(g, t) {   // Gradient (linear interpolation); offsets default [0, 1]
  const offs = g.offsets ?? [0, 1], cols = g.colors ?? [0, 0, 0, 1, 1, 1, 1, 1];
  if (t <= offs[0]) return cols.slice(0, 4);
  for (let i = 1; i < offs.length; i++) if (t <= offs[i]) { const k = (t - offs[i - 1]) / (offs[i] - offs[i - 1]); return [0, 1, 2, 3].map((n) => cols[(i - 1) * 4 + n] + (cols[i * 4 + n] - cols[(i - 1) * 4 + n]) * k); }
  return cols.slice((offs.length - 1) * 4, offs.length * 4);
}

// ---- particles (CPUParticles3D / ParticleProcessMaterial, the features used here) ----
const DEG = Math.PI / 180, lerp = (a, b, t) => a + (b - a) * t, rnd = Math.random;
class Particles {
  constructor(p, gpu) {
    const pm = gpu ? p.process : p;
    this.gpu = gpu; this.amount = p.amount ?? 8; this.lifetime = p.lifetime ?? 1; this.randomness = gpu ? pm.lifetime_randomness ?? 0 : p.lifetime_randomness ?? 0;
    this.m = pm; this.emitting = true; this.list = []; this.time = 0;
    for (let i = 0; i < this.amount; i++) this.list.push({ active: false, start: (i / this.amount) * this.lifetime });   // explosiveness 0: spread over one lifetime
    this.cycle = -1; this.process(p.preprocess ?? 0, true);
  }
  spawn(q) {
    const m = this.m;
    // emission shape: 0 point, 1 sphere, 2 sphere surface, 3 box (GPU: emission_shape_scale)
    const sc = m.emission_shape_scale ?? [1, 1, 1]; let pos = [0, 0, 0];
    if (m.emission_shape === 3) { const e = m.emission_box_extents ?? [1, 1, 1]; pos = [(rnd() * 2 - 1) * e[0], (rnd() * 2 - 1) * e[1], (rnd() * 2 - 1) * e[2]]; }
    else if (m.emission_shape === 1 || m.emission_shape === 2) {
      const r = m.emission_sphere_radius ?? 1, th = rnd() * 2 * Math.PI, ph = Math.acos(rnd() * 2 - 1), rr = m.emission_shape === 1 ? r * Math.cbrt(rnd()) : r;
      pos = [rr * Math.sin(ph) * Math.cos(th), rr * Math.sin(ph) * Math.sin(th), rr * Math.cos(ph)];
    }
    pos = [pos[0] * sc[0], pos[1] * sc[1], pos[2] * sc[2]];
    // direction with spread / flatness (CPUParticles3D::_particles_process)
    const dir = m.direction ?? [1, 0, 0], spread = m.spread ?? 45, flat = m.flatness ?? 0;
    const a1 = Math.atan2(dir[0], dir[2]) + (rnd() * 2 - 1) * spread * DEG, a2 = Math.atan2(dir[1], Math.abs(dir[2])) + (rnd() * 2 - 1) * (1 - flat) * spread * DEG;
    const yz = [0, Math.sin(a2), Math.cos(a2)]; yz[2] = yz[2] / Math.max(0.0001, Math.sqrt(Math.abs(yz[2])));
    let v = [Math.sin(a1) * yz[2], yz[1], Math.cos(a1) * yz[2]];
    const vl = Math.hypot(...v) || 1; const speed = lerp(m.initial_velocity_min ?? 0, m.initial_velocity_max ?? 0, rnd());
    v = v.map((c) => (c / vl) * speed);
    Object.assign(q, {
      active: true, pos, vel: v, age: 0,
      life: this.lifetime * (1 - rnd() * this.randomness),
      angle: lerp(m.angle_min ?? 0, m.angle_max ?? 0, rnd()) * DEG, angVel: lerp(m.angular_velocity_min ?? 0, m.angular_velocity_max ?? 0, rnd()) * DEG,
      radial: lerp(m.radial_accel_min ?? 0, m.radial_accel_max ?? 0, rnd()),
      scale: lerp(m.scale_amount_min ?? m.scale_min ?? 1, m.scale_amount_max ?? m.scale_max ?? 1, rnd()),
      hue: lerp(m.hue_variation_min ?? 0, m.hue_variation_max ?? 0, rnd()),
    });
  }
  process(dt, pre = false) {
    const step = pre ? 1 / 30 : dt; let left = dt;
    do {
      const d = Math.min(step, left); left -= d; this.time += d;
      for (const q of this.list) {
        if (!q.active) { if (this.emitting && this.time >= q.start) this.spawn(q); else continue; }
        q.age += d;
        if (q.age >= q.life) { q.active = false; q.start = this.time + (this.lifetime - q.life); if (this.emitting) { this.spawn(q); q.age = 0; } continue; }
        const r = Math.hypot(...q.pos);
        if (r > 0 && q.radial) for (let k = 0; k < 3; k++) q.vel[k] += (q.pos[k] / r) * q.radial * d;
        for (let k = 0; k < 3; k++) q.pos[k] += q.vel[k] * d;
        q.angle += q.angVel * d;
      }
    } while (left > 1e-9);
  }
  // colour: base colour x ramp(age / life), hue rotated (CPUParticles3D hue_rot_mat)
  color(q, base, ramp) {
    let c = base.slice(); const r = ramp ? sampleGradient(ramp, q.age / q.life) : [1, 1, 1, 1];
    c = [c[0] * r[0], c[1] * r[1], c[2] * r[2], c[3] * r[3]];
    if (q.hue) {
      const a = q.hue * 2 * Math.PI, hc = Math.cos(a), hs = Math.sin(a);
      const m1 = [0.299, 0.587, 0.114], m2 = [[0.701, -0.587, -0.114], [-0.299, 0.413, -0.114], [-0.300, -0.588, 0.886]], m3 = [[0.168, 0.330, -0.497], [-0.328, 0.035, 0.292], [1.250, -1.050, -0.203]];
      const rgb = [0, 1, 2].map((i) => [0, 1, 2].reduce((s, j) => s + (m1[j] + m2[i][j] * hc + m3[i][j] * hs) * c[j], 0));
      c = [...rgb, c[3]];
    }
    return c;
  }
}

// ---- the scene ----
class Scene {
  constructor(name, data, res) {
    this.name = name; this.res = res; this.sub = data.sub; this.ext = data.ext;
    this.root = null; this.nodes = new Map(); this.materials = new Map();
    for (const n of data.nodes) {
      const node = { name: n.name, type: n.type, props: n, children: [], visible: n.visible !== false, local: n.transform ? fromT3D(n.transform) : ident() };
      if (n.parent == null) { this.root = node; node.path = ''; }
      else { const parent = n.parent === '.' ? this.root : this.nodes.get(n.parent); parent.children.push(node); node.path = n.parent === '.' ? n.name : `${n.parent}/${n.name}`; }
      if (node.path) this.nodes.set(node.path, node);
      if (n.type === 'CPUParticles3D') node.particles = new Particles(n, false);
      if (n.type === 'GPUParticles3D') node.particles = new Particles({ ...n, process: this.resolve(n.process_material) }, true);
    }
    const envNode = [...this.nodes.values()].find((x) => x.type === 'WorldEnvironment');
    this.env = { ...(envNode ? this.resolve(envNode.props.environment) : {}) };
    const cam = this.nodes.get('Camera3D');
    this.camera = { fov: cam?.props.fov ?? 70, pos: [0, 0, 0] };   // BaseSpace: a new Camera3D (fov 70) when the scene has none
    this.skyRotation = [0, 0, 0];
  }
  resolve(ref) { return ref?.sub ? this.sub[ref.sub] : null; }
  node(path) { return this.nodes.get(path); }
  material(ref) {   // one shared material object per sub-resource, like Godot resources
    if (!ref?.sub) return null;
    if (!this.materials.has(ref.sub)) this.materials.set(ref.sub, { ...this.sub[ref.sub], uvOffset: [0, 0, 0] });
    return this.materials.get(ref.sub);
  }
}

export class SpaceRenderer {
  constructor(gl, app, game = false) {
    this.gl = gl; this.app = app; this.scenes = new Map(); this.textures = new Map(); this.meshes = new Map(); this.objCache = new Map();
    this.prog = compile(gl, VS, FS, 'space'); this.skyP = compile(gl, SKY_VS, SKY_FS, 'spaceSky'); this.blitP = compile(gl, BLIT_VS, BLIT_FS, 'spaceBlit');
    this.samples = ({ '2x (rough)': 2, '4x (smooth)': 4, '8x (smoothest)': 8 }[app.settings.items.AntiAliasing.Value] || 0); this.samples = Math.min(this.samples, gl.getParameter(gl.MAX_SAMPLES));
    this.full = gl.createVertexArray(); gl.bindVertexArray(this.full);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    this.white = makeTexture(gl, new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), { srgb: true });
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.startMs = performance.now(); this.last = null;
    this.coverAvg = game ? null : app.menuBg?.coverAvg ?? null;   // BaseSpace.UpdateMap (while Playing the cover isn't used)
    if (app.menuBg && !game) app.menuBg.onCover = (avg) => { this.coverAvg = avg; this.scenes.get('squircles')?.updateCover(avg); };
  }
  scene(name) {
    if (!this.scenes.has(name)) {
      const s = new Scene(name, SPACES[name], this); this.scenes.set(name, s); setup(s, this);
      for (const p of Object.values(s.ext)) if (/\.(png|obj)$/.test(p)) this.asset(p);
      if (name === 'vortex') this.asset('res://textures/squircle_blank.png');
    }
    return this.scenes.get(name);
  }
  // res:// path -> loaded texture / OBJ geometry
  asset(path) {
    if (this.textures.has(path)) return this.textures.get(path);
    this.textures.set(path, null);
    const url = 'assets/' + path.replace('res://', '');
    if (path.endsWith('.obj')) fetch(url).then((r) => r.text()).then((t) => this.textures.set(path, this.upload(parseOBJ(t))));
    else loadImage(url).then((img) => this.textures.set(path, makeTexture(this.gl, img, { srgb: true, repeat: true }))).catch(() => {});
    return null;
  }
  texture(scene, ref) {
    if (!ref) return null;
    if (ref.ext) return this.asset(scene.ext[ref.ext]);
    const r = scene.sub[ref.sub];
    if (r?.type === 'CompressedTexture2D') return this.asset(r.load_path.includes('squircle_blank') ? 'res://textures/squircle_blank.png' : r.load_path);
    if (r?.type === 'GradientTexture2D') { const key = `${scene.name}:${ref.sub}`; if (!this.textures.has(key)) this.textures.set(key, makeTexture(this.gl, gradientTexture2D(scene.sub[r.gradient.sub], r.fill_from ?? [0, 0], r.fill_to ?? [1, 0]), { srgb: true, repeat: true })); return this.textures.get(key); }
    return null;
  }
  upload(g) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    if (g.uv) { const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.uv), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0); }
    else gl.vertexAttrib2f(1, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const big = g.idx.some((i) => i > 65535); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(g.idx) : new Uint16Array(g.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.idx.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }
  // mesh resource -> [{ geo, material }] (one per surface)
  surfaces(scene, ref) {
    const key = ref.ext ? scene.ext[ref.ext] : `${scene.name}:${ref.sub}`;
    if (this.meshes.has(key)) return this.meshes.get(key);
    let out = null;
    if (ref.ext) { const g = this.asset(scene.ext[ref.ext]); if (!g) return null; out = [{ geo: g, material: null }]; }
    else {
      const m = scene.sub[ref.sub], mat = m.material ?? null;
      if (m.type === 'PlaneMesh') out = [{ geo: this.upload(planeMesh(...(m.size ?? [2, 2]))), material: mat }];
      else if (m.type === 'QuadMesh') out = [{ geo: this.upload(quadMesh(...(m.size ?? [1, 1]))), material: mat }];
      else if (m.type === 'BoxMesh') out = [{ geo: this.upload(boxMesh(...(m.size ?? [1, 1, 1]))), material: mat }];
      else if (m.type === 'ArrayMesh') out = m.surfaces.map((s) => ({ geo: this.upload({ pos: s.positions, uv: null, idx: s.indices }), material: s.material ?? null }));
      else out = [];   // SphereMesh: only on hidden nodes or zero-scale particles in these scenes
    }
    this.meshes.set(key, out); return out;
  }

  // per-frame: scripts, then draw
  frame(name, canvas, scale, settings) {
    const gl = this.gl, s = this.scene(name), now = performance.now(), dt = Math.min(0.1, this.last == null ? 0 : (now - this.last) / 1000); this.last = now;
    this.step(s, dt, settings, now - this.startMs);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * scale;
    const w = Math.max(2, Math.floor(canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.ensureTarget(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo || this.fbo); gl.viewport(0, 0, w, h);
    const bg = this.background(s);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const fov = s.camera.fov, aspect = w / h, f = 1 / Math.tan(fov * DEG / 2), n = 0.05, fa = 4000;
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0];
    const cp = s.camera.pos, view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cp[0], -cp[1], -cp[2], 1];
    const fog = this.fog(s);
    if ((s.env.background_mode ?? 0) === 2) this.drawSky(s, s.env, fog.on, fog.color, f, aspect);
    const draws = this.collect(s, view, cp);
    this.bindScene(proj, view, fog);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const opaque = draws.filter((d) => !d.transparent), trans = draws.filter((d) => d.transparent);
    trans.sort((a, b) => (a.priority - b.priority) || (b.depth - a.depth));
    gl.disable(gl.BLEND); gl.depthMask(true);
    for (const d of opaque) this.draw(d, fog.on);
    gl.enable(gl.BLEND);
    for (const d of trans) this.drawTransparent(d, fog.on);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.frontFace(gl.CCW);
    if (this.msFbo) {   // Anti Aliasing (Msaa3D): resolve the multisampled buffer into the frame texture
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    // linear -> sRGB on screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.blitP.program); gl.bindVertexArray(this.full); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbTex); gl.uniform1i(this.blitP.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
  }
  // Node._Process of the space and its particle systems
  step(s, dt, settings, ms) {
    s.process?.(dt, settings, ms);
    for (const n of s.nodes.values()) if (n.particles) n.particles.process(dt);
  }
  // background: 0 = clear colour (project default_clear_color), 1 = custom colour x energy, 2 = sky (drawn over the clear)
  background(s) {
    const env = s.env;
    return (env.background_mode ?? 0) === 1 ? linColor(env.background_color ?? [0, 0, 0, 1]).map((v, i) => (i < 3 ? v * (env.background_energy_multiplier ?? 1) : v)) : linColor([0.0885599, 0.08855992, 0.08855987, 1]);
  }
  fog(s) {
    const env = s.env;
    return { on: !!env.fog_enabled, color: linColor(env.fog_light_color ?? [0.518, 0.553, 0.608, 1]).slice(0, 3).map((v) => v * (env.fog_light_energy ?? 1)),
      begin: env.fog_depth_begin ?? 10, end: env.fog_depth_end > 0 ? env.fog_depth_end : 4000, curve: env.fog_depth_curve ?? 1, density: env.fog_density ?? 0.01 };
  }
  collect(s, view, cp) {
    const draws = [];
    const visit = (node, parent) => {
      if (!node.visible) return;
      const world = mul(parent, node.local);
      if (node.type === 'MeshInstance3D' && node.props.mesh) this.addMesh(s, node, world, view, draws);
      if (node.particles) this.addParticles(s, node, world, view, cp, draws);
      for (const c of node.children) visit(c, world);
    };
    visit(s.root, ident());
    return draws;
  }
  bindScene(proj, view, fog) {
    const gl = this.gl, u = this.prog.u; gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1i(u.uTex, 0); gl.uniform3fv(u.uFogColor, fog.color);
    gl.uniform1f(u.uFogBegin, fog.begin); gl.uniform1f(u.uFogEnd, fog.end); gl.uniform1f(u.uFogCurve, fog.curve); gl.uniform1f(u.uFogDensity, fog.density);
  }
  drawTransparent(d, fogOn) {
    const gl = this.gl;
    if (d.add) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(!!d.depthAlways); this.draw(d, fogOn);
  }

  // ---- gameplay: game.tscn (UseGameSpace, AddSpaceAsChild) adds skin.GameSpace to the Game scene, so it is part of the same world as the notes and
  // is seen by the Runner's Camera3D (BaseSpace.UpdateState(true): Camera.Current = !Playing); its WorldEnvironment is the world's environment ----
  // SceneManager.addSpace -> BaseSpace.Load (NoteHitColor = skin.NoteColors[^1]); Game: UpdateState(true), UpdateMap(map)
  gameBegin(name) { const s = this.scene(name); s.playing = true; s.hit = hitColor(this); s.updateState?.(); return s; }
  // BaseSpace._Process: if (Playing && SpaceHitEffects) NoteHitColor = NoteHitColor.Lerp(LastHitColour, min(1, delta * 8)); then the space's own _Process
  gameStep(s, dt, settings, attempt) {
    if (settings.SpaceHitEffects && attempt?.LastHitColour) { const t = Math.min(1, dt * 8), c = attempt.LastHitColour; s.hit = s.hit.map((v, i) => v + ((c[i] ?? 1) - v) * t); }
    this.step(s, dt, settings, performance.now());   // Time.GetTicksMsec
  }
  // opaque pass now; returns the transparent draws for the caller's alpha list (sorted together with the game's own objects)
  gameDraw(s, proj, view, cp, invRot, sky) {
    const gl = this.gl, fog = this.fog(s);
    if (sky && (s.env.background_mode ?? 0) === 2) this.drawSky(s, s.env, fog.on, fog.color, proj[5], proj[5] / proj[0], invRot);
    const draws = this.collect(s, view, cp);
    this.bindScene(proj, view, fog);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.depthMask(true);
    for (const d of draws) if (!d.transparent) this.draw(d, fog.on);
    gl.disable(gl.CULL_FACE); gl.frontFace(gl.CCW);
    return draws.filter((d) => d.transparent).map((d) => ({ p: d.priority, d: d.depth, draw: () => {
      this.bindScene(proj, view, fog); this.drawTransparent(d, fog.on);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.frontFace(gl.CCW);
    } }));
  }
  setMsaa(n) { this.samples = Math.min(n, this.gl.getParameter(this.gl.MAX_SAMPLES)); this.size = null; }
  ensureTarget(w, h) {
    const gl = this.gl; if (this.fbo && this.size && this.size[0] === w && this.size[1] === h) return;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fbTex); gl.deleteRenderbuffer(this.depth); }
    if (this.msFbo) { gl.deleteFramebuffer(this.msFbo); gl.deleteRenderbuffer(this.msColor); gl.deleteRenderbuffer(this.msDepth); this.msFbo = null; }
    this.size = [w, h];
    this.fbTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.fbTex); gl.texStorage2D(gl.TEXTURE_2D, 1, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    const n = this.samples || 0;
    if (n) {
      this.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
      this.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.DEPTH_COMPONENT24, w, h);
      this.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    }
  }
  drawSky(s, env, fogOn, fogColor, f, aspect, invRot = [1, 0, 0, 0, 1, 0, 0, 0, 1]) {
    const gl = this.gl, sky = this.resolveSky(s); if (!sky) return;
    gl.disable(gl.DEPTH_TEST); gl.useProgram(this.skyP.program); const u = this.skyP.u;
    gl.uniformMatrix3fv(u.uInvViewRot, false, invRot);
    const [rx, ry, rz] = s.skyRotation; gl.uniformMatrix3fv(u.uSkyRot, false, eulerBasis(rx, ry, rz));
    gl.uniform1f(u.uTanHalf, 1 / f); gl.uniform1f(u.uAspect, aspect); gl.uniform1i(u.uFogOn, fogOn ? 1 : 0); gl.uniform3fv(u.uFogColor, fogColor); gl.uniform1f(u.uSkyAffect, env.fog_sky_affect ?? 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sky); gl.uniform1i(u.uTex, 0);
    gl.bindVertexArray(this.full); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
  }
  resolveSky(s) { const sky = s.resolve(s.env.sky); const mat = sky && s.resolve(sky.sky_material); return mat ? this.texture(s, mat.panorama) : null; }

  addMesh(s, node, world, view, draws) {
    const surfs = this.surfaces(s, node.props.mesh); if (!surfs) return;
    surfs.forEach((surf, i) => {
      const matRef = node.props.material_override ?? node.props[`surface_material_override/${i}`] ?? surf.material;
      draws.push(this.makeDraw(s, surf.geo, node.matOverride ?? s.material(matRef), world, view, node.props.transparency ?? 0, null, node.props.sorting_offset ?? 0));
    });
  }
  addParticles(s, node, world, view, cam, draws) {
    const p = node.particles, props = node.props;
    const meshRef = props.mesh ?? props.draw_pass_1; if (!meshRef) return;
    const surfs = this.surfaces(s, meshRef); if (!surfs) return;
    const ramp = s.resolve(p.gpu ? p.m.color_ramp : props.color_ramp), rampG = ramp?.type === 'GradientTexture1D' ? s.resolve(ramp.gradient) : ramp;
    const base = (p.gpu ? p.m.color : props.color) ?? [1, 1, 1, 1];
    for (const q of p.list) {
      if (!q.active || q.scale === 0) continue;
      const col = p.color(q, node.colorOverride ?? base, rampG);
      let pm;
      const local = props.local_coords !== false;
      const posW = local ? xform(world, q.pos) : q.pos;
      surfs.forEach((surf, i) => {
        const mat = s.material(props.material_override ?? surf.material);
        if ((mat?.billboard_mode ?? 0) === 3) {   // particle billboard: faces the camera, rotated by the particle angle
          const c = Math.cos(q.angle), sn = Math.sin(q.angle), k = q.scale;
          pm = [k * c, k * sn, 0, 0, -k * sn, k * c, 0, 0, 0, 0, k, 0, posW[0], posW[1], posW[2], 1];
        } else {   // particle_flag_rotate_y: basis = rotation about Y by the angle, scaled; then the emitter transform (local coords)
          const c = Math.cos(q.angle), sn = Math.sin(q.angle), k = q.scale;
          const pl = [k * c, 0, -k * sn, 0, 0, k, 0, 0, k * sn, 0, k * c, 0, q.pos[0], q.pos[1], q.pos[2], 1];
          pm = local ? mul(world, pl) : pl;
        }
        const d = this.makeDraw(s, surf.geo, mat, pm, view, props.transparency ?? 0, col, props.sorting_offset ?? 0, mat?.billboard_mode === 3);
        d.depth = Math.hypot(...xform(view, [world[12], world[13], world[14]])) - (props.sorting_offset ?? 0);   // the whole system sorts as one instance
        draws.push(d);
      });
    }
  }
  makeDraw(s, geo, mat, model, view, geomTransparency, vertexColor, sortingOffset, billboard = false) {
    mat ??= {};
    if (billboard) { const vr = [view[0], view[4], view[8], 0, view[1], view[5], view[9], 0, view[2], view[6], view[10], 0, 0, 0, 0, 1]; model = mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, model[12], model[13], model[14], 1], mul(vr, [...model.slice(0, 12), 0, 0, 0, 1])); }
    let color = linColor(mat.albedo_color ?? [1, 1, 1, 1]);
    if (mat.vertex_color_use_as_albedo && vertexColor) color = [color[0] * vertexColor[0], color[1] * vertexColor[1], color[2] * vertexColor[2], color[3] * vertexColor[3]];
    const fade = (mat.distance_fade_mode ?? 0) === 1;
    const transparent = (mat.transparency ?? 0) > 0 || geomTransparency > 0 || fade || (mat.blend_mode ?? 0) !== 0;
    const centre = xform(view, [model[12], model[13], model[14]]);
    return {
      geo, mat, model, color, fade, transparent, add: (mat.blend_mode ?? 0) === 1, depthAlways: (mat.depth_draw_mode ?? 0) === 1,
      tex: this.texture(s, mat.albedo_texture), lit: (mat.shading_mode ?? 1) !== 0, fog: !mat.disable_fog, alphaMul: 1 - geomTransparency,
      uvScale: mat.uv1_scale ? [mat.uv1_scale[0], mat.uv1_scale[1]] : [1, 1], uvOff: [mat.uvOffset?.[0] ?? 0, mat.uvOffset?.[1] ?? 0],
      cull: mat.cull_mode ?? 0, priority: mat.render_priority ?? 0, depth: Math.hypot(...centre) - sortingOffset,   // sorting_offset: a higher value draws later
    };
  }
  draw(d, fogOn) {
    const gl = this.gl, u = this.prog.u;
    gl.frontFace(gl.CW);   // Godot: clockwise front faces
    if (d.cull === 2) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(d.cull === 1 ? gl.FRONT : gl.BACK); }
    gl.uniformMatrix4fv(u.uModel, false, d.model); gl.uniform2fv(u.uUvScale, d.uvScale); gl.uniform2fv(u.uUvOff, d.uvOff);
    gl.uniform4fv(u.uColor, d.color); gl.uniform1i(u.uHasTex, d.tex ? 1 : 0); gl.uniform1i(u.uLit, d.lit ? 1 : 0);
    gl.uniform1i(u.uFogOn, fogOn && d.fog ? 1 : 0); gl.uniform1i(u.uFade, d.fade ? 1 : 0);
    gl.uniform1f(u.uFadeMin, d.mat.distance_fade_min_distance ?? 0); gl.uniform1f(u.uFadeMax, d.mat.distance_fade_max_distance ?? 10); gl.uniform1f(u.uAlphaMul, d.alphaMul);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, d.tex ?? this.white);
    gl.bindVertexArray(d.geo.vao); gl.drawElements(gl.TRIANGLES, d.geo.count, d.geo.type, 0);
  }
}

// ---- scripts/spaces/*.cs ----
const hitColor = (r) => linColorNo(r.app.noteColors?.[r.app.noteColors.length - 1] ?? [1, 1, 1]);   // BaseSpace.Load: NoteHitColor = skin.NoteColors[^1]
const linColorNo = (c) => [c[0], c[1], c[2], c[3] ?? 1];   // material albedo colours are sRGB values (converted in makeDraw)
function setup(s, r) {
  const set = (ref, f) => { const m = s.material(ref); if (m) f(m); };
  const meshMat = (path) => s.resolve(s.node(path).props.mesh)?.material;
  const hc = () => (s.playing ? s.hit : hitColor(r));   // NoteHitColor: lerped while Playing (BaseSpace._Process), else the skin's last note colour
  switch (s.name) {
    case 'grid': s.process = (dt) => set(meshMat('Top'), (m) => { m.albedo_color = hc(); m.uvOffset[1] += dt * 3; }); break;   // Grid._Process
    case 'tunnel': case 'circulartunnel': {
      const rings = s.node('Rings'), o = rings.local.slice();
      s.process = (dt, st, ms) => {
        if (st.SpaceEffects) { rings.local = o.slice(); rings.local[14] = ((ms / 1000) * st.ApproachRate / 2) % 52.5; }   // Rings.Position = Back * (ticks / 1000 * AR / 2) % 52.5
        set(meshMat('Rings/1'), (m) => { m.albedo_color = hc(); });
        if (s.name === 'tunnel') { set(meshMat('Rings/2'), (m) => { m.albedo_color = hc(); }); set(meshMat('Road'), (m) => { m.albedo_color = hc(); }); }
      };
      break;
    }
    case 'tritunnel': {
      const t = s.node('Tunnel'), reset = t.local.slice(), mat = s.material(t.props.material_override), white = mat.albedo_color ?? [1, 1, 1, 1];
      s.process = (dt, st) => {
        if (t.local[14] < 148 && st.SpaceEffects) t.local[14] += st.ApproachRate * dt / 6; else t.local = reset.slice();
        mat.albedo_color = st.SpaceHitEffects ? hc() : white;
      };
      break;
    }
    case 'vortex': {
      // Vortex._Process reads Game.Instance.Runner.Attempt: before any map has been played that throws, so the squircles stay still and white;
      // after one, they turn (Rotation = Forward * ticks / 8000) and take the last attempt's hit colours
      const sq = s.node('Squircles'), kids = sq.children, mats = kids.map((k) => { const m = { ...s.resolve(s.resolve(k.props.mesh).material), uvOffset: [0, 0, 0] }; k.matOverride = m; return m; });
      const colors = (r.app.noteColors ?? [[1, 1, 1]]).slice().reverse(), last = kids.map((_, i) => linColorNo(colors[i % colors.length]));
      s.process = (dt, st, ms) => {
        const a = r.app.game?.attempt; if (!a) return;
        const lc = a.LastHitColour; if (lc && (lc[0] !== last[0][0] || lc[1] !== last[0][1] || lc[2] !== last[0][2])) { for (let i = last.length - 1; i > 0; i--) last[i] = last[i - 1]; last[0] = linColorNo(lc); }
        if (st.SpaceEffects) { const z = -ms / 8000, c = Math.cos(z), sn = Math.sin(z); sq.local = [c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
        mats.forEach((m, i) => { const cur = m.albedo_color ?? [1, 1, 1, 1]; m.albedo_color = st.SpaceHitEffects ? cur.map((v, k) => v + ((last[i][k] ?? 1) - v) * Math.min(1, dt * 6)) : [1, 1, 1, 1]; });
      };
      break;
    }
    case 'galaxy': s.process = (dt) => { s.skyRotation[0] += dt / 100; s.skyRotation[1] -= dt / 100; set(meshMat('Road'), (m) => { m.uvOffset[1] += dt / 2; }); }; break;   // SkyRotation += (Down + Right) * delta / 100
    case 'relic': s.process = (dt, st) => { for (const p of ['Particles/Aura', 'Particles/Left', 'Particles/Right']) s.node(p).particles.emitting = st.SpaceEffects; }; break;
    case 'conspiracy': {
      const icons = s.node('Icons'), iconsStart = icons.local.slice(), text = s.node('ScrollingText'), textStart = text.local.slice();
      const qm = meshMat('ScrollingQuestionMarks/Left');
      s.process = (dt, st, ms) => {
        if (st.SpaceEffects) {
          set(qm, (m) => { m.uvOffset[1] += dt / 10; });
          icons.local = iconsStart.slice(); icons.local[13] += Math.sin(ms / 1000);
          if (text.local[14] < 46) text.local[14] += dt * 2; else text.local = textStart.slice();
        }
        text.visible = !!st.SpaceEffects;
      };
      break;
    }
    case 'squircles': {
      // Squircles: the camera follows the mouse; UpdateMap: background = cover average Darkened(0.9), particles = Lightened(0.1)
      const near = s.node('ParticlesNear'), far = s.node('ParticlesFar'), def = near.props.color, defBg = s.env.background_color;
      s.updateCover = (avg) => {
        const color = avg ? [avg[0], avg[1], avg[2], 1] : def;
        s.env.background_color = avg ? [color[0] * 0.1, color[1] * 0.1, color[2] * 0.1, 1] : defBg;
        const light = [color[0] + (1 - color[0]) * 0.1, color[1] + (1 - color[1]) * 0.1, color[2] + (1 - color[2]) * 0.1, color[3]];
        near.colorOverride = light; far.colorOverride = light;
      };
      s.updateCover(r.coverAvg);
      // Playing: updateColor(NoteHitColor) every frame (background = Darkened(0.9) whatever the cover); else the camera follows the mouse
      const updateColor = (c) => { s.env.background_color = [c[0] * 0.1, c[1] * 0.1, c[2] * 0.1, 1]; const l = [c[0] + (1 - c[0]) * 0.1, c[1] + (1 - c[1]) * 0.1, c[2] + (1 - c[2]) * 0.1, c[3] ?? 1]; near.colorOverride = l; far.colorOverride = l; };
      s.process = () => { if (s.playing) updateColor(s.hit); else s.camera.pos = [(r.mouseX ?? 0) / 40000, (r.mouseY ?? 0) / 40000, 0]; };
      break;
    }
  }
}
