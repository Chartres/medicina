// The renderer: opaque tubes and spheres with an ink-like rim, and translucent "glass" surfaces
// (membranes) drawn after them. Raw WebGL, geometry rebuilt every frame from the lesson's scene().
import { PI, add, sub, mulS, dot, cross, norm, rz } from './math.ts'

const VS1 = `attribute vec3 p,n,c;uniform mat4 vp;varying vec3 vn,vc,vw;void main(){vn=n;vc=c;vw=p;gl_Position=vp*vec4(p,1.);}`
const FS1 = `precision mediump float;varying vec3 vn,vc,vw;uniform vec3 eye,light,rimC;uniform float rimA;
  void main(){vec3 N=normalize(vn),V=normalize(eye-vw);if(dot(N,V)<0.)N=-N;float d=.62+.38*dot(N,light);float rim=pow(1.-dot(N,V),2.2);
  gl_FragColor=vec4(mix(vc*d,rimC,rim*rimA),1.);}`
const VS2 = `attribute vec3 p,n;uniform mat4 vp;varying vec3 vn,vw;void main(){vn=n;vw=p;gl_Position=vp*vec4(p,1.);}`
const FS2 = `precision mediump float;varying vec3 vn,vw;uniform vec3 eye,col,par;
  void main(){vec3 N=normalize(vn);
  if(par.z<.98){float nz=.5+.5*sin(N.x*9.+1.)*sin(N.y*11.+2.)*sin(N.z*10.+.5);if(nz>par.z*1.05)discard;}
  float f=pow(1.-abs(dot(N,normalize(eye-vw))),3.);float a=(par.x+par.y*f)*min(1.,par.z*1.5);gl_FragColor=vec4(col*a,a);}`

function unitSphere(la, lo) {
  const o = [], P = (i, j) => { const a = i / la * PI, b = j / lo * 2 * PI; return [Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)] }
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); o.push(a, b, c, a, c, d) }
  return o
}
const SPH = unitSphere(7, 10), SPHG = unitSphere(18, 26)
const persp = (f, a, n, fa) => { const t = 1 / Math.tan(f / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0] }
const mul4 = (a, b) => { const o = []; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o }
const ROLL = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] // model rolled 90° about z, for tall (phone) stages

/** The drawing surface a lesson's scene() receives. With no GL context (tests) it only counts and validates. */
export function createDraw() {
  const VB = new Float32Array(9 * 260000), GB = new Float32Array(6 * 120000)
  const d = { VB, GB, vn: 0, gn: 0, glass: [], bad: 0 }
  const pv = (p, n, c) => { VB[d.vn++] = p[0]; VB[d.vn++] = p[1]; VB[d.vn++] = p[2]; VB[d.vn++] = n[0]; VB[d.vn++] = n[1]; VB[d.vn++] = n[2]; VB[d.vn++] = c[0]; VB[d.vn++] = c[1]; VB[d.vn++] = c[2] }
  const gv = (p, n) => { GB[d.gn++] = p[0]; GB[d.gn++] = p[1]; GB[d.gn++] = p[2]; GB[d.gn++] = n[0]; GB[d.gn++] = n[1]; GB[d.gn++] = n[2] }
  const glassAdd = (col, par, inner, fn) => { const a = d.gn / 6; fn(); const g = { a, n: d.gn / 6 - a, col, par }; inner ? d.glass.unshift(g) : d.glass.push(g) }
  d.begin = () => { d.vn = 0; d.gn = 0; d.glass = [] }
  d.sphere = (c, r, col) => { if (!(r > 1e-4)) return; for (const s of SPH) pv([c[0] + s[0] * r, c[1] + s[1] * r, c[2] + s[2] * r], s, col) }
  d.tube = (pts, rad, col, sides = 8, closed = false) => {
    const n = pts.length, rings = []; let N = null
    for (let i = 0; i < n; i++) {
      const t = norm(sub(pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)], pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]))
      if (!N) N = Math.abs(t[1]) < .9 ? [0, 1, 0] : [1, 0, 0]
      N = norm(sub(N, mulS(t, dot(N, t)))); const Bn = cross(t, N), r = typeof rad === 'function' ? rad(i) : rad, ring = []
      for (let k = 0; k < sides; k++) { const a = k / sides * 2 * PI, nr = add(mulS(N, Math.cos(a)), mulS(Bn, Math.sin(a))); ring.push([add(pts[i], mulS(nr, r)), nr]) }
      rings.push([ring, typeof col === 'function' ? col(i) : col])
    }
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const [A, ca] = rings[i], [C, cb] = rings[(i + 1) % n]
      for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; pv(A[k][0], A[k][1], ca); pv(A[k2][0], A[k2][1], ca); pv(C[k2][0], C[k2][1], cb); pv(A[k][0], A[k][1], ca); pv(C[k2][0], C[k2][1], cb); pv(C[k][0], C[k][1], cb) }
    }
  }
  d.glassSphere = (c, r, col, par, inner = true) => glassAdd(col, par, inner, () => { for (const s of SPHG) gv([c[0] + s[0] * r, c[1] + s[1] * r, c[2] + s[2] * r], s) })
  d.glassRevolve = (X, Xd, prof, col, par, inner = false) => glassAdd(col, par, inner, () => {
    const NS = 44, NA = 30, rows = []
    for (let i = 0; i <= NS; i++) {
      const [x, ro, na, nr] = prof(i / NS), row = []
      for (let k = 0; k < NA; k++) { const f = k / NA * 2 * PI, c = Math.cos(f), sn = Math.sin(f); row.push([X([x, ro * c, ro * sn]), Xd([na, nr * c, nr * sn])]) } rows.push(row)
    }
    for (let i = 0; i < NS; i++) for (let k = 0; k < NA; k++) {
      const a = rows[i][k], b = rows[i][(k + 1) % NA], c = rows[i + 1][(k + 1) % NA], e = rows[i + 1][k]
      gv(a[0], a[1]); gv(b[0], b[1]); gv(c[0], c[1]); gv(a[0], a[1]); gv(c[0], c[1]); gv(e[0], e[1])
    }
  })
  /** True when every coordinate written this frame is a finite number (a NaN draws nothing and hides the bug). */
  d.finite = () => { for (let i = 0; i < d.vn; i++) if (!Number.isFinite(VB[i])) return false; for (let i = 0; i < d.gn; i++) if (!Number.isFinite(GB[i])) return false; return true }
  return d
}

export function createRenderer(cv) {
  const gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false })
  if (!gl) return null
  const prog = (vs, fs) => {
    const p = gl.createProgram()
    for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh) }
    gl.linkProgram(p); return p
  }
  const P1 = prog(VS1, FS1), P2 = prog(VS2, FS2), vbuf = gl.createBuffer(), sbuf = gl.createBuffer(), U = (p, n) => gl.getUniformLocation(p, n)
  const draw = createDraw()
  let VP = null
  return {
    draw,
    /** Draw what the scene put into `draw`. cam: {az, el, T (model space), D}; look: {rimC, rimA}; tall rolls the model for phone stages. Returns nothing; use project() afterwards. */
    render(cam, look, tall) {
      const w = cv.width, h = cv.height, fov = .5
      const T = tall ? rz(cam.T, PI / 2) : cam.T
      const eye = add(T, mulS([Math.cos(cam.el) * Math.sin(cam.az), Math.sin(cam.el), Math.cos(cam.el) * Math.cos(cam.az)], cam.D))
      const z = norm(sub(eye, T)), x = norm(cross([0, 1, 0], z)), y = cross(z, x)
      const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]
      const light = norm(add(add(mulS(x, .45), mulS(y, .65)), mulS(z, .6)))
      let vp = mul4(persp(fov, w / h, .1, 40), view)
      // shading happens in model space, so bring eye and light back into it
      const eyeM = tall ? rz(eye, -PI / 2) : eye, lightM = tall ? rz(light, -PI / 2) : light
      if (tall) vp = mul4(vp, ROLL)
      VP = vp
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true)
      gl.useProgram(P1); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, draw.VB.subarray(0, draw.vn), gl.DYNAMIC_DRAW);
      ['p', 'n', 'c'].forEach((a, i) => { const l = gl.getAttribLocation(P1, a); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 36, i * 12) })
      gl.uniformMatrix4fv(U(P1, 'vp'), false, vp); gl.uniform3fv(U(P1, 'eye'), eyeM); gl.uniform3fv(U(P1, 'light'), lightM); gl.uniform3fv(U(P1, 'rimC'), look.rimC); gl.uniform1f(U(P1, 'rimA'), look.rimA)
      gl.drawArrays(gl.TRIANGLES, 0, draw.vn / 9)
      gl.useProgram(P2); gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, draw.GB.subarray(0, draw.gn), gl.DYNAMIC_DRAW);
      ['p', 'n'].forEach((a, i) => { const l = gl.getAttribLocation(P2, a); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 24, i * 12) })
      gl.uniformMatrix4fv(U(P2, 'vp'), false, vp); gl.uniform3fv(U(P2, 'eye'), eyeM)
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.CULL_FACE)
      for (const face of [gl.FRONT, gl.BACK]) {
        gl.cullFace(face)
        for (const g of (face === gl.FRONT ? [...draw.glass].reverse() : draw.glass)) { gl.uniform3fv(U(P2, 'col'), g.col); gl.uniform3fv(U(P2, 'par'), g.par); gl.drawArrays(gl.TRIANGLES, g.a, g.n) }
      }
      gl.depthMask(true)
    },
    /** Model-space point → CSS pixels on the canvas, for the last render. */
    project(p) {
      const m = VP, W = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
      return [((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / W * .5 + .5) * cv.clientWidth, (.5 - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / W * .5) * cv.clientHeight]
    },
  }
}
