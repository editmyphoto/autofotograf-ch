/* Kopie aus der Sonnenstand-3D-Engine (engine/kacheln.js), nicht hier bearbeiten: ideen/tools/build_autofotograf.py */
/* Gelände bis zum Horizont für Flüge: nah fein, fern grob.
   Gelände: swisstopo «Terrain 3D» (quantized-mesh, dieselben Kacheln wie map.geo.admin.ch in 3D, Schweiz + Grenzgebiet).
   Luftbild: SWISSIMAGE (WMTS, Web-Mercator). Beides Open Data von swisstopo (OGD), Quellenangabe «© swisstopo».
   Kachelschema geographisch (EPSG:4326, TMS): Stufe z hat 2^(z+1) × 2^z Kacheln.
   Szene: x = Ost, y = oben, z = Süd, bezogen auf einen festen Ursprung (lat0, lon0). Die Erdkrümmung ist echt (ECEF → ENU),
   darum zeigt «oben» weit weg vom Ursprung leicht schräg (Erde.up). Höhen wie in den Kacheln (≈ Meter über Meer). */
import * as THREE from './three.module.js';
import { loadImage } from './mini.js';
import { toneMap } from './mini.js';

const TERRAIN = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/';
const IMG = (z, x, y) => `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`;
const D2R = Math.PI / 180, A = 6378137, E2 = 6.69437999014e-3;
// mildere Tonkurve als in der Draufsicht (aus der Luft wirken aufgehellte Schatten flau)
const TONE = { shadows: 0.14, highlights: 0.8, gamma: 0.95 };

/* ---------- Erde: Umrechnung Grad/Höhe ↔ Szene ---------- */
export class Erde {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    const f = lat0 * D2R, l = lon0 * D2R;
    this.sf = Math.sin(f); this.cf = Math.cos(f); this.sl = Math.sin(l); this.cl = Math.cos(l);
    const N = A / Math.sqrt(1 - E2 * this.sf * this.sf);
    this.O = [N * this.cf * this.cl, N * this.cf * this.sl, N * (1 - E2) * this.sf];
  }
  /** ECEF-Richtung → Szene-Richtung */
  dirToScene(dx, dy, dz, out) {
    const { sf, cf, sl, cl } = this;
    const e = -sl * dx + cl * dy, n = -sf * cl * dx - sf * sl * dy + cf * dz, u = cf * cl * dx + cf * sl * dy + sf * dz;
    return out.set(e, u, -n);
  }
  toScene(lat, lon, h, out = new THREE.Vector3()) {
    const f = lat * D2R, l = lon * D2R, s = Math.sin(f), c = Math.cos(f), N = A / Math.sqrt(1 - E2 * s * s);
    return this.dirToScene((N + h) * c * Math.cos(l) - this.O[0], (N + h) * c * Math.sin(l) - this.O[1], (N * (1 - E2) + h) * s - this.O[2], out);
  }
  /** Szene → { lat, lon, h } (Bowring, auf Millimeter genau) */
  toGeo(v, out = {}) {
    const { sf, cf, sl, cl } = this, e = v.x, u = v.y, n = -v.z;
    const X = this.O[0] - sl * e - sf * cl * n + cf * cl * u, Y = this.O[1] + cl * e - sf * sl * n + cf * sl * u, Z = this.O[2] + cf * n + sf * u;
    const p = Math.hypot(X, Y), b = A * Math.sqrt(1 - E2), ep2 = (A * A - b * b) / (b * b), th = Math.atan2(Z * A, p * b);
    const st = Math.sin(th), ct = Math.cos(th), lat = Math.atan2(Z + ep2 * b * st * st * st, p - E2 * A * ct * ct * ct);
    const s = Math.sin(lat), N = A / Math.sqrt(1 - E2 * s * s);
    out.lat = lat / D2R; out.lon = Math.atan2(Y, X) / D2R; out.h = p / Math.cos(lat) - N;
    return out;
  }
  up(lat, lon, out = new THREE.Vector3()) { const f = lat * D2R, l = lon * D2R; return this.dirToScene(Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f), out); }
  north(lat, lon, out = new THREE.Vector3()) { const f = lat * D2R, l = lon * D2R; return this.dirToScene(-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f), out); }
  east(lat, lon, out = new THREE.Vector3()) { const l = lon * D2R; return this.dirToScene(-Math.sin(l), Math.cos(l), 0, out); }
  /** Drehung vom örtlichen System (x Ost, y oben, z Süd) am Punkt ins Szenensystem */
  basis(lat, lon) {
    const e = this.east(lat, lon), u = this.up(lat, lon), s = this.north(lat, lon).negate();
    return new THREE.Matrix4().makeBasis(e, u, s);
  }
}

/* ---------- quantized-mesh lesen ---------- */
function decodeQM(buf) {
  const dv = new DataView(buf); let o = 88;
  const minH = dv.getFloat32(24, true), maxH = dv.getFloat32(28, true);
  const n = dv.getUint32(o, true); o += 4;
  const zz = v => (v >> 1) ^ (-(v & 1));
  const rd = () => { const a = new Uint16Array(n); let acc = 0; for (let i = 0; i < n; i++) { acc += zz(dv.getUint16(o, true)); o += 2; a[i] = acc; } return a; };
  const u = rd(), v = rd(), hq = rd();
  const big = n > 65536, bs = big ? 4 : 2;
  if (o % bs) o += bs - (o % bs);
  const get = () => { const x = big ? dv.getUint32(o, true) : dv.getUint16(o, true); o += bs; return x; };
  const tc = dv.getUint32(o, true); o += 4;
  const idx = big ? new Uint32Array(tc * 3) : new Uint16Array(tc * 3);
  let hi = 0; for (let i = 0; i < tc * 3; i++) { const c = get(); idx[i] = hi - c; if (c === 0) hi++; }
  const edges = [];
  for (let k = 0; k < 4; k++) { const m = dv.getUint32(o, true); o += 4; const e = new Uint32Array(m); for (let i = 0; i < m; i++) e[i] = get(); edges.push(e); }
  const h = new Float32Array(n); for (let i = 0; i < n; i++) h[i] = minH + hq[i] / 32767 * (maxH - minH);
  return { n, u, v, h, idx, edges, minH, maxH }; // edges: West, Süd, Ost, Nord
}

const mercY = lat => { const s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }; // 0 (Nord) … 1 (Süd)

/* ---------- Schnee (Jahreszeit): Schneegrenze in m ü. M., nur auf flacheren Hängen ---------- */
export const SNOW = { line: { value: 99999 }, rwA: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -1e7, 0)) }, rwB: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -1e7, 0)) }, rwW: { value: new Array(8).fill(0) } };
/** Pisten schneefrei: bis 8 Pisten als Strecken in Szenenkoordinaten [{ a: Vector3, b: Vector3, w: halbe Breite (m) }] */
export function setClearRunways(list) {
  for (let i = 0; i < 8; i++) { const r = list[i]; SNOW.rwA.value[i].copy(r ? r.a : new THREE.Vector3(0, -1e7, 0)); SNOW.rwB.value[i].copy(r ? r.b : new THREE.Vector3(0, -1e7, 0)); SNOW.rwW.value[i] = r ? r.w : 0; }
}
function terrainMat(tex) {
  const m = new THREE.MeshLambertMaterial({ map: tex });
  m.onBeforeCompile = sh => {
    sh.uniforms.snowLine = SNOW.line; sh.uniforms.rwA = SNOW.rwA; sh.uniforms.rwB = SNOW.rwB; sh.uniforms.rwW = SNOW.rwW;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 af; varying vec2 vAF; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAF = af; vWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vAF; varying vec3 vWP; uniform float snowLine; uniform vec3 rwA[ 8 ]; uniform vec3 rwB[ 8 ]; uniform float rwW[ 8 ];')
      .replace('#include <map_fragment>', `#include <map_fragment>
{ float s = smoothstep( snowLine - 120.0, snowLine + 220.0, vAF.x ) * smoothstep( 0.5, 0.82, vAF.y );
  for ( int i = 0; i < 8; i ++ ) { vec3 ab = rwB[ i ] - rwA[ i ]; float t = clamp( dot( vWP - rwA[ i ], ab ) / max( dot( ab, ab ), 1.0 ), 0.0, 1.0 ); float d = length( vWP - rwA[ i ] - ab * t ); s *= smoothstep( rwW[ i ], rwW[ i ] + 6.0, d ); }
  float l = dot( diffuseColor.rgb, vec3( 0.33 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.94, 0.96, 0.99 ) * ( 0.82 + 0.18 * l ), s * 0.88 ); }`);
  };
  m.customProgramCacheKey = () => 'flug-gelaende';
  return m;
}

/* ---------- Kachelbaum ---------- */
class Node {
  constructor(z, x, y, parent) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    const nx = 2 ** (z + 1), ny = 2 ** z;
    this.w = -180 + x * 360 / nx; this.e = this.w + 360 / nx; this.s = -90 + y * 180 / ny; this.n = this.s + 180 / ny;
    this.state = 0; // 0 neu, 1 lädt, 2 bereit, 3 fehlt (keine Daten), 4 Fehler (später neu versuchen)
    this.children = null; this.mesh = null; this.data = null; this.used = 0; this.leaf = false;
    const lm = (this.s + this.n) / 2;
    this.sizeM = (this.e - this.w) * D2R * A * Math.cos(lm * D2R);
  }
  contains(lat, lon) { return lon >= this.w && lon <= this.e && lat >= this.s && lat <= this.n; }
  kids() {
    if (!this.children) { const { z, x, y } = this; this.children = [new Node(z + 1, 2 * x, 2 * y, this), new Node(z + 1, 2 * x + 1, 2 * y, this), new Node(z + 1, 2 * x, 2 * y + 1, this), new Node(z + 1, 2 * x + 1, 2 * y + 1, this)]; }
    return this.children;
  }
}

export class Gelaende {
  /** opts: { maxZ (Standard 17), detail (Faktor, grösser = feiner, Standard 2), conc (gleichzeitige Ladevorgänge), tex (Bildgrösse je Kachel), maxNodes } */
  constructor(scene, erde, opts = {}) {
    this.scene = scene; this.erde = erde;
    this.maxZ = opts.maxZ ?? 17; this.F = opts.detail ?? 2; this.conc = opts.conc ?? 8; this.tex = opts.tex ?? 256; this.maxNodes = opts.maxNodes ?? 700;
    this.anis = opts.anisotropy ?? 4; this.texNear = !!opts.texNear;
    this.group = new THREE.Group(); this.group.name = 'gelaende'; scene.add(this.group);
    this.frame = 0; this.busy = 0; this.loadedCount = 0; this.bytes = 0; this.requests = 0;
    // Wurzeln: Stufe 5 um die Schweiz (je ~5.6°), darüber hinaus gibt es keine Daten
    this.roots = [];
    for (let x = 32; x <= 34; x++) for (let y = 23; y <= 24; y++) this.roots.push(new Node(5, x, y, null));
    this.ready = fetch(TERRAIN + 'layer.json').then(r => r.json()).then(j => { this.tpl = TERRAIN + j.tiles[0].replace('{version}', j.version); }).catch(() => { this.tpl = TERRAIN + '20250101/{z}/{x}/{y}.terrain'; });
    this._v = new THREE.Vector3(); this._g = {};
  }

  /** Jede Bildfolge aufrufen: wählt die Kacheln nach Abstand zur Kamera, lädt nach, gibt alte frei. */
  update(camera, focus) {
    if (!this.tpl) return;
    const f = ++this.frame, want = [], cam = camera.position, fr = this._frustum ||= new THREE.Frustum();
    fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const dist = nd => Math.max(0, nd.center ? cam.distanceTo(nd.center) - nd.radius * 0.7 : 0);
    const shown = [];
    const visit = nd => {
      nd.used = f;
      if (nd.state !== 2) { if (nd.state === 0 || (nd.state === 4 && f > nd.retry)) want.push([0, nd]); return; }
      const d = dist(nd), seen = fr.intersectsSphere(nd.sphere);
      // Fokus (Flugzeug) zählt wie die Kamera: unter dem Flugzeug immer fein (Bodenkontakt)
      const df = focus ? Math.max(0, focus.distanceTo(nd.center) - nd.radius * 0.7) : Infinity;
      const split = !nd.leaf && nd.z < this.maxZ && (d < nd.sizeM * this.F * (seen ? 1 : 0.45) || df < nd.sizeM * 0.9);
      if (split) {
        const ks = nd.kids();
        if (ks.some(k => k.state === 3)) { nd.leaf = true; }
        else {
          const ok = ks.every(k => k.state === 2);
          if (ok) { for (const k of ks) visit(k); return; }
          for (const k of ks) { k.used = f; if (k.state === 0 || (k.state === 4 && f > k.retry)) want.push([(Math.min(d, df) / nd.sizeM) + (seen ? 0 : 3), k]); }
        }
      }
      shown.push(nd);
    };
    for (const r of this.roots) visit(r);
    for (const g of this.group.children) g.visible = false;
    for (const nd of shown) nd.mesh.visible = true;
    this.shown = shown.length;
    want.sort((a, b) => a[0] - b[0]);
    for (const [, nd] of want) { if (this.busy >= this.conc) break; this.load(nd); }
    this.pending = want.length;
    if (f % 60 === 0) this.evict(f);
  }

  evict(f) {
    const all = [];
    const walk = nd => { if (nd.state === 2) all.push(nd); for (const k of nd.children || []) walk(k); };
    for (const r of this.roots) walk(r);
    if (all.length <= this.maxNodes) return;
    all.sort((a, b) => a.used - b.used);
    for (const nd of all.slice(0, all.length - this.maxNodes)) { if (nd.used >= f - 2 || nd.z <= 6) continue; this.free(nd); }
  }
  free(nd) {
    if (nd.mesh) { this.group.remove(nd.mesh); nd.mesh.geometry.dispose(); nd.mesh.material.map?.dispose(); nd.mesh.material.dispose(); }
    nd.mesh = null; nd.data = null; nd.state = 0; this.loadedCount--;
  }

  async load(nd) {
    nd.state = 1; this.busy++; this.requests++;
    try {
      const url = this.tpl.replace('{z}', nd.z).replace('{x}', nd.x).replace('{y}', nd.y);
      const r = await fetch(url);
      if (r.status === 403 || r.status === 404) { nd.state = 3; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = await r.arrayBuffer(); this.bytes += buf.byteLength;
      const q = decodeQM(buf);
      const tex = await this.imagery(nd);
      this.build(nd, q, tex);
      nd.state = 2; this.loadedCount++;
    } catch (e) { nd.state = 4; nd.retry = this.frame + 120; }
    finally { this.busy--; }
  }

  async imagery(nd) {
    const T = nd.z >= 15 && this.texNear ? 512 : this.tex; // nahe Kacheln doppelt so scharf (nur PC)
    const Z = Math.min(19, nd.z + 1 + (T >= 512 ? 1 : 0)), W = 256 * 2 ** Z;
    const x0 = (nd.w + 180) / 360 * W, x1 = (nd.e + 180) / 360 * W, y0 = mercY(nd.n) * W, y1 = mercY(nd.s) * W;
    const cv = document.createElement('canvas'); cv.width = cv.height = T;
    const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.fillStyle = '#8b9478'; c2.fillRect(0, 0, T, T);
    const sx = T / (x1 - x0), sy = T / (y1 - y0), jobs = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 1e-6) / 256); tx++) for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y1 - 1e-6) / 256); ty++)
      jobs.push(loadImage(IMG(Z, tx, ty)).then(im => im && c2.drawImage(im, (tx * 256 - x0) * sx, (ty * 256 - y0) * sy, 256 * sx + 0.6, 256 * sy + 0.6)));
    await Promise.all(jobs);
    toneMap(c2, TONE);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.anis;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  build(nd, q, tex) {
    const E = this.erde, { n, u, v, h, idx, edges } = q;
    const lm = (nd.s + nd.n) / 2, om = (nd.w + nd.e) / 2, C = E.toScene(lm, om, (q.minH + q.maxH) / 2);
    const up = E.up(lm, om), my0 = mercY(nd.n), my1 = mercY(nd.s);
    const P = new Float32Array(n * 3), UV = new Float32Array(n * 2), p = this._v;
    for (let i = 0; i < n; i++) {
      const lon = nd.w + u[i] / 32767 * (nd.e - nd.w), lat = nd.s + v[i] / 32767 * (nd.n - nd.s);
      E.toScene(lat, lon, h[i], p).sub(C); P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      UV[i * 2] = u[i] / 32767; UV[i * 2 + 1] = (my1 - mercY(lat)) / (my1 - my0);
    }
    const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.BufferAttribute(P, 3)); g0.setIndex(new THREE.BufferAttribute(idx, 1));
    g0.computeVertexNormals(); const NR = g0.attributes.normal.array;
    // Schürzen an den Rändern gegen Spalten zwischen Stufen
    const skirt = Math.min(400, nd.sizeM * 0.03 + 15);
    let m = 0; for (const e of edges) m += e.length;
    const tot = n + m, P2 = new Float32Array(tot * 3), N2 = new Float32Array(tot * 3), UV2 = new Float32Array(tot * 2), AF = new Float32Array(tot * 2);
    P2.set(P); N2.set(NR); UV2.set(UV);
    for (let i = 0; i < n; i++) { AF[i * 2] = h[i]; AF[i * 2 + 1] = NR[i * 3] * up.x + NR[i * 3 + 1] * up.y + NR[i * 3 + 2] * up.z; }
    const extra = []; let k = n;
    edges.forEach((e, ei) => {
      const ord = [...e].sort((a, b) => (ei % 2 === 0 ? v[a] - v[b] : u[a] - u[b]));
      const base = k;
      for (const i of ord) {
        P2[k * 3] = P[i * 3] - up.x * skirt; P2[k * 3 + 1] = P[i * 3 + 1] - up.y * skirt; P2[k * 3 + 2] = P[i * 3 + 2] - up.z * skirt;
        N2.set(NR.subarray(i * 3, i * 3 + 3), k * 3); UV2[k * 2] = UV[i * 2]; UV2[k * 2 + 1] = UV[i * 2 + 1]; AF[k * 2] = h[i] - skirt; AF[k * 2 + 1] = AF[i * 2 + 1]; k++;
      }
      for (let j = 0; j + 1 < ord.length; j++) { const a = ord[j], b = ord[j + 1], a2 = base + j, b2 = base + j + 1; extra.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2); }
    });
    const I2 = (tot > 65535 ? new Uint32Array(idx.length + extra.length) : new Uint16Array(idx.length + extra.length)); I2.set(idx); I2.set(extra, idx.length);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P2, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N2, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(UV2, 2)); g.setAttribute('af', new THREE.BufferAttribute(AF, 2)); g.setIndex(new THREE.BufferAttribute(I2, 1));
    g.computeBoundingSphere(); g0.dispose();
    const mesh = new THREE.Mesh(g, terrainMat(tex)); mesh.position.copy(C); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.visible = false; mesh.userData.node = nd;
    this.group.add(mesh);
    nd.mesh = mesh; nd.center = C; nd.radius = g.boundingSphere.radius; nd.sphere = new THREE.Sphere(C.clone(), nd.radius);
    // Suchraster für Höhenabfragen (8 × 8 Felder → Dreiecke)
    const G = 8, cells = Array.from({ length: G * G }, () => []);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ux0 = Math.min(u[a], u[b], u[c]) / 32768 * G | 0, ux1 = Math.max(u[a], u[b], u[c]) / 32768 * G | 0;
      const vy0 = Math.min(v[a], v[b], v[c]) / 32768 * G | 0, vy1 = Math.max(v[a], v[b], v[c]) / 32768 * G | 0;
      for (let yy = vy0; yy <= vy1; yy++) for (let xx = ux0; xx <= ux1; xx++) cells[yy * G + xx].push(t);
    }
    nd.data = { u, v, h, idx, cells, G, minH: q.minH, maxH: q.maxH };
  }

  /** Geländehöhe (m ü. M.) aus der feinsten geladenen Kachel; Rückgabe { h, z } oder null */
  heightAt(lat, lon) {
    let nd = this.roots.find(r => r.contains(lat, lon));
    if (!nd || nd.state !== 2) return null;
    for (;;) { const k = nd.children?.find(c => c.state === 2 && c.contains(lat, lon)); if (!k) break; nd = k; }
    const D = nd.data, fu = (lon - nd.w) / (nd.e - nd.w) * 32767, fv = (lat - nd.s) / (nd.n - nd.s) * 32767;
    const cell = D.cells[Math.min(D.G - 1, fv / 32768 * D.G | 0) * D.G + Math.min(D.G - 1, fu / 32768 * D.G | 0)];
    const { u, v, h, idx } = D;
    for (const t of cell) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const d = (v[b] - v[c]) * (u[a] - u[c]) + (u[c] - u[b]) * (v[a] - v[c]); if (!d) continue;
      const l1 = ((v[b] - v[c]) * (fu - u[c]) + (u[c] - u[b]) * (fv - v[c])) / d, l2 = ((v[c] - v[a]) * (fu - u[c]) + (u[a] - u[c]) * (fv - v[c])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-4 && l2 >= -1e-4 && l3 >= -1e-4) return { h: l1 * h[a] + l2 * h[b] + l3 * h[c], z: nd.z };
    }
    return { h: (D.minH + D.maxH) / 2, z: nd.z - 10 };
  }

  /** Lädt die Kacheln unter einem Punkt bis zur Stufe z vor (z. B. vor dem Start auf der Piste). */
  async preload(lat, lon, z = this.maxZ, onProgress) {
    await this.ready;
    let nd = this.roots.find(r => r.contains(lat, lon));
    while (nd) {
      if (nd.state !== 2) { if (nd.state !== 1) await this.load(nd); else while (nd.state === 1) await new Promise(r => setTimeout(r, 50)); }
      if (nd.state !== 2) { if (nd.state === 3 && nd.parent) nd.parent.leaf = true; break; }
      onProgress?.(nd.z / z);
      if (nd.z >= z || nd.leaf) break;
      const ks = nd.kids();
      await Promise.all(ks.map(k => k.state === 0 || k.state === 4 ? this.load(k) : null));
      if (ks.some(k => k.state === 3)) { nd.leaf = true; break; }
      nd = ks.find(k => k.contains(lat, lon));
    }
  }
}
