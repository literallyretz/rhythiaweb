// WebGL2 renderer for the gameplay view: grid space, 3x3 grid quad + guides, cursor, instanced notes.
// Notes are drawn exactly as NoteRenderer.Render computes them (depth, fade-in/out, opacity exponent).
import { compile, perspective, translate, loadImage, makeTexture, parseOBJ, GLSL_COLOR } from './gl.js';
import { HIT_WINDOW, CURSOR_SIZE } from '../constants.js';
import { HitResult } from '../map/Note.js';

const PLANE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV;
uniform mat4 uVP; uniform mat4 uView; uniform vec2 uUvOff; uniform float uUvScale;
out vec2 vUV; out vec3 vViewP;   // view-space position; fog_process uses length(vertex) per fragment
void main(){ vec4 vp = uView * vec4(aPos,1.0); vViewP = vp.xyz; vUV = aUV * uUvScale + uUvOff; gl_Position = uVP * vec4(aPos,1.0); }`;
const PLANE_FS = `#version 300 es
precision highp float; ${GLSL_COLOR}
in vec2 vUV; in vec3 vViewP; uniform sampler2D uTex; uniform vec3 uTint; uniform vec3 uFog;
uniform float uFogBegin, uFogEnd, uFogCurve, uFogDensity; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb * srgb2lin(uTint);
  float f = pow(smoothstep(uFogBegin, uFogEnd, length(vViewP)), uFogCurve) * uFogDensity;
  c = mix(c, srgb2lin(uFog), clamp(f,0.0,1.0));
  o = vec4(c, 1.0);
}`;
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform mat4 uView; uniform vec3 uCenter; uniform vec2 uSize; uniform float uRot; out vec2 vUV; out vec3 vView;
void main(){ vUV = aPos + 0.5; vUV.y = 1.0 - vUV.y; vec2 p = aPos * uSize; float c = cos(uRot), s = sin(uRot); p = vec2(p.x * c - p.y * s, p.x * s + p.y * c); vec3 w = uCenter + vec3(p, 0.0); vView = (uView * vec4(w, 1.0)).xyz; gl_Position = uVP * vec4(w, 1.0); }`;
const QUAD_FS = `#version 300 es
precision highp float; ${GLSL_COLOR}
in vec2 vUV; in vec3 vView; uniform sampler2D uTex; uniform float uAlpha; uniform float uFogOn; uniform vec3 uFog; uniform float uFogBegin, uFogEnd, uFogCurve, uFogDensity; out vec4 o;   // uFogOn: material without disable_fog
void main(){ vec4 t = texture(uTex, vUV); vec3 c = t.rgb;
  if (uFogOn > 0.5) { float f = pow(smoothstep(uFogBegin, uFogEnd, length(vView)), uFogCurve) * uFogDensity; c = mix(c, srgb2lin(uFog), clamp(f, 0.0, 1.0)); }
  o = vec4(c, t.a * uAlpha); }`;
const NOTE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 iPos; layout(location=2) in vec4 iColor;
uniform mat4 uVP; uniform float uScale; out vec4 vColor;
void main(){ vColor = iColor; gl_Position = uVP * vec4(iPos + aPos * uScale, 1.0); }`;
const NOTE_FS = `#version 300 es
precision highp float; ${GLSL_COLOR} in vec4 vColor; uniform bool uPrepass; out vec4 o;
// vertex_color_is_srgb: COLOR.rgb sRGB -> linear. depth_prepass_alpha: depth pass discards alpha < opaque_prepass_threshold (0.99)
void main(){ if (uPrepass && vColor.a < 0.99) discard; o = vec4(srgb2lin(vColor.rgb), vColor.a); }`;
// HUD quads (StandardMaterial3D unshaded alpha with a SubViewport texture, Label3D, Sprite3D): full Transform3D basis
const HUD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform vec3 uO, uBX, uBY; uniform vec2 uSize; out vec2 vUV;
void main(){ vUV = vec2(aPos.x + 0.5, 0.5 - aPos.y); gl_Position = uVP * vec4(uO + uBX * (aPos.x * uSize.x) + uBY * (aPos.y * uSize.y), 1.0); }`;
const HUD_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; out vec4 o;
void main(){ vec4 t = texture(uTex, vUV); o = vec4(t.rgb, t.a * uAlpha); }`;
const BLIT_VS = `#version 300 es
out vec2 vUV; void main(){ vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es
precision highp float; ${GLSL_COLOR} in vec2 vUV; uniform sampler2D uTex; out vec4 o;
// Environment tonemap_mode default = Linear (exposure 1, white 1): clamp, then linear -> sRGB for the 8-bit screen
void main(){ o = vec4(lin2srgb(clamp(texture(uTex, vUV).rgb, 0.0, 1.0)), 1.0); }`;

// GridGuides (settings): the + marks and faint lines; the corner brackets always draw
// Diagnostics only (not in the original): ?hdr=0 uses an 8-bit render target, ?off=prepass,notes,grid,hud skips those draws
const Q = new URLSearchParams(location.search), OFF = new Set((Q.get('off') || '').split(','));
const SHOW_SPACE = false;   // set true to restore the original space planes
export class GameRenderer {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false,   // project.godot sets no msaa_3d / screen_space_aa: Godot default is no anti-aliasing
      alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.canvas = canvas;
    this.cam = { position: [0, 0, 3.75], rotation: [0, 0, 0] };
    this.cursor = { position: [0, 0, 0], rotation: 0 };
    this.uvOffsetY = 0;
    this.noteHitColor = [1, 1, 1];
    this.planeP = compile(gl, PLANE_VS, PLANE_FS, 'plane');
    this.quadP = compile(gl, QUAD_VS, QUAD_FS, 'quad');
    this.noteP = compile(gl, NOTE_VS, NOTE_FS, 'note');
    this.blitP = compile(gl, BLIT_VS, BLIT_FS, 'blit');
    this.hudP = compile(gl, HUD_VS, HUD_FS, 'hud'); this.hudTex = new Map();
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') && Q.get('hdr') !== '0';   // RGBA16F render target (Forward+ 3D buffer format)
    this.fbo = null; this.fbW = 0; this.fbH = 0; this.samples = 0; this.msFbo = null;   // AntiAliasing: Msaa3D sample count
    this.instBuf = gl.createBuffer(); this.maxInst = 0;
  }

  async load(base = 'assets/') {
    const gl = this.gl;
    const [grid, guides, cursor, tile, obj, vis] = await Promise.all([
      loadImage(base + 'skin/game/grid.png'), loadImage(base + 'skin/game/grid_guides.png'), loadImage(base + 'skin/game/cursor.png'),
      loadImage(base + 'spaces/grid_tile.png'), fetch(base + 'meshes/squircle.obj').then((r) => r.text()), loadImage(base + 'skin/game/visibility_assist.png')]);
    this.tex = { grid: makeTexture(gl, grid), guides: makeTexture(gl, guides), cursor: makeTexture(gl, cursor), vis: makeTexture(gl, vis), tile: makeTexture(gl, tile, { repeat: true }) };
    // quad geometry (unit square centred on origin)
    this.quadVAO = gl.createVertexArray(); gl.bindVertexArray(this.quadVAO);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // grid-space planes (Top/Bottom of prefabs/spaces/grid.tscn, 120x120 at y=+-10)
    const S = 60, uvOf = (x, z) => [x / 120 + 0.5, 0.5 - z / 120]; // PlaneMesh UV on the rotated instances
    const mkPlane = (y) => { const c = [[-S, -S], [S, -S], [-S, S], [S, S]]; const d = []; for (const i of [0, 1, 2, 2, 1, 3]) { const [x, z] = c[i]; d.push(x, y, z, ...uvOf(x, z)); } return d; };
    this.planeVAO = gl.createVertexArray(); gl.bindVertexArray(this.planeVAO);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...mkPlane(-10), ...mkPlane(10)]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    this.setNoteMesh(obj);   // note mesh (squircle.obj unless the NoteMesh setting says otherwise) + instance buffer
  }

  // SkinManager.loadMesh -> Runner: MultiMesh.Mesh = Skin.NoteMesh. Only the geometry changes; instances and materials stay.
  setNoteMesh(obj) {
    const gl = this.gl;
    const pos = parseOBJ(obj); this.noteVerts = pos.length / 3;
    if (this.noteVAO) { gl.deleteVertexArray(this.noteVAO); gl.deleteBuffer(this.noteMeshBuf); }
    this.noteVAO = gl.createVertexArray(); gl.bindVertexArray(this.noteVAO);
    const nb = this.noteMeshBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  resize() {
    // ?scale=0.75 renders the 3D view at 75% resolution and lets the browser stretch it (not in the original; default 1 = window size)
    const sc = Math.min(1, Math.max(0.25, parseFloat(new URLSearchParams(location.search).get('scale')) || 1));
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * sc;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  ensureTarget(w, h) {
    const gl = this.gl;
    if (this.fbo && this.fbW === w && this.fbH === h) return;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fbTex); gl.deleteRenderbuffer(this.fbDepth); }
    this.fbTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.fbTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fbDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.fbDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fbDepth);
    this.fbW = w; this.fbH = h;
    this.ensureMsaa(w, h, true);
  }
  // Anti Aliasing (Viewport.Msaa3D): draw into multisampled buffers, then resolve into the target texture before the output blit
  setMsaa(n) { this.samples = Math.min(n, this.gl.getParameter(this.gl.MAX_SAMPLES)); if (this.fbW) this.ensureMsaa(this.fbW, this.fbH, true); }
  ensureMsaa(w, h, force) {
    const gl = this.gl;
    if (!force && (!!this.msFbo === this.samples > 0)) return;
    if (this.msFbo) { gl.deleteFramebuffer(this.msFbo); gl.deleteRenderbuffer(this.msColor); gl.deleteRenderbuffer(this.msDepth); this.msFbo = null; }
    if (!this.samples) return;
    this.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    this.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    this.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
  }

  // BaseSpace.NoteHitColor.Lerp(LastHitColour, min(1, delta*8)) + Spaces/Grid.cs uv scrolling (3 units / s)
  updateSpace(deltaSec, lastHitColour, hitEffects) {
    if (hitEffects) { const t = Math.min(1, deltaSec * 8); for (let i = 0; i < 3; i++) this.noteHitColor[i] += (lastHitColour[i] - this.noteHitColor[i]) * t; }
    this.uvOffsetY = (this.uvOffsetY + deltaSec * 3) % 1000;
  }

  // Builds the instance list exactly like NoteRenderer.Render and draws a frame.
  render(attempt, runner, progress, settings, noteColors, hudItems = []) {
    const gl = this.gl; this.resize();
    const w = this.canvas.width, h = this.canvas.height;
    this.ensureTarget(w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo || this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); // plain black background (requested; original: project.godot default_clear_color + space planes)
    gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = perspective(settings.FoV, w / h, 0.05, 4000);
    const [cx, cy, cz] = this.cam.position;
    const view = translate(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), -cx, -cy, -cz);
    const vp = mulMat(proj, view);

    // --- space ---
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.planeP.program); const pu = this.planeP.u;
    gl.uniformMatrix4fv(pu.uVP, false, vp); gl.uniformMatrix4fv(pu.uView, false, view);
    gl.uniform2f(pu.uUvOff, 0, this.uvOffsetY); gl.uniform1f(pu.uUvScale, 34);
    gl.uniform3fv(pu.uTint, this.noteHitColor); gl.uniform3f(pu.uFog, 0.0470588, 0.0313726, 0.109804);
    gl.uniform1f(pu.uFogBegin, 10); gl.uniform1f(pu.uFogEnd, 60); gl.uniform1f(pu.uFogCurve, 0.15); gl.uniform1f(pu.uFogDensity, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.tile); gl.uniform1i(pu.uTex, 0);
    if (SHOW_SPACE) { gl.bindVertexArray(this.planeVAO); gl.drawArrays(gl.TRIANGLES, 0, 12); }

    // --- alpha list (RenderForwardClustered: sort_by_reverse_depth_and_priority). Every object here is an alpha material:
    // priority ascending, then farthest first by distance camera -> AABB centre. Depth test on, no depth write
    // (depth_draw_opaque); the note MultiMesh (ALPHA_DEPTH_PRE_PASS) first writes depth for alpha >= 0.99 in the depth prepass.
    const inst = this.buildNotes(attempt, runner, progress, settings, noteColors); this.lastNoteCount = inst.length / 7;
    gl.depthFunc(gl.LEQUAL);                                   // Godot reverse-Z GREATER_OR_EQUAL
    gl.colorMask(false, false, false, false); gl.depthMask(true); gl.disable(gl.BLEND);
    if (!OFF.has('prepass')) this.drawNotes(vp, inst, settings, true);
    gl.colorMask(true, true, true, true); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const dist = (x, y, z) => Math.hypot(x - cx, y - cy, z - cz), list = [];
    if (inst.length && !OFF.has('notes')) { // MultiMesh AABB from this frame's instances (mesh extent noteSize/2 in x/y/z)
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < inst.length; i += 7) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], inst[i + k]); mx[k] = Math.max(mx[k], inst[i + k]); }
      list.push({ p: 0, d: dist((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2), draw: () => this.drawNotes(vp, inst, settings, false) });
    }
    const quad = (tex, cxq, cyq, czq, sx, sy, a, rot = 0, fog = null) => { const qu = this.quadP.u; gl.useProgram(this.quadP.program); gl.uniformMatrix4fv(qu.uVP, false, vp); gl.uniform1i(qu.uTex, 0); gl.bindVertexArray(this.quadVAO);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform3f(qu.uCenter, cxq, cyq, czq); gl.uniform2f(qu.uSize, sx, sy); gl.uniform1f(qu.uAlpha, a); gl.uniform1f(qu.uRot, rot * Math.PI / 180); gl.uniformMatrix4fv(qu.uView, false, view); gl.uniform1f(qu.uFogOn, fog ? 1 : 0); if (fog) { gl.uniform3f(qu.uFog, 0.0470588, 0.0313726, 0.109804); gl.uniform1f(qu.uFogBegin, 10); gl.uniform1f(qu.uFogEnd, 60); gl.uniform1f(qu.uFogCurve, 0.15); gl.uniform1f(qu.uFogDensity, 1); } gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    // Grid/VisibilityAssist (game.tscn): 300x300 quad at z=-140, unshaded alpha, GeometryInstance Transparency 0.25, fog NOT disabled: grid.tscn's depth fog
    // (begin 10, end 60, curve 0.15, density 1, colour fog_light_color) applied per fragment like the planes' shader
    if (this.visAssist && !OFF.has('grid')) list.push({ p: 0, d: dist(0, 0, -140), draw: () => quad(this.tex.vis, 0, 0, -140, 300, 300, 0.75, 0, true) });
    if (settings.GridGuides && !OFF.has('grid')) list.push({ p: 0, d: dist(0, 0, -0.2), draw: () => quad(this.tex.guides, 0, 0, -0.2, 4.04, 4.04, 1) });   // GridGuides: scale 1.01, z=-0.2
    if (!OFF.has('grid')) list.push({ p: 0, d: dist(0, 0, 0), draw: () => quad(this.tex.grid, 0, 0, 0, 4, 4, 1) });                                    // Grid quad 4x4
    const cs = CURSOR_SIZE * settings.CursorScale, [kx, ky] = this.cursor.position;                                          // Grid.Init: CURSOR_SIZE * CursorScale
    list.push({ p: 0, d: dist(kx, ky, 0), draw: () => quad(this.tex.cursor, kx, ky, 0, cs, cs, Math.min(Math.max(settings.CursorOpacity, 0), 1), this.cursor.rotation) });   // cursorMesh.RotationDegrees about +Z
    // TrailRenderer's CursorTrail MultiMesh (game.tscn): unshaded alpha-blended 1x1 quads scaled by the cursor size, rotated about +Z, drawn in instance order; its
    // sort depth uses the MultiMesh AABB (union of the transformed 1x1 quads) like the notes; GeometryInstance Transparency = 1 - CursorOpacity
    const tmm = this.trail?.mm;
    if (tmm && tmm.inst.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const t of tmm.inst) { const h = tmm.size * (Math.abs(Math.cos(t.rot)) + Math.abs(Math.sin(t.rot))) / 2; x0 = Math.min(x0, t.x - h); x1 = Math.max(x1, t.x + h); y0 = Math.min(y0, t.y - h); y1 = Math.max(y1, t.y + h); }
      const co = Math.min(Math.max(settings.CursorOpacity, 0), 1);
      list.push({ p: 0, d: dist((x0 + x1) / 2, (y0 + y1) / 2, 0), draw: () => { for (const t of tmm.inst) if (t.a > 0) quad(this.tex.cursor, t.x, t.y, 0, tmm.size, tmm.size, t.a * co, t.rot * 180 / Math.PI); } });
    }
    if (!OFF.has('hud')) for (const it of hudItems) list.push({ p: it.priority, d: dist(it.o[0], it.o[1], it.o[2]), draw: () => this.drawHudItem(vp, it) });
    list.sort((A, B) => (A.p === B.p ? B.d - A.d : A.p - B.p));
    gl.disable(gl.CULL_FACE);
    for (const e of list) e.draw();
    gl.depthMask(true);
    if (this.msFbo) {   // MSAA resolve
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    // --- output: linear buffer -> sRGB screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.blitP.program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbTex); gl.uniform1i(this.blitP.u.uTex, 0);
    gl.bindVertexArray(this.quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  buildNotes(attempt, runner, progress, settings, noteColors) {
    const notes = attempt.Objects.Note, start = runner.ObjectIndicesStart.Note, end = runner.ObjectIndicesEnd.Note;
    const ar = settings.ApproachRate, ad = settings.ApproachDistance, at = settings.ApproachTime;
    const fadeIn = settings.FadeIn / 100, fadeOut = settings.FadeOut / 100;
    const noteOpacity = settings.NoteOpacity, exp = Math.max(Number.EPSILON, settings.NoteOpacityExponent);
    const pushback = settings.Pushback, speed = attempt.Speed;
    const hitWindowDepth = pushback ? HIT_WINDOW * ar / 1000 : 0;
    const out = [];
    for (let i = start; i < end; i++) {                      // NoteRenderer.Process: notes[start..end], instance i = note start+i
      const n = notes[i];
      // NoteRenderer.doRender
      if (!(n.Millisecond - progress >= (pushback ? -HIT_WINDOW * speed : 0) && n.Millisecond - progress <= at * 1000 * speed) || n.LastResult === HitResult.Hit) continue;
      const depth = (n.Millisecond - progress) / (1000 * at) * ad / speed;
      const p = 1 - Math.max(0, (depth + hitWindowDepth) / (ad + hitWindowDepth));
      let opacity = 1;
      if (fadeIn > 0) opacity = Math.min(1, p / fadeIn);
      if (fadeOut > 0 && attempt.UseFadeOut) opacity -= 1 - Math.min(1, (1 - p) / fadeOut);
      const c = noteColors[n.Index % noteColors.length];
      const a = Math.min(Math.max(Math.pow(Math.max(0, opacity * noteOpacity), exp), 0), 1);
      out.push(n.X, n.Y, -depth, c[0], c[1], c[2], a);
    }
    return out;
  }

  hudTexture(it) { // ViewportTexture / font atlas / imported texture: sampled as sRGB (source_color), linear filter (+ mipmaps for imported textures that have them)
    const gl = this.gl; let e = this.hudTex.get(it.src);
    if (!e) { e = { tex: gl.createTexture(), ver: -1 }; this.hudTex.set(it.src, e); }
    if (e.ver !== it.ver) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, it.src);
      if (it.mips) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, it.mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e.ver = it.ver;
    }
    return e.tex;
  }

  drawHudItem(vp, it) {
    if (it.alpha <= 0) return;
    const gl = this.gl, u = this.hudP.u, tex = this.hudTexture(it);
    gl.useProgram(this.hudP.program); gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform3fv(u.uO, it.o); gl.uniform3fv(u.uBX, it.b[0]); gl.uniform3fv(u.uBY, it.b[1]); gl.uniform2f(u.uSize, it.w, it.h);
    gl.uniform1f(u.uAlpha, it.alpha); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uTex, 0);
    if (it.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); } else gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disable(gl.CULL_FACE);
  }

  drawNotes(vp, arr, settings, prepass) {
    const gl = this.gl, count = arr.length / 7; if (!count) return;
    gl.useProgram(this.noteP.program); gl.uniformMatrix4fv(this.noteP.u.uVP, false, vp);
    gl.uniform1f(this.noteP.u.uScale, settings.NoteSize / 2);   // Transform3D basis = noteSize/2
    gl.uniform1i(this.noteP.u.uPrepass, prepass ? 1 : 0);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.bindVertexArray(this.noteVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.noteVerts, count);
    gl.disable(gl.CULL_FACE);
  }
}

function mulMat(a, b) { const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
