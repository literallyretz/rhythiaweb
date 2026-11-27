// Home-screen background: the "waves" menu space (prefabs/spaces/waves.tscn).
// sky_noise_waves.gdshader and water_ripple.gdshader are ported 1:1 (Godot GLSL -> GLSL ES 3.00).
// Sky is rendered into an offscreen texture; the water plane then samples it like hint_screen_texture.
import { compile, loadImage, makeTexture, GLSL_COLOR } from './gl.js';
import { SNOISE } from './noise.glsl.js';

const FS_HEAD = `#version 300 es
precision highp float; ${GLSL_COLOR} ${SNOISE}`;
const FULL_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vNdc; void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const SKY_FS = FS_HEAD + `
in vec2 vNdc; uniform mat3 uRot; uniform float uTanHalf, uAspect, uTime, uCoverage, uImageLerp, uOpacity, uLod;
uniform sampler2D uImgA, uImgB; out vec4 o;
void main(){
  vec3 eye = normalize(uRot * vec3(vNdc.x * uAspect * uTanHalf, vNdc.y * uTanHalf, -1.0));
  vec3 pos = eye; pos.y = abs(pos.y); pos.y += uTime / 70.0;
  float n = clamp((snoise(pos) + 1.0) / 2.0, 0.0, 1.0);
  bool primary = mod(floor(n * 96.0), 20.0) == 0.0;
  bool secondary = mod(floor(n * 384.0), 20.0) == 0.0;
  float t = primary ? 1.0 : secondary ? 0.2 : 0.0;
  float sine = sin(uTime / 70.0) / 2.0 + 0.5;
  vec2 smp = vec2(n, sine) * 0.9 + vec2(0.05);
  vec4 img = mix(textureLod(uImgB, smp, uLod), textureLod(uImgA, smp, uLod), uImageLerp);
  vec3 color = mix(vec3(1.0, 0.1, n / 4.0), img.rgb * 1.5, img.a);
  color = mix(vec3(0.0), color, (t + (1.0 - pow(n, 100.0)) / 50.0) * uOpacity * uCoverage);
  color = mix(vec3(0.0), color, min(1.0, 2.0 * uCoverage - abs(eye.y)));
  o = vec4(lin2srgb(color), 1.0);
}`;
const BLIT_FS = `#version 300 es
precision highp float; in vec2 vNdc; uniform sampler2D uTex; out vec4 o; void main(){ o = vec4(texture(uTex, vNdc*0.5+0.5).rgb, 1.0); }`;
const WATER_VS = `#version 300 es
layout(location=0) in vec2 aPos; uniform mat4 uVP; uniform float uY, uSize; out vec3 vWorld; out vec2 vUV;
void main(){ vec3 p = vec3(aPos.x * uSize, uY, aPos.y * uSize); vWorld = p; vUV = aPos * 0.5 + 0.5; gl_Position = uVP * vec4(p, 1.0); }`;
const WATER_FS = FS_HEAD + `
in vec3 vWorld; in vec2 vUV; uniform vec3 uCam; uniform vec2 uRes; uniform float uTime, uEcho; uniform sampler2D uScreen;
out vec4 o;
float fresnelEffect(float amount, vec3 normal, vec3 view){ return pow(1.0 - clamp(dot(normalize(normal), normalize(view)), 0.0, 1.0), amount); }
void main(){
  vec3 V = uCam - vWorld;
  float fresnel = fresnelEffect(14.0, vec3(0.0, 1.0, 0.0), V);
  vec2 uv = gl_FragCoord.xy / uRes;
  float ripple = snoise(vec3(uv * (50.0 + fresnel * 100.0), uTime)) / (500.0 - fresnel * 500.0);
  uv.x += ripple; uv.y += ripple * 2.0;
  vec3 color = srgb2lin(texture(uScreen, uv).rgb) / 2.0;
  color = mix(vec3(0.0), color, fresnel);
  color = mix(color, vec3(0.1, 0.05, 0.1), fresnel * 0.25);
  float d = distance(vUV, vec2(0.5));
  if (d < uEcho * 2.0 && d > uEcho - 0.01) color = mix(srgb2lin(vec3(1.0, 0.2, 0.25)), color, min(1.0, uEcho * 5.0));
  o = vec4(lin2srgb(color), 1.0);
}`;

const ease = { quartOut: (t) => 1 - Math.pow(1 - t, 4) };

export class MenuBackground {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.canvas = canvas;
    this.sky = compile(gl, FULL_VS, SKY_FS, 'sky'); this.blit = compile(gl, FULL_VS, BLIT_FS, 'blit'); this.water = compile(gl, WATER_VS, WATER_FS, 'water');
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // water plane = same unit quad but in x/z (shader remaps aPos in [-1,1] -> [-0.5,0.5]*size via uSize)
    this.fbo = null; this.fboTex = null; this.fboSize = [0, 0];
    this.empty = makeTexture(gl, new ImageData(1, 1), { srgb: true });
    this.imgA = this.imgB = this.empty; this.imageLerp = 1;
    this.t0 = performance.now(); this.yaw = 0; this.mouseX = 0;
    this.pitch = 0; this.fov = 90; this.coverage = 0; this.echo = 0; // Waves._Ready intro state
    this.pitchTarget = 15 * Math.PI / 180;
  }
  async setCover(blob) {
    const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch((e) => { this.coverAvg = null; throw e; });
    this.coverAvg = averageColor(img);   // Solid.UpdateMap: average of the cover's non-transparent pixels
    this.imgB = this.imgA; this.imgA = makeTexture(this.gl, img, { srgb: true }); this.imageLerp = 0; this.lerpStart = performance.now();
  }
  _ensureFbo(w, h) {
    const gl = this.gl; if (this.fbo && this.fboSize[0] === w && this.fboSize[1] === h) return;
    this.fboSize = [w, h];
    if (!this.fbo) { this.fbo = gl.createFramebuffer(); this.fboTex = gl.createTexture(); }
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
  }
  // void.tscn / solid.tscn: background_mode = custom colour, no geometry. Solid: cover average Darkened(0.9), else its default colour; energy 1.2
  clear(space) {
    const gl = this.gl, w = Math.max(2, Math.floor(this.canvas.clientWidth)), h = Math.max(2, Math.floor(this.canvas.clientHeight));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    let c = [0, 0, 0];
    if (space === 'solid') {
      const base = this.coverAvg ? this.coverAvg.map((v) => v * 0.1) : [0.011764706, 0, 0.09019608];   // Color.Darkened(0.9) = rgb * (1 - 0.9)
      c = base.map((v) => { const lin = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); const o = Math.min(1, lin * 1.2);
        return o <= 0.0031308 ? o * 12.92 : 1.055 * Math.pow(o, 1 / 2.4) - 0.055; });   // background_energy_multiplier 1.2 in linear, then back to sRGB
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  frame(scale = 1) {
    const gl = this.gl, now = performance.now(), time = (now - this.t0) / 1000;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * scale;   // scale: port-only Menu Resolution (the browser stretches the canvas)
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    // Waves._Ready intro tweens: camera pitch 0->15deg & fov 90->70 (5 s, quart out); coverage 0->1 (8 s linear); echo 0->0.5 (12 s)
    const p5 = Math.min(1, time / 5); this.pitch = this.pitchTarget * ease.quartOut(p5); this.fov = 90 + (70 - 90) * ease.quartOut(p5);
    this.coverage = Math.min(1, time / 8); this.echo = Math.min(0.5, time / 12 * 0.5);
    if (this.imageLerp < 1) this.imageLerp = Math.min(1, (now - this.lerpStart) / 200);
    // Waves._Process: SkyRotation += Up * delta * centerOffset.X / 50000 (delta folded into per-frame dt)
    const dt = Math.min(0.1, (now - (this._last ?? now)) / 1000); this._last = now;
    this.yaw += dt * this.mouseX / 50000;

    this._ensureFbo(w, h);
    const aspect = w / h, tanHalf = Math.tan(this.fov * Math.PI / 360);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);
    // eye dir = Ry(-yaw) * Rx(pitch) * v   (column-major mat3)
    const Rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp], Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
    const rot = mat3mul(Ry, Rx);
    gl.bindVertexArray(this.vao); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, w, h);
    gl.useProgram(this.sky.program); const u = this.sky.u;
    gl.uniformMatrix3fv(u.uRot, false, rot); gl.uniform1f(u.uTanHalf, tanHalf); gl.uniform1f(u.uAspect, aspect); gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uCoverage, this.coverage); gl.uniform1f(u.uImageLerp, this.imageLerp); gl.uniform1f(u.uOpacity, 1); gl.uniform1f(u.uLod, 5);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.imgA); gl.uniform1i(u.uImgA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.imgB); gl.uniform1i(u.uImgB, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // to screen (through a multisampled buffer when Anti Aliasing is on: it smooths the water plane's edge, like Msaa3D)
    this._ensureMs(w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo || null); gl.viewport(0, 0, w, h);
    gl.useProgram(this.blit.program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboTex); gl.uniform1i(this.blit.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // water plane (y = -2.01, 4000 x 4000) with the camera at the origin
    const f = 1 / tanHalf, n = 0.05, fa = 4000;
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
    // view = Rx(-pitch) * Ry(yaw-free): water is world-fixed, sky rotation does not move it
    const vr = [1, 0, 0, 0, 0, cp, -sp, 0, 0, sp, cp, 0, 0, 0, 0, 1];
    gl.useProgram(this.water.program); const wu = this.water.u;
    gl.uniformMatrix4fv(wu.uVP, false, mat4mul(proj, vr)); gl.uniform1f(wu.uY, -2.01); gl.uniform1f(wu.uSize, 2000);
    gl.uniform3f(wu.uCam, 0, 0, 0); gl.uniform2f(wu.uRes, w, h); gl.uniform1f(wu.uTime, time); gl.uniform1f(wu.uEcho, this.echo);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboTex); gl.uniform1i(wu.uScreen, 0);
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (this.msFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
  }
  setMsaa(n) { this.samples = Math.min(n, this.gl.getParameter(this.gl.MAX_SAMPLES)); this.msSize = null; }
  _ensureMs(w, h) {
    const gl = this.gl, n = this.samples || 0, key = `${w}x${h}x${n}`;
    if (this.msSize === key) return; this.msSize = key;
    if (this.msFbo) { gl.deleteFramebuffer(this.msFbo); gl.deleteRenderbuffer(this.msColor); gl.deleteRenderbuffer(this.msDepth); this.msFbo = null; }
    if (!n) return;
    this.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.RGBA8, w, h);
    this.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.DEPTH_COMPONENT24, w, h);
    this.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
  }
}
function mat3mul(a, b) { const o = new Array(9).fill(0); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k]; return o; }
function mat4mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function averageColor(img) {
  const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { colorSpace: 'srgb' }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data; let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  return n ? [r / n / 255, gg / n / 255, b / n / 255] : null;
}
