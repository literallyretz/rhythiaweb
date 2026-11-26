// scripts/shaders/combo_progress.gdshader, run as-is on the MultiplierProgress Panel inside PanelLeftViewport (250x625).
// Panel rect: anchors (0.5, 0.65), offsets -128..128 -> (-3, 278.25) size 256x256. Its StyleBoxFlat has bg_color (0,0,0,0),
// so COLOR enters the shader as (0,0,0,0); UV is the position inside that rect (0..1). Output goes into a 250x625 canvas
// that is composited into the panel exactly where the Panel sits (no resampling).
const VS = `#version 300 es
in vec2 aPos; uniform vec2 uView; uniform vec4 uRect;
void main(){ vec2 p = uRect.xy + aPos * uRect.zw; gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform vec2 uView; uniform vec4 uRect;
uniform float progress; uniform vec4 colour; uniform vec4 background_colour; uniform int sides; uniform float thickness; uniform float size;
out vec4 o;
#define PI 3.14159265359
void main() {
	vec2 FRAG = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
	vec2 UV = (FRAG - uRect.xy) / uRect.zw;
	vec4 COLOR = vec4(0.0);
	vec2 points[32];
	vec2 center = vec2(0.5, 0.5);
	vec2 center_diff = UV - vec2(0.5, 0.5);
	float frag_angle = atan(-center_diff.x, center_diff.y) * (180.0 / PI) + 180.0;
	float side_angle = 360.0 / float(sides);
	for (int i = 0; i < sides; i++) {
		float angle = (360.0 / float(sides) * float(i)) * PI / 180.0;
		vec2 pos = vec2(0.0, -0.25 * size);
		vec2 rotated = vec2(cos(angle) * pos.x - sin(angle) * pos.y, sin(angle) * pos.x + cos(angle) * pos.y) + center;
		points[i] = rotated;
	}
	int a = int(frag_angle / side_angle);
	int b = a < sides - 1 ? a + 1 : 0;
	vec2 point_diff = points[a] - points[b];
	vec2 middle = (points[a] + points[b]) / 2.0;
	float dotp = dot(normalize(point_diff), UV - middle);
	float dist_to_line = distance(UV, middle + dotp * normalize(point_diff));
	float line_alpha = smoothstep((thickness / 256.0) + fwidth(dist_to_line), (thickness / 256.0) - fwidth(dist_to_line), dist_to_line);
	if (abs(dotp) <= distance(point_diff, vec2(0.0, 0.0)) / 2.0 + thickness) {
		COLOR = mix(COLOR, vec4(background_colour.rgb, 1.0), line_alpha);
	}
	if (frag_angle <= progress * 360.0) {
		COLOR = vec4(colour.rgb, COLOR.a);
	}
	o = COLOR;
}`;

export class ComboRing {
  constructor() {
    const c = this.canvas = document.createElement('canvas'); c.width = 250; c.height = 625;
    const gl = this.gl = c.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false, preserveDrawingBuffer: true });
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('combo ring: ' + gl.getShaderInfoLog(x)); return x; };
    const p = this.p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    this.u = {}; for (const n of ['uView', 'uRect', 'progress', 'colour', 'background_colour', 'sides', 'thickness', 'size']) this.u[n] = gl.getUniformLocation(p, n);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  // ShaderMaterial_x2xye defaults: background_colour (0.155,0.155,0.155), thickness 3, size 1; progress/colour/sides set by PanelLeft.cs
  draw(progress, colour, sides) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, 250, 625); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.p);
    gl.uniform2f(u.uView, 250, 625); gl.uniform4f(u.uRect, 125 - 128, 625 * 0.65 - 128, 256, 256);
    gl.uniform1f(u.progress, progress); gl.uniform4f(u.colour, colour[0], colour[1], colour[2], 1);
    gl.uniform4f(u.background_colour, 0.155, 0.155, 0.155, 1); gl.uniform1i(u.sides, sides);
    gl.uniform1f(u.thickness, 3); gl.uniform1f(u.size, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
