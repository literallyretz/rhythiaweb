// WebGL2 renderer for the gameplay view: grid space, 3x3 grid quad + guides, cursor, instanced notes.
// Notes are drawn exactly as NoteRenderer.Render computes them (depth, fade-in/out, opacity exponent).
import { compile, perspective, translate, loadImage, makeTexture, parseOBJ, GLSL_COLOR } from './gl.js';
import { HIT_WINDOW, CURSOR_SIZE } from '../constants.js';
import { HitResult } from '../map/Note.js';

const PLANE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV;
uniform mat4 uVP; uniform mat4 uView; uniform vec2 uUvOff; uniform float uUvScale;
out vec2 vUV; out float vDist;
void main(){ vec4 vp = uView * vec4(aPos,1.0); vDist = length(vp.xyz); vUV = aUV * uUvScale + uUvOff; gl_Position = uVP * vec4(aPos,1.0); }`;
const PLANE_FS = `#version 300 es
precision highp float; ${GLSL_COLOR}
in vec2 vUV; in float vDist; uniform sampler2D uTex; uniform vec3 uTint; uniform vec3 uFog;
uniform float uFogBegin, uFogEnd, uFogCurve, uFogDensity; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb * srgb2lin(uTint);
  float f = pow(clamp((vDist - uFogBegin)/(uFogEnd - uFogBegin), 0.0, 1.0), uFogCurve) * uFogDensity;
  c = mix(c, srgb2lin(uFog), clamp(f,0.0,1.0));
  o = vec4(lin2srgb(c), 1.0);
}`;
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform vec3 uCenter; uniform vec2 uSize; out vec2 vUV;
void main(){ vUV = aPos + 0.5; vUV.y = 1.0 - vUV.y; gl_Position = uVP * vec4(uCenter + vec3(aPos * uSize, 0.0), 1.0); }`;
const QUAD_FS = `#version 300 es
precision highp float; ${GLSL_COLOR}
in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; out vec4 o;
void main(){ vec4 t = texture(uTex, vUV); o = vec4(lin2srgb(t.rgb), t.a * uAlpha); }`;
const NOTE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 iPos; layout(location=2) in vec4 iColor;
uniform mat4 uVP; uniform float uScale; out vec4 vColor;
void main(){ vColor = iColor; gl_Position = uVP * vec4(iPos + aPos * uScale, 1.0); }`;
const NOTE_FS = `#version 300 es
precision highp float; in vec4 vColor; out vec4 o; void main(){ if (vColor.a <= 0.0) discard; o = vColor; }`;

const SHOW_GUIDES = false;  // set true to restore the grid guides (the + marks and faint lines); the corner brackets always draw
const SHOW_SPACE = false;   // set true to restore the original space planes
export class GameRenderer {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.canvas = canvas;
    this.cam = { position: [0, 0, 3.75], rotation: [0, 0, 0] };
    this.cursor = { position: [0, 0, 0] };
    this.uvOffsetY = 0;
    this.noteHitColor = [1, 1, 1];
    this.planeP = compile(gl, PLANE_VS, PLANE_FS, 'plane');
    this.quadP = compile(gl, QUAD_VS, QUAD_FS, 'quad');
    this.noteP = compile(gl, NOTE_VS, NOTE_FS, 'note');
    this.instBuf = gl.createBuffer(); this.maxInst = 0;
  }

  async load(base = 'assets/') {
    const gl = this.gl;
    const [grid, guides, cursor, tile, obj] = await Promise.all([
      loadImage(base + 'skin/game/grid.png'), loadImage(base + 'skin/game/grid_guides.png'), loadImage(base + 'skin/game/cursor.png'),
      loadImage(base + 'spaces/grid_tile.png'), fetch(base + 'meshes/squircle.obj').then((r) => r.text())]);
    this.tex = { grid: makeTexture(gl, grid), guides: makeTexture(gl, guides), cursor: makeTexture(gl, cursor), tile: makeTexture(gl, tile, { repeat: true }) };
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
    // note mesh (squircle.obj) + instance buffer
    const pos = parseOBJ(obj); this.noteVerts = pos.length / 3;
    this.noteVAO = gl.createVertexArray(); gl.bindVertexArray(this.noteVAO);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // BaseSpace.NoteHitColor.Lerp(LastHitColour, min(1, delta*8)) + Spaces/Grid.cs uv scrolling (3 units / s)
  updateSpace(deltaSec, lastHitColour, hitEffects) {
    if (hitEffects) { const t = Math.min(1, deltaSec * 8); for (let i = 0; i < 3; i++) this.noteHitColor[i] += (lastHitColour[i] - this.noteHitColor[i]) * t; }
    this.uvOffsetY = (this.uvOffsetY + deltaSec * 3) % 1000;
  }

  // Builds the instance list exactly like NoteRenderer.Render and draws a frame.
  render(attempt, runner, progress, settings, noteColors) {
    const gl = this.gl; this.resize();
    const w = this.canvas.width, h = this.canvas.height;
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

    // --- notes (behind grid first, then grid layers, then notes that pushed back past the grid) ---
    const { behind, front } = this.buildNotes(attempt, runner, progress, settings, noteColors);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawNotes(vp, behind, settings);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.quadP.program); const qu = this.quadP.u;
    gl.uniformMatrix4fv(qu.uVP, false, vp); gl.uniform1i(qu.uTex, 0); gl.bindVertexArray(this.quadVAO);
    const quad = (tex, cxq, cyq, czq, sx, sy, a) => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform3f(qu.uCenter, cxq, cyq, czq); gl.uniform2f(qu.uSize, sx, sy); gl.uniform1f(qu.uAlpha, a); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    if (SHOW_GUIDES && settings.GridGuides) quad(this.tex.guides, 0, 0, -0.2, 4.04, 4.04, 1);   // GridGuides: scale 1.01, z=-0.2
    quad(this.tex.grid, 0, 0, 0, 4, 4, 1);                                        // Grid quad 4x4
    const cs = CURSOR_SIZE * settings.CursorScale;                                // Grid.Init: CURSOR_SIZE * CursorScale
    quad(this.tex.cursor, this.cursor.position[0], this.cursor.position[1], 0, cs, cs, Math.min(Math.max(settings.CursorOpacity, 0), 1));
    gl.enable(gl.DEPTH_TEST); this.drawNotes(vp, front, settings);
    gl.bindVertexArray(null);
  }

  buildNotes(attempt, runner, progress, settings, noteColors) {
    const notes = attempt.Objects.Note, start = runner.ObjectIndicesStart.Note, end = runner.ObjectIndicesEnd.Note;
    const ar = settings.ApproachRate, ad = settings.ApproachDistance, at = settings.ApproachTime;
    const fadeIn = settings.FadeIn / 100, fadeOut = settings.FadeOut / 100;
    const noteOpacity = settings.NoteOpacity, exp = Math.max(Number.EPSILON, settings.NoteOpacityExponent);
    const pushback = settings.Pushback, speed = attempt.Speed;
    const hitWindowDepth = pushback ? HIT_WINDOW * ar / 1000 : 0;
    const behind = [], front = [];
    for (let i = end - 1; i >= start; i--) {                 // far -> near
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
      (depth >= 0 ? behind : front).push(n.X, n.Y, -depth, c[0], c[1], c[2], a);
    }
    return { behind, front };
  }

  drawNotes(vp, arr, settings) {
    const gl = this.gl, count = arr.length / 7; if (!count) return;
    gl.useProgram(this.noteP.program); gl.uniformMatrix4fv(this.noteP.u.uVP, false, vp);
    gl.uniform1f(this.noteP.u.uScale, settings.NoteSize / 2);   // Transform3D basis = noteSize/2
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.depthMask(true);
    gl.bindVertexArray(this.noteVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.noteVerts, count);
    gl.disable(gl.CULL_FACE);
  }
}

function mulMat(a, b) { const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
