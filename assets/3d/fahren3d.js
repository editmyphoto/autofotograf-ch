/* Selbst fahren: eigenes Auto (markenfrei) auf der Passstrasse, Gas/Bremse, Cockpit- und Verfolger-Ansicht.
   Wie bei den Bahnfahrten: Strasse als eigene, scharfe Fläche, Häuser und Bäume von swisstopo (tiles3d.js der Engine),
   nahe Schatten per Shadow Map, Bergschatten über einen Strahl Richtung Sonne durchs Gelände.
   Wird von strecke3d.js erst geladen, wenn jemand «Selbst fahren» antippt. */
import * as THREE from './three.module.js';
import { mergeGeometries } from './addons/utils/BufferGeometryUtils.js';
import { loadCityWhere, buildingMesh, setSeason, SEASON } from './tiles3d.js';

const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const FINE = 5;            // m zwischen Punkten der Fahrlinie
const ROAD_W = 6.4;        // Strassenbreite (m)
const LANE = 1.65;         // rechte Spur: Abstand von der Mitte
const WIN = MOBILE ? 1600 : 2400; // Strasse als Fläche: so weit vor und hinter dem Auto (m)
const CITY_KEEP = 260;     // Häuser/Bäume nur so nahe an der Strasse
const VIEWS = [['cockpit', 'Cockpit'], ['hinten', 'Hinter dem Auto'], ['drohne', 'Drohne'], ['seite', 'Seitlich']];

/* ---------- Auto (eigenes, einfaches Modell) ---------- */
function makeCar(color) {
  const g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0.2, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a36, metalness: 0.8, roughness: 0.12 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.25 });
  // Karosserie aus Seitenprofilen (x = vorne, y = oben), quer extrudiert und gerundet
  const ext = (pts, w, bevel, mat) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 6 });
    geo.translate(0, 0, -(w - 2 * bevel) / 2).rotateY(Math.PI / 2); // Profil-x → Modell -z (vorne)
    geo.computeVertexNormals(); return new THREE.Mesh(geo, mat);
  };
  // Aufbau (neigt sich in Kurven und nickt beim Bremsen), Räder bleiben am Boden
  const ch = new THREE.Group(); g.add(ch); g.userData.chassis = ch;
  ch.add(ext([[2.2, 0.3], [2.3, 0.52], [2.12, 0.68], [1.1, 0.8], [-1.2, 0.86], [-2.0, 0.9], [-2.24, 0.82], [-2.27, 0.46], [-2.18, 0.3]], 1.84, 0.12, paint));
  ch.add(ext([[0.9, 0.82], [0.12, 1.24], [-0.85, 1.27], [-1.78, 0.9], [-1.7, 0.84]], 1.5, 0.08, glass));
  ch.add(ext([[0.1, 1.255], [-0.84, 1.285], [-0.82, 1.32], [0.08, 1.295]], 1.36, 0.05, paint));
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 3.2), dark); sill.position.set(0, 0.32, 0); ch.add(sill);
  // Räder: Reifen, Felge mit fünf Speichen (damit man die Drehung sieht), vorne lenkbar
  const RW = 0.34, tire = new THREE.CylinderGeometry(RW, RW, 0.25, 28).rotateZ(Math.PI / 2), wall = new THREE.CylinderGeometry(0.235, 0.235, 0.255, 24).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.285, 12).rotateZ(Math.PI / 2), spoke = new THREE.BoxGeometry(0.275, 0.2, 0.055).translate(0, 0.115, 0), ring = new THREE.TorusGeometry(0.225, 0.018, 6, 28).rotateY(Math.PI / 2);
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.3, roughness: 0.55 }), alu = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 0.35, roughness: 0.35 });
  g.userData.wheels = []; g.userData.steer = [];
  for (const [x, z, front] of [[-0.86, -1.42, 1], [0.86, -1.42, 1], [-0.86, 1.38, 0], [0.86, 1.38, 0]]) {
    const st = new THREE.Group(), w = new THREE.Group(); st.position.set(x, RW, z); st.add(w); g.add(st);
    w.add(new THREE.Mesh(tire, dark), new THREE.Mesh(wall, rimDark), new THREE.Mesh(hub, alu));
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(spoke, alu); sp.rotation.x = k * Math.PI * 2 / 5; w.add(sp); }
    for (const sx of [-0.128, 0.128]) { const r = new THREE.Mesh(ring, alu); r.position.x = sx; w.add(r); }
    g.userData.wheels.push(w); if (front) g.userData.steer.push(st);
  }
  // Lichter
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), tl = new THREE.MeshBasicMaterial({ color: 0xc0201a });
  for (const x of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), hl); h.position.set(x, 0.62, -2.31); ch.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.05), tl); t.position.set(x, 0.74, 2.29); ch.add(t);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ---------- Bäume wie bei den Bahnfahrten: Tanne (Kegel in Etagen), Lärche (schlanker, im Herbst gold, im Winter kahl), Laubbaum (Kugel).
   Unten gemischt, ab ca. 1300 m nur noch Nadelbäume. Eine Form je Art, als Instanzen. ---------- */
const TREE_GEO = (() => {
  const fin = (g, colFn) => { g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); const P = g.attributes.position, a = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) a.set(colFn(P.getY(i)), i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.computeVertexNormals(); return g; };
  const trunk = (h, r) => fin(new THREE.CylinderGeometry(r * 0.7, r, h, 5, 1, true).translate(0, h / 2, 0), () => [0.42, 0.34, 0.27]);
  const tier = (rb, yb, yt, seg, seed, droop = 0.03, jit = 0.16, lo = 0.6, hi = 1.12) => {
    const g = new THREE.ConeGeometry(rb, yt - yb, seg, 1, true).translate(0, (yb + yt) / 2, 0), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y > yt - 1e-4) continue; const an = Math.atan2(P.getZ(i), P.getX(i)), k = 1 + jit * Math.sin(an * 3 + seed) * Math.cos(an * 2 - seed * 1.7); P.setXYZ(i, P.getX(i) * k, y - droop * (0.6 + 0.4 * Math.sin(an * 5 + seed)), P.getZ(i) * k); }
    return fin(g, y => { const c = lo + (hi - lo) * Math.max(0, Math.min(1, (y - yb + droop) / (yt - yb + droop))); return [c, c, c]; });
  };
  const blob = (rx, ry, cy, seed) => { const g = new THREE.IcosahedronGeometry(1, 1), P = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.set(P.getX(i), P.getY(i), P.getZ(i)).normalize(); const k = 1 + 0.12 * (Math.sin(v.x * 7 + seed) * Math.sin(v.z * 6 - seed) + 0.5 * Math.sin(v.y * 9 + seed * 2)); P.setXYZ(i, v.x * rx * k, cy + v.y * ry * k, v.z * rx * k); }
    return fin(g, y => { const c = 0.62 + 0.5 * Math.max(0, Math.min(1, (y - (cy - ry)) / (2 * ry))); return [c, c, c]; }); };
  return {
    spruce: mergeGeometries([trunk(0.2, 0.022), tier(0.2, 0.17, 0.56, 7, 0.3), tier(0.15, 0.4, 0.8, 7, 1.9), tier(0.085, 0.64, 1.0, 6, 3.1, 0.02)]),
    larch: mergeGeometries([trunk(0.24, 0.02), tier(0.15, 0.22, 0.62, 6, 0.8, 0.05, 0.26, 0.68, 1.15), tier(0.095, 0.5, 1.0, 5, 2.6, 0.03, 0.24, 0.7, 1.15)]),
    broad: mergeGeometries([trunk(0.4, 0.026), blob(0.24, 0.34, 0.64, 1.3)]),
  };
})();
let treeMat = null;
function treeMaterial(SEASON) {
  if (treeMat) return treeMat;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.sAut = SEASON.autumn; sh.uniforms.sBare = SEASON.bare; sh.uniforms.sLine = SEASON.snowLine;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 tk; varying vec2 vTk; varying float vLy; varying float vWy; varying float vNy;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTk = tk; vLy = position.y; vNy = normal.y; vWy = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTk; varying float vLy; varying float vWy; varying float vNy; uniform float sAut; uniform float sBare; uniform float sLine;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float crown = step( 0.165, vLy ), k = vTk.x, rr = vTk.y;
  if ( k > 0.5 ) { // Lärche (1) und Laubbaum (2): Herbstfarben, im Winter kahl
    vec3 aut = k < 1.5 ? mix( vec3( 0.80, 0.58, 0.13 ), vec3( 0.86, 0.66, 0.20 ), rr ) : mix( vec3( 0.85, 0.42, 0.10 ), vec3( 0.88, 0.70, 0.16 ), rr );
    diffuseColor.rgb = mix( diffuseColor.rgb, aut * ( 0.55 + 0.45 * smoothstep( 0.3, 1.0, vLy ) ), sAut * crown );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.31, 0.27 ), sBare * crown * 0.85 ); }
  float sn = smoothstep( sLine - 120.0, sLine + 160.0, vWy ) * crown * smoothstep( 0.05, 0.6, vNy ) * ( k < 0.5 ? 0.75 : 0.45 ); // Schnee auf den Ästen
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.98 ), clamp( sn, 0.0, 1.0 ) ); }`);
  };
  m.customProgramCacheKey = () => 'paesse-baum';
  return treeMat = m;
}
/** trees: [{ x, y (Fusspunkt, m ü. M.), z, h }] im Feld-System → InstancedMeshes je Baumart */
function makeTrees(trees, SEASON) {
  const B = { spruce: [], larch: [], broad: [] };
  trees.forEach((t, k) => {
    const r = (k * 0.6180339 + Math.abs(t.x) * 0.013) % 1, alt = t.y;
    const pConi = alt < 900 ? 0.35 : alt > 1300 ? 1 : 0.35 + 0.65 * (alt - 900) / 400;   // Anteil Nadelbäume nach Höhe
    const coni = r < pConi, larch = coni && alt > 1400 && (r * 7.13) % 1 < 0.36;
    B[!coni ? 'broad' : larch ? 'larch' : 'spruce'].push([t.x, t.y - 0.3, t.z, Math.max(3, Math.min(38, t.h)), r, !coni ? 2 : larch ? 1 : 0]);
  });
  const out = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  for (const kind of ['spruce', 'larch', 'broad']) {
    const list = B[kind]; if (!list.length) continue;
    const src = TREE_GEO[kind], geo = new THREE.BufferGeometry(); for (const a of ['position', 'normal', 'color']) geo.setAttribute(a, src.attributes[a]);
    geo.setAttribute('tk', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(e => [e[5], e[4]])), 2));
    const im = new THREE.InstancedMesh(geo, treeMaterial(SEASON), list.length);
    list.forEach(([x, y, z, h, r, kk], i) => {
      q.setFromAxisAngle(up, r * 6.283); if (kind === 'broad') h = Math.min(h, 18 + r * 6); const w = kind !== 'broad' ? h * (0.85 + r * 0.3) : h * (0.62 + r * 0.22);
      im.setMatrixAt(i, m.compose(p.set(x, y, z), q, sc.set(w, h, w)));
      im.setColorAt(i, kk === 1 ? col.setHSL(0.24 + r * 0.03, 0.34, 0.27 + r * 0.05) : kind === 'spruce' ? col.setHSL(0.29 + r * 0.04, 0.30, 0.17 + r * 0.06) : col.setHSL(0.22 + r * 0.05, 0.34, 0.27 + r * 0.07));
    });
    im.castShadow = im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; out.push(im);
  }
  return out;
}

/* ---------- Strasse: Fläche mit Rand- und Mittellinien (Shader) ---------- */
function roadMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, { W: { value: ROAD_W }, snow: { value: 0 }, tun: { value: 0 }, headOn: { value: 0 }, headPos: { value: new THREE.Vector3() }, headDir: { value: new THREE.Vector3(0, 0, -1) } }]),
    lights: true, fog: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: `#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() { vUv = uv; vec3 transformedNormal = normalMatrix * normal; vN = transformedNormal;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0); vW = worldPosition.xyz; vec4 mvPosition = viewMatrix * worldPosition; gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`,
    fragmentShader: `#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float W; uniform float snow; uniform float tun; uniform float headOn; uniform vec3 headPos; uniform vec3 headDir; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  float x = vUv.x * W * 0.5, d = vUv.y;   // x: Meter quer zur Mitte, d: Meter entlang
  vec3 c = vec3(0.30, 0.31, 0.32) + (hash(floor(vec2(x * 6.0, d * 6.0))) - 0.5) * 0.035;
  float ax = abs(x);
  c *= 1.0 - 0.12 * smoothstep(1.2, 0.2, abs(ax - ${LANE.toFixed(2)}));       // Fahrspuren etwas dunkler
  float edge = smoothstep(0.06, 0.0, abs(ax - (W * 0.5 - 0.32)) - 0.06);
  float mid = step(ax, 0.07) * step(mod(d, 9.0), 3.0);
  c = mix(c, vec3(0.92), max(edge, mid) * 0.95);
  // Bankett (Kies/Gras) ausserhalb der Fahrbahn, läuft weich ins Gelände aus
  float sh0 = smoothstep(W * 0.5 - 0.05, W * 0.5 + 0.25, ax);
  vec3 bank = mix(vec3(0.36, 0.35, 0.31), vec3(0.30, 0.34, 0.24), smoothstep(W * 0.5 + 0.4, W * 0.5 + 1.6, ax)) + (hash(floor(vec2(x * 3.0, d * 3.0))) - 0.5) * 0.05;
  bank = mix(bank, vec3(0.93, 0.95, 0.98), snow);                          // Winter: Schnee am Strassenrand, Fahrbahn geräumt (nass, dunkler)
  c = mix(c, c * 0.8, snow * (1.0 - sh0));
  c = mix(c, bank, sh0);
  float a = 1.0 - smoothstep(W * 0.5 + 1.8, W * 0.5 + 3.1, ax);
  vec3 L = directionalLights[0].direction; float dif = max(dot(normalize(vN), L), 0.0);
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    sh = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
  #endif
  vec3 li = ambientLightColor + hemisphereLights[0].skyColor * 0.55 + directionalLights[0].color * dif * sh;
  li = mix(li, vec3(0.40, 0.37, 0.33), tun);                               // im Tunnel: Lampenlicht statt Tageslicht
  vec3 toP = vW - headPos; float hd = length(toP) + 0.01; float cone = smoothstep(0.78, 0.97, dot(toP / hd, normalize(headDir)));
  li += headOn * cone * vec3(1.0, 0.95, 0.84) * 1.5 / (1.0 + hd * hd * 0.0035); // Scheinwerferkegel
  vec3 col = c * li;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

export async function startFahren(ctx) {
  const { scene, camera, renderer, erde, R, S, O, root, sunL } = ctx, terrain = ctx.terrain;
  const $ = s => root.querySelector(s);
  const D = {}; // Rückgabe-Objekt (S.drive)

  /* Fahrlinie: Catmull-Rom über die 25-m-Punkte, alle 5 m (lat, lon, Höhe der Strecke) */
  const src = R.pts, line = [], KF = Math.round(R.data.step / FINE);
  if (R.data.fein && R.data.fein.length > 2) {
    // Genauer Strassenverlauf (alle OSM-Stützpunkte, Feld "fein"): alle 5 m entlang der echten Linie, Ecken leicht gerundet.
    // Die 25-m-Punkte allein schneiden in engen Dorfkurven durch Häuser.
    const Fp = R.data.fein, la0 = Fp[0][0], lo0 = Fp[0][1], my = 110574, mx = 111320 * Math.cos(la0 * Math.PI / 180);
    const X = Fp.map(p => (p[1] - lo0) * mx), Y = Fp.map(p => (p[0] - la0) * my), cum = [0];
    for (let i = 1; i < Fp.length; i++) cum.push(cum[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]));
    const Lf = cum[cum.length - 1], n = (src.length - 1) * KF + 1, px = new Float64Array(n), py = new Float64Array(n);
    for (let k = 0, j = 0; k < n; k++) { const sArc = k / (n - 1) * Lf; while (j < cum.length - 2 && cum[j + 1] < sArc) j++; const t = (sArc - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); px[k] = X[j] + (X[j + 1] - X[j]) * t; py[k] = Y[j] + (Y[j + 1] - Y[j]) * t; }
    for (let pass = 0; pass < 2; pass++) { let ax = px[0], ay = py[0]; for (let k = 1; k < n - 1; k++) { const nx = 0.25 * ax + 0.5 * px[k] + 0.25 * px[k + 1], ny = 0.25 * ay + 0.5 * py[k] + 0.25 * py[k + 1]; ax = px[k]; ay = py[k]; px[k] = nx; py[k] = ny; } }
    for (let k = 0; k < n; k++) { const fi = k / KF, i = Math.min(src.length - 2, Math.floor(fi)), t = fi - i; line.push([la0 + py[k] / my, lo0 + px[k] / mx, lerp(src[i][2], src[i + 1][2], t)]); }
  } else {
    for (let i = 0; i < src.length - 1; i++) {
      const p0 = src[Math.max(0, i - 1)], p1 = src[i], p2 = src[i + 1], p3 = src[Math.min(src.length - 1, i + 2)];
      const n = Math.round(R.data.step / FINE);
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        line.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), lerp(p1[2], p2[2], t)]);
      }
    }
    line.push(src[src.length - 1]);
  }
  const N = line.length, L = (N - 1) * FINE, Hs = new Float32Array(N), Hok = new Uint8Array(N);
  const P = line.map(p => erde.toScene(p[0], p[1], p[2])), UP = line.map(p => erde.up(p[0], p[1]));
  // Höhe der Strasse: Gelände, wenn es nahe an der Streckenhöhe liegt (sonst Tunnel/Brücke: Streckenhöhe)
  // Rohwert: das höchste Gelände quer über die Fahrbahn (Mitte und beide Ränder), damit kein Hang in die Strasse ragt.
  const Hraw = new Float32Array(N), _g = {}, _e = new THREE.Vector3(), _sd = new THREE.Vector3(), _dd = new THREE.Vector3();
  function groundAtOffset(i, off) { // Geländehöhe quer zur Strasse (off in m, + = rechts); null, wenn noch kein feines Gelände da ist
    dirAt(i * FINE, _dd); _sd.crossVectors(_dd, UP[i]).normalize();
    erde.toGeo(_e.copy(P[i]).addScaledVector(_sd, off), _g); const h = terrain.heightAt(_g.lat, _g.lon);
    return h && h.z >= 15 ? h.h : null;
  }
  function roadH(i) {
    if (tunnelAt(i * FINE)) return Hraw[i]; // im Tunnel: gerade zwischen den Portalen (siehe smoothRoad), nicht über den Berg
    const h = terrain.heightAt(line[i][0], line[i][1]);
    if (h && h.z >= 15) { // ausserhalb von Tunnels gilt immer das Gelände (die Streckenhöhen sind an steilen Stellen nur geschätzt)
      if (Hok[i] !== h.z) { const l = groundAtOffset(i, -ROAD_W / 2), r = groundAtOffset(i, ROAD_W / 2); Hraw[i] = Math.max(h.h, Math.min(h.h + 2.5, l ?? h.h), Math.min(h.h + 2.5, r ?? h.h)); Hok[i] = h.z; }
    } else if (!Hok[i]) Hraw[i] = line[i][2];
    return Hraw[i];
  }
  for (let i = 0; i < N; i++) { Hs[i] = line[i][2]; Hraw[i] = line[i][2]; }
  /** Strasse glätten: keine Buckel und Löcher. Gleitendes Mittel über ±40 m (zweimal), dann so weit anheben,
      dass die Strasse überall über dem Gelände liegt (Anhebung selbst wieder geglättet, höchstens 1,8 m). */
  function smoothRoad(a, b) {
    a = Math.max(0, a); b = Math.min(N - 1, b); const n = b - a + 1; if (n < 3) return;
    for (const t of TUN) { // Tunnels: Höhe gerade von Portal zu Portal
      if (t.b < a || t.a > b) continue;
      const p0 = Math.max(0, t.a - 1), p1 = Math.min(N - 1, t.b + 1), h0 = roadH(p0), h1 = roadH(p1);
      for (let k = t.a; k <= t.b; k++) Hraw[k] = h0 + (h1 - h0) * (k - p0) / (p1 - p0);
    }
    const box = (src, r) => { const out = new Float32Array(n), pre = new Float64Array(n + 1); for (let k = 0; k < n; k++) pre[k + 1] = pre[k] + src[k]; for (let k = 0; k < n; k++) { const lo = Math.max(0, k - r), hi = Math.min(n - 1, k + r); out[k] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); } return out; };
    const raw = Hraw.subarray(a, b + 1), sm = box(box(raw, 8), 8), lift = new Float32Array(n);
    for (let k = 0; k < n; k++) { let m = 0; for (let q = Math.max(0, k - 5); q <= Math.min(n - 1, k + 5); q++) m = Math.max(m, raw[q] - sm[q]); lift[k] = Math.min(1.8, m); }
    const ls = box(box(lift, 6), 6);
    // am Fensterrand weich in die bisherigen Werte übergehen (sonst Stufe)
    for (let k = 0; k < n; k++) { const w = Math.min(1, a > 0 ? k / 12 : 1, b < N - 1 ? (n - 1 - k) / 12 : 1), v = sm[k] + ls[k] + 0.08; Hs[a + k] = w >= 1 ? v : Hs[a + k] * (1 - w) + v * w; }
  }
  const at = (s) => { const f = clamp(s / FINE, 0, N - 1.001), i = Math.floor(f); return [i, f - i]; };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _u = new THREE.Vector3();
  /** Punkt auf der Strasse (Szene), seitlich versetzt (+ = rechts in Fahrtrichtung) */
  function point(s, side, out = new THREE.Vector3()) {
    const [i, f] = at(s), j = Math.min(N - 1, i + 1);
    const h = lerp(Hs[i], Hs[j], f);
    const la = lerp(line[i][0], line[j][0], f), lo = lerp(line[i][1], line[j][1], f);
    erde.toScene(la, lo, h, out);
    if (side) { const d = dirAt(s, _a), u = UP[i]; _b.crossVectors(d, u).normalize(); out.addScaledVector(_b, side); }
    return out;
  }
  function dirAt(s, out = new THREE.Vector3()) {
    const [i] = at(s), a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 2)];
    out.copy(b).sub(a); const u = UP[i]; out.addScaledVector(u, -out.dot(u)); return out.normalize();
  }
  function curvature(s) { // 1/m, über ±15 m
    const a = dirAt(s - 15, new THREE.Vector3()), b = dirAt(s + 15, new THREE.Vector3());
    return Math.acos(clamp(a.dot(b), -1, 1)) / 30;
  }
  const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3();
  /** Krümmung mit Vorzeichen (+ = Linkskurve), über ±w m */
  function curveSigned(s, w = 8) {
    const a = dirAt(s - w, _c1), b = dirAt(s + w, _c2), [i] = at(s);
    return Math.sign(_c3.crossVectors(a, b).dot(UP[i])) * Math.acos(clamp(a.dot(b), -1, 1)) / (2 * w);
  }

  /* Strasse als Fläche (Fenster um das Auto, wird nachgeführt) */
  const roadMat = roadMaterial(); let road = null, roadFrom = -1, roadZ = 0, roadVer = 0;
  function buildRoad(s) {
    const i0 = Math.max(0, Math.floor((s - WIN * 0.4) / FINE)), i1 = Math.min(N - 1, Math.ceil((s + WIN) / FINE));
    for (let i = Math.max(0, i0 - 30); i <= Math.min(N - 1, i1 + 30); i++) roadH(i);
    smoothRoad(i0 - 30, i1 + 30);
    // Querschnitt: Bankett – Fahrbahn – Bankett. Das Bankett fällt bis aufs Gelände ab (Damm), so schwebt die Strasse nirgends.
    const SH = 3.2, UX = 1 + SH / (ROAD_W / 2), n = i1 - i0 + 1, pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), nor = new Float32Array(n * 4 * 3), idx = [];
    const v = new THREE.Vector3(), side = new THREE.Vector3(), d = new THREE.Vector3(), w = new THREE.Vector3();
    const C = P[i0].clone();
    for (let k = 0; k < n; k++) {
      const i = i0 + k, h = Hs[i] + 0.12;
      erde.toScene(line[i][0], line[i][1], h, v);
      dirAt(i * FINE, d); side.crossVectors(d, UP[i]).normalize();
      const cols = [[-ROAD_W / 2 - SH, -UX], [-ROAD_W / 2, -1], [ROAD_W / 2, 1], [ROAD_W / 2 + SH, UX]];
      for (let q = 0; q < 4; q++) {
        w.copy(v).addScaledVector(side, cols[q][0]);
        if (q === 0 || q === 3) { const gh = Hok[i] ? groundAtOffset(i, cols[q][0]) : null; w.addScaledVector(UP[i], -(gh == null ? 0.6 : clamp(h - gh + 0.25, 0.3, 9))); }
        w.sub(C); pos.set([w.x, w.y, w.z], (k * 4 + q) * 3); uv.set([cols[q][1], i * FINE], (k * 4 + q) * 2); nor.set([UP[i].x, UP[i].y, UP[i].z], (k * 4 + q) * 3);
      }
      if (k < n - 1) for (let q = 0; q < 3; q++) { const a = k * 4 + q; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
    if (road) { scene.remove(road); road.geometry.dispose(); }
    road = new THREE.Mesh(g, roadMat); road.position.copy(C); road.receiveShadow = true; road.renderOrder = 2; road.frustumCulled = false; scene.add(road);
    roadFrom = s; roadZ = terrain.loadedCount; roadVer++;
  }

  /** Gebäude entfernen, deren Grundriss einen der Punkte pts (x, z, x, z, …) enthält. Punkte in einem 8-m-Raster,
      damit jedes Dreieck nur wenige Punkte prüfen muss. Entfernt wird das ganze Gebäude (Gebäudenummer _batchid). */
  function clearRoad(parts, pts, axis, rad) {
    if (!pts.length) return parts;
    // zusätzlich: jede Haus-Ecke näher als rad an der Strassenachse (axis: x, z, …) → Gebäude weg (fängt schmale Bauten und Vorsprünge, die zwischen den Prüfpunkten liegen)
    const AC = 6, agrid = new Map(), akey = (i, j) => i * 73856093 ^ j * 19349663;
    for (let k = 0; k < axis.length; k += 2) { const kk = akey(Math.floor(axis[k] / AC), Math.floor(axis[k + 1] / AC)); (agrid.get(kk) || agrid.set(kk, []).get(kk)).push(axis[k], axis[k + 1]); }
    const nearAxis = (x, z) => { const ci = Math.floor(x / AC), cj = Math.floor(z / AC), r2 = rad * rad; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = agrid.get(akey(ci + a, cj + b)); if (!c) continue; for (let q = 0; q < c.length; q += 2) { const dx = c[q] - x, dz = c[q + 1] - z; if (dx * dx + dz * dz < r2) return true; } } return false; };
    const CELL = 8, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
    for (let k = 0; k < pts.length; k += 2) { const kk = key(Math.floor(pts[k] / CELL), Math.floor(pts[k + 1] / CELL)); (grid.get(kk) || grid.set(kk, []).get(kk)).push(pts[k], pts[k + 1]); }
    return parts.map(g => {
      const Pa = g.attributes.position, B = g.attributes._batchid, a = Pa.array, ids = new Set(); let whole = false;
      for (let i = 0; i + 2 < a.length; i += 3) { if (B && ids.has(Math.round(B.array[i / 3]))) continue; if (nearAxis(a[i], a[i + 2])) { if (B) ids.add(Math.round(B.array[i / 3])); else { whole = true; break; } } }
      for (let i = 0; i + 8 < a.length && !whole; i += 9) {
        const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
        if (Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) < 0.5) continue; // Wand (senkrecht): kein Grundriss
        if (B && ids.has(Math.round(B.array[i / 3]))) continue;
        const i0 = Math.floor(Math.min(ax, bx, cx) / CELL), i1 = Math.floor(Math.max(ax, bx, cx) / CELL), j0 = Math.floor(Math.min(az, bz, cz) / CELL), j1 = Math.floor(Math.max(az, bz, cz) / CELL);
        if (i1 - i0 > 12 || j1 - j0 > 12) continue;
        hit: for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) { const c = grid.get(key(ii, jj)); if (!c) continue;
          for (let q = 0; q < c.length; q += 2) { const x = c[q], z = c[q + 1];
            const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
            if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { if (B) ids.add(Math.round(B.array[i / 3])); else whole = true; break hit; } } }
      }
      if (whole) { const sz = (g.boundingBox || (g.computeBoundingBox(), g.boundingBox)).getSize(new THREE.Vector3()); return Math.max(sz.x, sz.z) < 60 ? null : g; }
      if (!ids.size) return g;
      const pos = [], bid = [];
      for (let i = 0; i + 8 < a.length; i += 9) { const id = B.array[i / 3]; if (ids.has(Math.round(id))) continue; for (let k = 0; k < 9; k++) pos.push(a[i + k]); bid.push(id, id, id); }
      if (!pos.length) return null;
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('_batchid', new THREE.Float32BufferAttribute(bid, 1));
      Object.assign(out.userData, g.userData); out.userData.removed = ids.size; return out;
    }).filter(Boolean);
  }

  /* Häuser und Bäume (swissBUILDINGS3D, Vegetation 3D) in Feldern um das Auto, nur nahe der Strasse */
  const city = new Map(); let cityBusy = false;
  const D2R = Math.PI / 180;
  async function updateCity(s) {
    if (cityBusy) return;
    const [i] = at(s), la0 = line[i][0], lo0 = line[i][1];
    const ky = Math.round(la0 / 0.012), kx = Math.round(lo0 / 0.0175), key = `${ky},${kx}`;
    // auch das nächste Feld in Fahrtrichtung vorladen
    const ahead = at(Math.min(L, s + 900))[0], kA = `${Math.round(line[ahead][0] / 0.012)},${Math.round(line[ahead][1] / 0.0175)}`;
    const todo = [key, kA].find(k => !city.has(k)); if (!todo) return;
    const [ay, ax] = todo.split(',').map(Number), la = ay * 0.012, lo = ax * 0.0175, half = 800;
    cityBusy = true; city.set(todo, null);
    try {
      const cos = Math.cos(la * D2R), mx = 111320 * cos, my = 110574;
      // Strassenpunkte in diesem Feld (lokale Meter) für die Nähe-Prüfung
      const near = []; for (let k = 0; k < N; k += 4) { const x = (line[k][1] - lo) * mx, z = -(line[k][0] - la) * my; if (Math.abs(x) < half + 400 && Math.abs(z) < half + 400) near.push(x, z); }
      if (!near.length) return;
      const keep = (x, z, m = 0) => { if (Math.abs(x) > half + m || Math.abs(z) > half + m) return false; const r = (CITY_KEEP + m) ** 2; for (let k = 0; k < near.length; k += 2) { const dx = near[k] - x, dz = near[k + 1] - z; if (dx * dx + dz * dz < r) return true; } return false; };
      const c = await loadCityWhere(la, lo, [-half, -half, half, half], keep).catch(() => null);
      if (!c || !city.has(todo) || D.stopped) return;
      const gAt = (x, z) => terrain.heightAt(la - z / my, lo + x / mx)?.h ?? 0;
      const grp = new THREE.Group(); grp.matrixAutoUpdate = false;
      grp.matrix.copy(erde.basis(la, lo)).setPosition(erde.toScene(la, lo, 0));
      // Höhen direkt aus den swisstopo-Daten (Fusspunkt jedes Hauses und Baums), nicht aus dem Gelände:
      // das feine Gelände ist beim Laden oft noch nicht da, grobe Kacheln liegen in steilen Hängen bis 50 m daneben.
      // Häuser, die in der Fahrbahn stehen oder näher als 1,5 m am Rand: herausnehmen (Strassenachse aus OSM und
      // Gebäude von swisstopo passen in engen Dörfern nicht auf den Meter zusammen)
      const strip = [], axis = []; { const M = ROAD_W / 2 + 2.2;
        for (let k = 0; k < N - 1; k++) { const x = (line[k][1] - lo) * mx, z = -(line[k][0] - la) * my; if (Math.abs(x) > half + 60 || Math.abs(z) > half + 60) continue;
          const x2 = (line[k + 1][1] - lo) * mx, z2 = -(line[k + 1][0] - la) * my, dx = x2 - x, dz = z2 - z, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
          for (const t of [0, 0.5]) axis.push(x + dx * t, z + dz * t);
          for (const t of [0, 0.5]) for (const o of [-M, -M * 0.66, -M * 0.33, 0, M * 0.33, M * 0.66, M]) strip.push(x + dx * t + nx * o, z + dz * t + nz * o); } }
      const nVor = c.parts.length; c.parts = clearRoad(c.parts, strip, axis, ROAD_W / 2 + 0.8); D.dbgCity = { teile: nVor, danach: c.parts.length, entfernt: c.parts.reduce((a, g) => a + (g.userData.removed || 0), 0), punkte: strip.length / 2 };
      if (c.parts.length) {
        // Fensterraster wie auf der Makler-Seite (Engine: withFacade). Hausfuss nur aus feinem Gelände, sonst Unterkante des Hauses.
        const gFine = (x, z) => { const h = terrain.heightAt(la - z / my, lo + x / mx); return h && h.z >= 15 ? h.h : null; };
        const m = buildingMesh(c.parts, 0, false, gFine);
        if (m) {
          // Der Fassaden-Shader rechnet mit Welt-Koordinaten, die Hausfuss-Höhe steht aber im Feld-System: umrechnen
          const fi = m.geometry.attributes.facInfo, po = m.geometry.attributes.position, e = grp.matrix.elements;
          if (fi) { for (let k = 0; k < fi.count; k++) { const b = fi.getY(k); if (b < -9e5) continue; const x = po.getX(k), y = po.getY(k), z = po.getZ(k); fi.setY(k, e[1] * x + e[5] * y + e[9] * z + e[13] - (y - b)); } fi.needsUpdate = true; }
          m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); grp.add(m);
        }
      }
      const tgrid = new Set(); for (let k = 0; k < strip.length; k += 2) tgrid.add(Math.round(strip[k] / 3) + ',' + Math.round(strip[k + 1] / 3));
      const trees = (MOBILE ? c.trees.filter((_, k) => k % 2 === 0) : c.trees).filter(t => !tgrid.has(Math.round(t.x / 3) + ',' + Math.round(t.z / 3)));
      for (const m of makeTrees(trees, SEASON)) grp.add(m); // Fusspunkt direkt aus den swisstopo-Daten (t.y)
      scene.add(grp); city.set(todo, grp);
      // alte Felder freigeben
      for (const [k2, g2] of city) { if (k2 === todo || k2 === key || k2 === kA || !g2) continue; const [y2, x2] = k2.split(',').map(Number); if (Math.hypot(y2 - ay, x2 - ax) > 2.5) { scene.remove(g2); g2.traverse(o => { o.geometry?.dispose(); }); city.delete(k2); } }
    } finally { cityBusy = false; }
  }

  /* Licht: Schatten nahe am Auto, Bergschatten per Strahl durchs Gelände */
  const keepNodes = terrain.maxNodes; terrain.maxNodes = Math.round(keepNodes * 0.8);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sunL.castShadow = true; const SM = MOBILE ? 1024 : 2048; sunL.shadow.mapSize.set(SM, SM);
  Object.assign(sunL.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 3000, far: 7000 }); sunL.shadow.camera.updateProjectionMatrix();
  sunL.shadow.bias = -0.00006; sunL.shadow.normalBias = 0.06; sunL.shadow.map?.dispose(); sunL.shadow.map = null;
  let shadowTiles = -1;
  const seen = new WeakSet();
  function terrainShadows() { if (terrain.loadedCount === shadowTiles) return; shadowTiles = terrain.loadedCount; for (const m of terrain.group.children) { if (seen.has(m)) continue; seen.add(m); m.castShadow = true; m.receiveShadow = true; m.material.needsUpdate = true; patchTerrain(m.material); } }
  let sunT = 0; D.sunVis = 1; let sunTarget = 1;
  function mountainShadow(dt, pos) {
    sunT -= dt; if (sunT <= 0 && S.sunDir) {
      sunT = 0.5; const g = {}, v = new THREE.Vector3(), dir = S.sunDir; let blocked = false;
      for (let d = 60; d < 14000; d += d < 1500 ? 30 : 120) {
        v.copy(pos).addScaledVector(dir, d); erde.toGeo(v, g); const h = terrain.heightAt(g.lat, g.lon);
        if (h && h.h > g.h) { blocked = true; break; }
        if (g.h > 4800) break;
      }
      sunTarget = blocked ? 0.12 : 1;
    }
    D.sunVis = lerp(D.sunVis, sunTarget, 1 - Math.exp(-dt * 2.5));
  }

  /* Auto, Fahrzustand */
  const car = makeCar(O.autofarbe || 0xb8b8bc); scene.add(car);
  const Fz = { s: clamp(S.s, 25, L - 10), v: 0, gas: 0, brake: 0, auto: false, view: 'hinten', look: 0, lookV: 0, warnT: 0, halt: false, aus: false, pitch: 0, steer: 0, roll: 0, nick: 0, acc: 0,
    eyeH: 1.7, eyeT: 1.7, lift: 0, d: LANE, psi: 0, vd: 0, spin: 0, gear: 1, steerIn: 0, manual: !MOBILE, laneT: LANE, rollV: 0, nickV: 0, shake: 0, msgT: 0, tun: 0 };
  D.t = 0; D.focus = new THREE.Vector3();
  camera.near = 0.1; camera.updateProjectionMatrix();

  /* Bedienung: Anzeige + Pedale (Touch) + Tasten */
  const ui = document.createElement('div'); ui.className = 's3-drive-ui';
  ui.innerHTML = `<div class="s3-speedo"><b>0</b><span>km/h · <i class="s3-gear">D</i></span></div><div class="s3-warn" hidden></div>
    <div class="s3-peaks"></div><div class="s3-view-hint" hidden>Ziehen: umschauen · Pfeile oder Knöpfe: gehen · Mausrad/zwei Finger: zoomen</div>
    <div class="s3-ausbar" hidden><button class="s3-fuss" aria-pressed="true">Zu Fuss</button><button class="s3-drohne" aria-pressed="false">Drohne</button><button class="s3-hoch" aria-label="Höher">▲</button><button class="s3-tief" aria-label="Tiefer">▼</button><span class="s3-hoehe"></span></div>
    <div class="s3-pedals"><div class="s3-side"><button class="s3-left" aria-label="Nach links lenken">◀</button><button class="s3-right" aria-label="Nach rechts lenken">▶</button></div>
      <div class="s3-mid"><button class="s3-halt-b">📷 Anhalten &amp; Aussicht</button><div class="s3-row"><button class="s3-auto" aria-pressed="false">Autopilot</button><button class="s3-man" aria-pressed="false">Selbst lenken</button><button class="s3-rev" aria-pressed="false">R</button></div></div>
      <div class="s3-side"><button class="s3-brake" aria-label="Bremse (im Aussichtsmodus: zurück)">▼</button><button class="s3-gas" aria-label="Gas (im Aussichtsmodus: vorwärts)">▲</button></div></div>
    <p class="s3-keys">↑ Gas · ↓ Bremse · ← → lenken · R Rückwärtsgang · L Lenkhilfe · P Autopilot · H Anhalten · V Ansicht</p>`;
  $('.s3-stage').appendChild(ui);
  const speedEl = ui.querySelector('.s3-speedo b'), gearEl = ui.querySelector('.s3-gear'), manB = ui.querySelector('.s3-man'), revB = ui.querySelector('.s3-rev'), warnEl = ui.querySelector('.s3-warn'), autoB = ui.querySelector('.s3-auto'), haltB = ui.querySelector('.s3-halt-b'), peaksEl = ui.querySelector('.s3-peaks'), hintEl = ui.querySelector('.s3-view-hint');
  // Umschalter reagieren schon beim Antippen (pointerdown): Auf dem Handy kommt kein «click», solange ein anderer Finger Gas oder Lenkung hält.
  const tap = (el, fn) => { el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); }); el.addEventListener('click', e => { if (e.detail === 0) fn(); }); };
  tap(haltB, () => Fz.aus || Fz.halt ? weiter() : anhalten());
  const hold = (el, key) => { const on = e => { e.preventDefault(); Fz[key] = 1; if (key === 'gas' || key === 'brake') setAuto(false); if (key === 'gas' && Fz.halt) weiter(); }, off = () => { Fz[key] = 0; }; el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off); };
  hold(ui.querySelector('.s3-gas'), 'gas'); hold(ui.querySelector('.s3-brake'), 'brake');
  // Lenken per Knopf (Handy): halten = einschlagen
  const steerBtn = (el, v) => { const on = e => { e.preventDefault(); Fz.steerIn = v; setAuto(false); }, off = () => { if (Fz.steerIn === v) Fz.steerIn = 0; }; el.addEventListener('pointerdown', on); for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(t, off); };
  steerBtn(ui.querySelector('.s3-left'), 1); steerBtn(ui.querySelector('.s3-right'), -1);
  const setManual = on => { Fz.manual = on; manB.setAttribute('aria-pressed', on ? 'true' : 'false'); if (!on) Fz.laneT = clamp(Fz.d, -LANE, LANE) < 0 ? -LANE : LANE; };
  tap(manB, () => setManual(!Fz.manual)); setManual(Fz.manual);
  const setGear = g => { if (Math.abs(Fz.v) > 1.5) { say('Zum Schalten zuerst anhalten'); return; } Fz.gear = g; revB.setAttribute('aria-pressed', g < 0 ? 'true' : 'false'); gearEl.textContent = g < 0 ? 'R' : 'D'; setAuto(false); };
  tap(revB, () => setGear(-Fz.gear));
  const say = (t, sec = 1.6) => { warnEl.textContent = t; Fz.msgT = sec; };
  // Aussicht: zu Fuss oder als Drohne, Höhe verstellbar
  const ausBar = ui.querySelector('.s3-ausbar'), fussB = ui.querySelector('.s3-fuss'), drohB = ui.querySelector('.s3-drohne'), hoeheEl = ui.querySelector('.s3-hoehe'), gasB = ui.querySelector('.s3-gas'), brakeB = ui.querySelector('.s3-brake');
  const setEye = h => { Fz.eyeT = clamp(h, 1.7, 300); const dr = Fz.eyeT > 3; fussB.setAttribute('aria-pressed', dr ? 'false' : 'true'); drohB.setAttribute('aria-pressed', dr ? 'true' : 'false'); };
  tap(fussB, () => setEye(1.7)); tap(drohB, () => setEye(Math.max(40, Fz.eyeT)));
  const holdV = (el, v) => { const on = e => { e.preventDefault(); Fz.lift = v; }, off = () => { if (Fz.lift === v) Fz.lift = 0; }; el.addEventListener('pointerdown', on); for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(t, off); };
  holdV(ui.querySelector('.s3-hoch'), 1); holdV(ui.querySelector('.s3-tief'), -1);
  const setAuto = on => { Fz.auto = on; autoB.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  tap(autoB, () => setAuto(!Fz.auto));
  const keys = e => {
    if (!root.isConnected || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const d = e.type === 'keydown';
    if (['ArrowUp', 'KeyW'].includes(e.code)) { Fz.gas = d ? 1 : 0; if (d) { setAuto(false); if (Fz.halt) weiter(); } e.preventDefault(); }
    else if (Fz.aus && ['KeyQ', 'KeyE'].includes(e.code)) { const v = e.code === 'KeyE' ? 1 : -1; if (d) Fz.lift = v; else if (Fz.lift === v) Fz.lift = 0; }
    else if (['ArrowDown', 'KeyS', 'Space'].includes(e.code)) { Fz.brake = d ? 1 : 0; if (d) setAuto(false); e.preventDefault(); }
    else if (['ArrowLeft', 'KeyA'].includes(e.code)) { if (d) { Fz.steerIn = 1; setAuto(false); } else if (Fz.steerIn === 1) Fz.steerIn = 0; e.preventDefault(); }
    else if (['ArrowRight', 'KeyD'].includes(e.code)) { if (d) { Fz.steerIn = -1; setAuto(false); } else if (Fz.steerIn === -1) Fz.steerIn = 0; e.preventDefault(); }
    else if (d && e.code === 'KeyR') setGear(-Fz.gear);
    else if (d && e.code === 'KeyL') setManual(!Fz.manual);
    else if (d && e.code === 'KeyH') { Fz.aus || Fz.halt ? weiter() : anhalten(); }
    else if (d && e.code === 'KeyP') setAuto(!Fz.auto);
    else if (d && e.code === 'KeyV') { const i = VIEWS.findIndex(v => v[0] === Fz.view); D.view(VIEWS[(i + 1) % VIEWS.length][0]); }
  };
  addEventListener('keydown', keys); addEventListener('keyup', keys);
  // Umschauen mit Ziehen
  const gl = renderer.domElement; let drag = null;
  let dragY = 0; const ptrs = new Map(); let pinch = 0;
  const pd = e => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); drag = e.clientX; dragY = e.clientY; gl.setPointerCapture?.(e.pointerId); };
  const pm = e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoom(pinch / d); pinch = d; return; }
    if (drag == null) return;
    const k = Fz.aus ? 0.0045 * camera.fov / 60 : 0.006;
    Fz.look = Fz.aus ? Fz.look - (e.clientX - drag) * k : clamp(Fz.look - (e.clientX - drag) * k, -2.6, 2.6);
    if (Fz.aus) Fz.pitch = clamp(Fz.pitch + (e.clientY - dragY) * k, -1.35, 0.9);
    drag = e.clientX; dragY = e.clientY;
  };
  const pu = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; if (!ptrs.size) drag = null; };
  const zoom = f => { if (!Fz.aus) return; camera.fov = clamp(camera.fov * f, 12, 70); camera.updateProjectionMatrix(); };
  const wh = e => { if (!Fz.aus) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); };
  gl.addEventListener('wheel', wh, { passive: false });
  gl.style.touchAction = 'none';
  gl.addEventListener('pointerdown', pd); gl.addEventListener('pointermove', pm); gl.addEventListener('pointerup', pu);
  // Kamera-Auswahl
  const modeSel = $('.s3-mode'), oldOpts = modeSel.innerHTML;
  modeSel.innerHTML = VIEWS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  D.view = v => { Fz.view = v; modeSel.value = v; Fz.look = 0; };
  D.view('hinten');

  /* Anhalten und Aussicht geniessen: bremsen, aussteigen, Rundumblick mit Gipfelnamen */
  function anhalten() { setAuto(false); Fz.gas = 0; Fz.halt = true; haltB.textContent = 'Hält an …'; }
  function aussichtStart() {
    Fz.aus = true; haltB.textContent = '▶ Weiterfahren'; hintEl.hidden = false; setTimeout(() => { hintEl.hidden = true; }, 6000);
    ausBar.hidden = false; setEye(1.7); Fz.eyeH = 1.7; walkP = null;
    // Blick zuerst auf die offene Seite (dorthin, wo das Gelände tiefer liegt)
    const p = point(Fz.s, 0, new THREE.Vector3()), d = dirAt(Fz.s, new THREE.Vector3()), [i] = at(Fz.s), r = new THREE.Vector3().crossVectors(d, UP[i]).normalize(), g = {};
    const hSide = sg => { let sum = 0; for (const m of [150, 400, 900]) { erde.toGeo(p.clone().addScaledVector(r, sg * m), g); sum += terrain.heightAt(g.lat, g.lon)?.h ?? 0; } return sum; };
    const rechts = hSide(1) < hSide(-1); Fz.look = rechts ? Math.PI / 2 : -Math.PI / 2; Fz.pitch = 0.06;
    Fz.stand = rechts ? LANE + 4.5 : -(ROAD_W / 2 + 3); // auf der Seite der Aussicht stehen, das Auto bleibt hinter einem
    peaksT = 0.2; peaksRound = 0;
  }
  let walkP = null, walkFrom = null; const _wf = new THREE.Vector3(), _wr = new THREE.Vector3(), _wg = {};
  function weiter() { ausBar.hidden = true; Fz.gas = 0; Fz.brake = 0; Fz.aus = false; Fz.halt = false; Fz.look = 0; Fz.pitch = 0; haltB.textContent = '📷 Anhalten & Aussicht'; hintEl.hidden = true; peaksEl.innerHTML = ''; peaks = []; camera.fov = 50; camera.updateProjectionMatrix(); }

  // Gipfelnamen (OpenStreetMap, wie in der Fotografen-Ansicht): nur Gipfel, die vom Standpunkt aus zu sehen sind
  const PEAKS = new URL('./peaks/', import.meta.url), peakTiles = new Map();
  const peakTile = k => { if (!peakTiles.has(k)) peakTiles.set(k, fetch(new URL(`${k}.json`, PEAKS)).then(r => r.ok ? r.json() : []).catch(() => [])); return peakTiles.get(k); };
  let peaks = [], peaksT = 0, peaksRound = 0, peaksBusy = false;
  function peaksTick(dt) {
    peaksT -= dt;
    if (peaksT <= 0 && !peaksBusy && peaksRound < 3) { peaksT = 2.5; peaksRound++; findPeaks(); }
    // Beschriftungen setzen
    const W = gl.clientWidth, H = gl.clientHeight, v = new THREE.Vector3();
    // Beschriftungen dürfen sich nicht überdecken: höhere (im Bild) zuerst, die anderen ausblenden
    const placed = [], bw = W < 500 ? 70 : 110, bh = W < 500 ? 16 : 28;
    for (const p of peaks) {
      v.copy(p.P).project(camera); let on = v.z < 1 && Math.abs(v.x) < 1.05 && v.y < 0.95 && v.y > -1;
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      if (on && placed.some(([a, b]) => Math.abs(a - x) < bw && Math.abs(b - y) < bh)) on = false;
      if (on) placed.push([x, y]);
      p.el.style.display = on ? '' : 'none';
      if (on) p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
  async function findPeaks() {
    peaksBusy = true;
    try {
      const eye = camera.position.clone(), g0 = erde.toGeo(eye, {}), R0 = 60000;
      const dLat = R0 / 110574, dLon = R0 / (111320 * Math.cos(g0.lat * Math.PI / 180)), keys = [];
      for (let a = Math.floor(g0.lat - dLat); a <= Math.floor(g0.lat + dLat); a++) for (let o = Math.floor(g0.lon - dLon); o <= Math.floor(g0.lon + dLon); o++) keys.push(`${a}_${o}`);
      const all = (await Promise.all(keys.map(peakTile))).flat();
      const cand = [];
      for (const [la, lo, ele, name] of all) {
        if (!ele || !name) continue;
        const P = erde.toScene(la, lo, ele), d = P.distanceTo(eye); if (d < 300 || d > R0) continue;
        const gh = terrain.heightAt(la, lo); if (gh && Math.abs(gh.h - ele) > 350) continue; // passt nicht zum Gelände
        cand.push({ P, d, ele, name, la, lo, ang: Math.asin((P.clone().sub(eye).normalize()).dot(erde.up(g0.lat, g0.lon))) });
      }
      cand.sort((a, b) => b.ang - a.ang);
      const vis = [], g = {}, dir = new THREE.Vector3(), q = new THREE.Vector3();
      for (const c of cand) {
        if (vis.some(o => o.P.distanceTo(c.P) < 1800)) continue;            // Nachbar erscheint schon höher
        dir.copy(c.P).sub(eye).normalize(); let ok = true;
        for (let s = 80; s < c.d - Math.max(250, c.d * 0.02); s += Math.max(40, s * 0.02)) {
          q.copy(eye).addScaledVector(dir, s); erde.toGeo(q, g); const h = terrain.heightAt(g.lat, g.lon);
          if (h && h.h > g.h + (s > 8000 ? 20 : 2)) { ok = false; break; }
        }
        if (ok) vis.push(c); if (vis.length >= 30) break;
      }
      peaksEl.innerHTML = ''; peaks = vis.map(c => { const el = document.createElement('div'); el.className = 's3-peak'; el.innerHTML = `<b>${c.name.replace(/[&<>]/g, '')}</b><span>${new Intl.NumberFormat('de-CH').format(Math.round(c.ele))} m · ${(c.d / 1000).toFixed(c.d < 10000 ? 1 : 0)} km</span>`; peaksEl.appendChild(el); return { ...c, el }; });
    } finally { peaksBusy = false; }
  }

  /* ---------- Tunnels und Galerien (aus OpenStreetMap, Feld "tunnel" der Strecke) ---------- */
  const K5 = Math.round(R.data.step / FINE), TUN = (R.data.tunnel || []).map(([a, b, kind]) => ({ a: a * K5, b: Math.min(N - 1, b * K5), kind, mesh: null }));
  const tunnelAt = s => { const i = s / FINE; for (const t of TUN) if (i >= t.a && i <= t.b) return t; return null; };
  // Gelände in der Röhre wegschneiden (sonst steht der Hang im Tunnelmund): bis 12 Strecken-Stücke als Kapseln im Gelände-Shader
  const CUT = { a: { value: Array.from({ length: 12 }, () => new THREE.Vector3(0, -1e7, 0)) }, b: { value: Array.from({ length: 12 }, () => new THREE.Vector3(0, -1e7, 0)) }, r: { value: 5.4 } };
  function patchTerrain(m) {
    if (!TUN.length || m.userData.tunnelCut) return; m.userData.tunnelCut = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r); sh.uniforms.tunA = CUT.a; sh.uniforms.tunB = CUT.b; sh.uniforms.tunR = CUT.r;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 tunA[ 12 ]; uniform vec3 tunB[ 12 ]; uniform float tunR;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfor ( int i = 0; i < 12; i ++ ) { vec3 ab = tunB[ i ] - tunA[ i ]; float l2 = dot( ab, ab ); if ( l2 > 1.0 ) { float t = clamp( dot( vWP - tunA[ i ], ab ) / l2, 0.0, 1.0 ); if ( length( vWP - tunA[ i ] - ab * t ) < tunR ) discard; } }');
    };
    m.customProgramCacheKey = () => 'flug-gelaende-tunnel'; m.needsUpdate = true;
  }
  const tubeMat = new THREE.MeshLambertMaterial({ color: 0x8d8a84, emissive: 0x3f3b35, side: THREE.DoubleSide }), portalMat = new THREE.MeshLambertMaterial({ color: 0xb9b5ad }), lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0 });
  const TW = ROAD_W / 2 + 0.9, TH = 5.2; // halbe Breite und Scheitelhöhe der Röhre
  function buildTunnel(t) {
    const n = t.b - t.a + 1, SEG = 10, pos = new Float32Array(n * (SEG + 1) * 3), idx = [], C = P[t.a].clone(), v = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3();
    const lamps = [];
    for (let k = 0; k < n; k++) {
      const i = t.a + k; erde.toScene(line[i][0], line[i][1], Hs[i] - 0.3, v); dirAt(i * FINE, d); side.crossVectors(d, UP[i]).normalize();
      for (let q = 0; q <= SEG; q++) { const a = Math.PI * q / SEG, w = v.clone().addScaledVector(side, -Math.cos(a) * TW).addScaledVector(UP[i], Math.sin(a) * TH + (q === 0 || q === SEG ? -0.4 : 0)).sub(C); pos.set([w.x, w.y, w.z], (k * (SEG + 1) + q) * 3); }
      if (k < n - 1) for (let q = 0; q < SEG; q++) { const a0 = k * (SEG + 1) + q, a1 = a0 + SEG + 1; idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1); }
      if (k % 4 === 2) lamps.push(v.clone().addScaledVector(UP[i], TH - 0.25), d.clone());
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const grp = new THREE.Group(), tube = new THREE.Mesh(g, tubeMat); tube.position.copy(C); tube.frustumCulled = false; grp.add(tube);
    // Lampenband an der Decke
    const lg = new THREE.BoxGeometry(0.5, 0.08, 3.2), lm = new THREE.InstancedMesh(lg, lampMat, lamps.length / 2), M = new THREE.Matrix4(), qd = new THREE.Quaternion();
    for (let k = 0; k < lamps.length; k += 2) { qd.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lamps[k + 1]); M.compose(lamps[k], qd, new THREE.Vector3(1, 1, 1)); lm.setMatrixAt(k / 2, M); }
    lm.frustumCulled = false; grp.add(lm);
    // Portale: Betonrahmen mit Bogenöffnung an beiden Enden
    const sh = new THREE.Shape(); sh.moveTo(-TW - 2.2, -0.6); sh.lineTo(TW + 2.2, -0.6); sh.lineTo(TW + 2.2, TH + 1.9); sh.lineTo(-TW - 2.2, TH + 1.9); sh.closePath();
    const hole = new THREE.Path(); hole.moveTo(-TW + 0.05, -0.6); for (let q = 0; q <= 16; q++) { const a = Math.PI * q / 16; hole.lineTo(-Math.cos(a) * (TW - 0.05), Math.sin(a) * (TH - 0.05) - 0.3); } hole.lineTo(TW - 0.05, -0.6); hole.closePath(); sh.holes.push(hole);
    const pg = new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: false });
    for (const [i, sg] of [[t.a, -1], [t.b, 1]]) {
      const pm = new THREE.Mesh(pg, portalMat); erde.toScene(line[i][0], line[i][1], Hs[i], pm.position); dirAt(i * FINE, d);
      pm.up.copy(UP[i]); pm.lookAt(pm.position.clone().addScaledVector(d, sg)); pm.castShadow = pm.receiveShadow = true; grp.add(pm);
    }
    scene.add(grp); t.mesh = grp; t.ver = roadVer;
  }
  let tunT = 0;
  function updateTunnels(dt) {
    if (!TUN.length) return;
    const here = tunnelAt(Fz.s); Fz.tun = lerp(Fz.tun, here ? 1 : 0, 1 - Math.exp(-dt * (here ? 4 : 2.5))); D.tun = Fz.tun;
    tunT -= dt; if (tunT > 0) return; tunT = 1;
    const i = Fz.s / FINE, segs = [];
    for (const t of TUN) {
      const near = t.b > i - 400 / FINE && t.a < i + 1800 / FINE;
      if (near && t.mesh && t.ver !== roadVer) { scene.remove(t.mesh); t.mesh.traverse(o => o.geometry?.dispose()); t.mesh = null; } // Strassenhöhe hat sich geändert: Röhre neu
      if (near && !t.mesh) buildTunnel(t);
      else if (!near && t.mesh) { scene.remove(t.mesh); t.mesh.traverse(o => o.geometry?.dispose()); t.mesh = null; }
      if (near) for (let k = t.a; k < t.b; k += 8) segs.push([Math.abs((k + 4) - i), k, Math.min(t.b, k + 8)]);
    }
    segs.sort((x, y) => x[0] - y[0]);
    for (let q = 0; q < 12; q++) { const sg = segs[q]; if (sg) { erde.toScene(line[sg[1]][0], line[sg[1]][1], Hs[sg[1]] + 2.2, CUT.a.value[q]); erde.toScene(line[sg[2]][0], line[sg[2]][1], Hs[sg[2]] + 2.2, CUT.b.value[q]); } else { CUT.a.value[q].set(0, -1e7, 0); CUT.b.value[q].set(0, -1e7, 0); } }
  }
  // Scheinwerfer: im Tunnel und in der Dämmerung an
  const head = new THREE.SpotLight(0xfff1d6, 0, 140, 0.5, 0.6, 1.6); head.position.set(0, 0.75, -2.0); head.target.position.set(0, 0.2, -30);
  car.userData.chassis.add(head, head.target);

  /* ---------- Verkehr: Autos in beiden Richtungen ---------- */
  const TCOL = [0xd9d9dc, 0x2f3338, 0x5b6f86, 0xb9b08f, 0x7d1f1f, 0x1f4e3a, 0xe8e6df, 0x4a4a4f];
  const traffic = []; const NT = MOBILE ? 5 : 8;
  function spawn(t, first) {
    const dirn = t.dir, lo = first ? 60 : (dirn > 0 ? 220 : 450), hi = dirn > 0 ? 900 : 1300;
    for (let tries = 0; tries < 12; tries++) {
      const s = Fz.s + (dirn > 0 && first && Math.random() < 0.25 ? -(40 + Math.random() * 160) : lo + Math.random() * (hi - lo));
      if (s < 30 || s > L - 30) continue;
      if (traffic.some(o => o !== t && o.dir === dirn && Math.abs(o.s - s) < 45)) continue;
      t.s = s; t.d = dirn * LANE; t.cruise = (dirn > 0 ? 10 : 12) + Math.random() * 8; t.u = dirn * t.cruise * 0.7; t.vd = 0; t.spin = 0; t.psi = 0; t.crash = 0; t.car.visible = true; return;
    }
    t.s = -1e6; t.car.visible = false; // kein Platz (Streckenanfang/-ende): später nochmals
  }
  for (let k = 0; k < NT; k++) { const c = makeCar(TCOL[k % TCOL.length]); c.scale.setScalar(k % 3 === 2 ? 1.08 : 1); scene.add(c); const t = { car: c, dir: k % 2 ? -1 : 1 }; traffic.push(t); spawn(t, true); }
  const _tf = new THREE.Vector3(), _tr = new THREE.Vector3(), _tt = new THREE.Vector3();
  function updateTraffic(dt) {
    for (const t of traffic) {
      if (t.s < -1e5) { if (Math.random() < dt) spawn(t); continue; }
      if (t.crash > 0) { t.crash -= dt; t.u *= Math.exp(-dt * 1.8); if (t.crash <= 0) spawn(t); }
      else {
        // Wunschtempo nach Kurve, Abstand zum Vordermann (auch zum eigenen Auto)
        const kk = curvature(t.s + t.dir * 20); let vt = Math.min(t.cruise, Math.sqrt(2.6 / Math.max(kk, 1e-4)));
        let gap = 1e9, vAhead = 0;
        for (const o of [...traffic, PL]) { if (o === t) continue; const od = o === PL ? Fz.d : o.d, os = o === PL ? Fz.s : o.s, ou = o === PL ? Fz.v * Math.cos(Fz.psi) : o.u; if (Math.abs(od - t.d) > 1.7) continue; const g = (os - t.s) * t.dir; if (g > 0 && g < gap) { gap = g; vAhead = ou * t.dir; } }
        if (gap < 11 + Math.abs(t.u) * 1.3) vt = Math.min(vt, Math.max(0, vAhead - (gap < 10 ? 3 : 0)));
        const cur = t.u * t.dir; t.u = t.dir * clamp(cur + clamp((vt - cur) * 1.5, -7, 2.2) * dt, 0, 30);
      }
      t.s += t.u * dt; t.d += t.vd * dt + (t.crash > 0 ? 0 : (t.dir * LANE - t.d) * Math.min(1, dt * 1.5)); t.vd *= Math.exp(-dt * 3); t.psi += t.spin * dt; t.spin *= Math.exp(-dt * 2.5); if (t.crash <= 0) t.psi *= Math.exp(-dt * 3);
      if (t.s < Fz.s - 380 || t.s > Fz.s + 1500 || t.s < 5 || t.s > L - 5) { spawn(t); continue; }
      const [ti] = at(t.s); point(t.s, t.d, t.car.position); dirAt(t.s, _tt).multiplyScalar(t.dir); _tr.crossVectors(_tt, UP[ti]).normalize();
      const j0 = Math.max(0, ti - 1), j1 = Math.min(N - 1, ti + 1), gr = (Hs[j1] - Hs[j0]) / ((j1 - j0) * FINE || 1) * t.dir;
      _tf.copy(_tt).multiplyScalar(Math.cos(t.psi)).addScaledVector(_tr, -Math.sin(t.psi)).addScaledVector(UP[ti], gr).normalize();
      t.car.up.copy(UP[ti]); t.car.lookAt(_tt.copy(t.car.position).sub(_tf));
      for (const w of t.car.userData.wheels) w.rotation.x -= Math.abs(t.u) * dt / 0.34;
    }
  }
  const PL = {}; // Platzhalter für das eigene Auto in der Abstandsrechnung
  /** Stoss: Erschütterung der Kamera und des Aufbaus (keine Beulen, nur Kräfte) */
  function jolt(strength, lateral, longit) { Fz.shake = Math.min(1, Fz.shake + strength / 9); Fz.rollV += lateral * strength * 0.035; Fz.nickV -= longit * strength * 0.03; }
  function collide() {
    for (const t of traffic) {
      if (t.s < -1e5) continue;
      const ds = t.s - Fz.s, dd = t.d - Fz.d; if (Math.abs(ds) > 4.5 || Math.abs(dd) > 1.82) continue;
      const pl = 4.5 - Math.abs(ds), pw = 1.82 - Math.abs(dd), u1 = Fz.v * Math.cos(Fz.psi), u2 = t.u, sgS = Math.sign(ds) || 1, sgD = Math.sign(dd) || 1;
      if (pw < pl * 0.35) { // seitliches Streifen
        const rel = Math.abs(Fz.v * Math.sin(Fz.psi)) + Math.abs(Fz.vd) + 0.8;
        Fz.vd = sgD * -rel * 0.7; t.vd = sgD * rel * 0.7; Fz.d -= sgD * pw * 0.5; t.d += sgD * pw * 0.5; Fz.psi *= 0.4; Fz.v *= 0.93; t.u *= 0.93;
        jolt(1.5 + rel, -sgD, 0); if (rel > 1.6) say('Gestreift!');
        continue;
      }
      if ((u1 - u2) * sgS <= 0) { Fz.s -= sgS * pl * 0.5; continue; } // entfernen sich schon
      const e = 0.15, imp = Math.abs(u1 - u2), n1 = ((1 - e) * u1 + (1 + e) * u2) / 2, n2 = ((1 + e) * u1 + (1 - e) * u2) / 2, off = clamp(dd / 1.82, -1, 1);
      Fz.v = n1 / Math.max(0.5, Math.cos(Fz.psi)); t.u = n2; t.crash = 5; setAuto(false);
      Fz.s -= sgS * pl * 0.55; t.s += sgS * pl * 0.55;
      // versetzter Aufprall: Autos drehen sich und werden seitlich weggedrückt
      Fz.spin += -off * sgS * imp * 0.05; t.spin += off * sgS * imp * 0.05 * t.dir; Fz.vd += -off * imp * 0.12; t.vd += off * imp * 0.12;
      jolt(imp, -off, sgS * Math.sign(u1 - u2) > 0 ? 1 : -1);
      say(`Zusammenstoss mit ${Math.round(imp * 3.6)} km/h`, 2.6);
    }
  }

  /* Schleife (von strecke3d.js jedes Bild aufgerufen) */
  const camP = new THREE.Vector3(), camL = new THREE.Vector3(); let first = true, roadT = 0;
  const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
  const LW = 2.8, HALF = ROAD_W / 2, _f = new THREE.Vector3(), _r = new THREE.Vector3(), _t2 = new THREE.Vector3();
  D.update = dt => {
    /* Längsdynamik: Gas, Bremse, Luft- und Rollwiderstand, Hangabtrieb, Rückwärtsgang */
    const k = curvature(Fz.s + Fz.v * 1.5), vCurve = Math.min(25, Math.sqrt(3.2 / Math.max(k, 1e-4)));
    const [i0] = at(Fz.s), j0 = Math.min(N - 1, i0 + 4), grade = (Hs[j0] - Hs[i0]) / ((j0 - i0) * FINE || 1);
    const sv = Math.sign(Fz.v), onRoad = Math.abs(Fz.d) < HALF + 0.2;
    let a = Fz.gear * Fz.gas * (Fz.gear > 0 ? 3.0 : 2.0) - sv * Fz.brake * 7.5 - sv * (0.0009 * Fz.v * Fz.v + 0.12 + (onRoad ? 0 : 2.2)) - 9.81 * grade * 0.55;
    if (Fz.auto) { // Autopilot: Tempo nach Kurve, Abstand zum Vordermann
      let tgt = Math.min(vCurve, 22), gap = 1e9, va = 0;
      for (const o of traffic) { if (Math.abs(o.d - Fz.d) > 1.7) continue; const g = o.s - Fz.s; if (g > 0 && g < gap) { gap = g; va = o.u; } }
      if (gap < 10 + Fz.v * 1.4) tgt = Math.min(tgt, Math.max(0, va - (gap < 9 ? 3 : 0)));
      a = clamp((tgt - Fz.v) * 1.2, -7, 2.2);
    }
    if (Fz.halt || Fz.aus) { a = -sv * 6; if (Fz.halt && Math.abs(Fz.v) < 0.25) { Fz.halt = false; Fz.v = 0; aussichtStart(); } }
    const idle = !Fz.gas && !Fz.auto;
    if ((idle || Fz.brake || Fz.aus) && Math.abs(Fz.v) < 0.35) { Fz.v = 0; a = 0; } // steht: Bremse hält (kein Wegrollen am Hang)
    const v0 = Fz.v; Fz.v = clamp(Fz.v + a * dt, Fz.gear > 0 ? (Fz.v < 0 ? -9 : 0) : -9, Fz.gear > 0 ? 33 : (Fz.v > 0 ? 33 : 0));
    if (Fz.brake && v0 * Fz.v < 0) Fz.v = 0;
    Fz.acc = a;

    /* Lenkung: selbst (Tasten/Knöpfe) oder Lenkhilfe/Autopilot (Spur halten). ψ = Winkel zur Strasse (+ = nach links), d = Abstand zur Mitte (+ = rechts) */
    const v = Fz.v, kap = curveSigned(Fz.s, 6), assist = Fz.auto || !Fz.manual, tunHere = tunnelAt(Fz.s);
    let dT;
    if (assist) {
      if (!Fz.auto && Fz.steerIn && !Fz.aus) Fz.laneT = clamp(Fz.laneT - Fz.steerIn * 2.2 * dt, -LANE - 0.4, LANE + 0.6); // mit Lenkhilfe: Tasten verschieben die Spur (überholen)
      dT = Fz.auto ? LANE : Fz.laneT;
      const psiT = clamp((Fz.d - dT) * 0.11, -0.32, 0.32) * (v < 0 ? -1 : 1), kA = curveSigned(Fz.s + (v < 0 ? -1 : 1) * Math.max(3, Math.abs(v) * 0.35), 6);
      dT = Math.atan(LW * kA) + (v < 0 ? -1 : 1) * 0.95 * (psiT - Fz.psi);
    } else dT = Fz.steerIn * 0.6 / (1 + v * v / 110);
    Fz.steer = lerp(Fz.steer, clamp(dT, -0.62, 0.62), 1 - Math.exp(-dt * (assist ? 9 : 5.5)));
    // Haftgrenze: über ca. 7,5 m/s² (auf dem Bankett 4) schiebt das Auto über die Vorderräder
    const GRIP = onRoad ? 7.5 : 4;
    let latA = v * v * Math.tan(Fz.steer) / LW;
    if (Math.abs(latA) > GRIP) { const over = Math.abs(latA) - GRIP; latA = Math.sign(latA) * GRIP; Fz.v -= Math.sign(v) * Math.min(Math.abs(v), (1.2 + over * 0.35) * dt); if (over > 1.2 && Math.abs(v) > 6) say(assist ? 'Zu schnell für die Kurve!' : 'Die Reifen rutschen!', 1.0); }
    else if (assist && v * v * Math.abs(kap) > 5.6) say('Zu schnell für die Kurve!', 1.0);
    const yawRate = Math.abs(v) > 2 ? latA / v : v * Math.tan(Fz.steer) / LW;
    const sDot = v * Math.cos(Fz.psi) / Math.max(0.35, 1 + kap * Fz.d);
    Fz.psi = clamp(Fz.psi + (yawRate - kap * sDot + Fz.spin) * dt, -1.35, 1.35);
    Fz.d += (-v * Math.sin(Fz.psi) + Fz.vd) * dt;
    Fz.s = clamp(Fz.s + sDot * dt, 2, L - 2);
    Fz.vd *= Math.exp(-dt * 3.5); Fz.spin *= Math.exp(-dt * 3);
    if (Fz.s >= L - 2.1 && Fz.v > 0) { Fz.v = 0; setAuto(false); say('Ziel erreicht', 3); }
    // Leitplanke bzw. Tunnelwand: abprallen, Tempo verlieren, Stoss
    { const B = (tunHere ? HALF + 0.75 : HALF + 2.3) - 0.92, sd = Math.sign(Fz.d);
      if (Math.abs(Fz.d) > B) {
        const out = (-Fz.v * Math.sin(Fz.psi) + Fz.vd) * sd; Fz.d = sd * B;
        if (out > 0.3) { Fz.vd = -sd * out * 0.3; Fz.psi *= -0.25; Fz.v *= 1 - clamp(out * 0.07, 0.03, 0.55); Fz.spin += sd * out * 0.02 * Math.sign(Fz.v || 1); jolt(out * 1.6, sd, 0.2); if (out > 1.5) say(tunHere ? 'Tunnelwand gestreift' : 'Leitplanke!', 1.8); setAuto(false); }
        else Fz.psi *= Math.exp(-dt * 4);
      }
      if (!onRoad && Math.abs(Fz.v) > 3) Fz.shake = Math.max(Fz.shake, 0.12);
    }
    updateTraffic(dt); collide();
    // Aufbau: gefedertes Wanken (Kurve) und Nicken (Gas/Bremse), Stösse schwingen aus
    const rollT = clamp(-latA * 0.011, -0.09, 0.09), nickT = clamp(a * 0.0075, -0.055, 0.03);
    Fz.rollV += ((rollT - Fz.roll) * 70 - Fz.rollV * 9) * dt; Fz.roll = clamp(Fz.roll + Fz.rollV * dt, -0.22, 0.22);
    Fz.nickV += ((nickT - Fz.nick) * 80 - Fz.nickV * 10) * dt; Fz.nick = clamp(Fz.nick + Fz.nickV * dt, -0.16, 0.12);
    Fz.shake *= Math.exp(-dt * 4.5);
    Fz.msgT -= dt; warnEl.hidden = Fz.msgT <= 0;
    D.t += dt * (Math.abs(Fz.v) > 0.1 ? 1 : 0.2);
    S.s = Fz.s * R.L / L; S.tt = S.s / R.L;
    speedEl.textContent = Math.round(Math.abs(Fz.v) * 3.6);
    // Strasse nachführen
    roadT -= dt;
    if (roadFrom < 0 || Math.abs(Fz.s - roadFrom) > WIN * 0.35 || (roadT <= 0 && terrain.loadedCount !== roadZ)) { buildRoad(Fz.s); roadT = 2.5; }
    updateTunnels(dt);
    // Auto setzen: Lage quer zur Strasse, Richtung = Strassenrichtung um ψ gedreht, Neigung nach Gefälle
    const [ci] = at(Fz.s); point(Fz.s, Fz.d, car.position);
    dirAt(Fz.s, _t2); _r.crossVectors(_t2, UP[ci]).normalize();
    _f.copy(_t2).multiplyScalar(Math.cos(Fz.psi)).addScaledVector(_r, -Math.sin(Fz.psi)).addScaledVector(UP[ci], grade * Math.cos(Fz.psi)).normalize();
    car.up.copy(UP[ci]); car.lookAt(_d.copy(car.position).sub(_f)); // Modell schaut nach -z
    for (const w of car.userData.wheels) w.rotation.x -= Fz.v * dt / 0.34;
    for (const st of car.userData.steer) st.rotation.y = Fz.steer;
    car.userData.chassis.rotation.set(Fz.nick, 0, Fz.roll); car.userData.chassis.position.y = -Math.abs(Fz.roll) * 0.25;
    car.visible = Fz.view !== 'cockpit';
    D.focus.copy(car.position);
    // Scheinwerfer im Tunnel und bei tiefer Sonne
    head.intensity = lerp(head.intensity, (Fz.tun > 0.2 || (S.sun && S.sun.alt < 3)) ? 2600 : 0, 1 - Math.exp(-dt * 4));
    { const g = erde.toGeo(car.position, _wg), sl = SEASON.snowLine.value; roadMat.uniforms.snow.value = clamp((g.h - (sl - 120)) / 240, 0, 1) * (1 - Fz.tun); }
    roadMat.uniforms.tun.value = Fz.tun; roadMat.uniforms.headOn.value = head.intensity / 2600; roadMat.uniforms.headPos.value.copy(car.position).addScaledVector(UP[ci], 0.7); roadMat.uniforms.headDir.value.copy(_f);
    // Kamera
    const fwd = _d.copy(_f), up = UP[ci], right = _s.crossVectors(fwd, up).normalize();
    const yaw = Fz.look, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const look = new THREE.Vector3().copy(fwd).multiplyScalar(cy).addScaledVector(right, sy);
    const cp = new THREE.Vector3(), cl = new THREE.Vector3();
    if (Fz.aus) {
      // Aussicht: neben dem Auto aussteigen, dann frei gehen (oder als Drohne fliegen) und umschauen
      if (!walkP) { walkP = point(Fz.s, Fz.stand || LANE + 4.5, new THREE.Vector3()); walkFrom = walkP.clone(); }
      const yawDir = new THREE.Vector3().copy(fwd).multiplyScalar(Math.cos(Fz.look)).addScaledVector(right, Math.sin(Fz.look));
      _wf.copy(yawDir); _wr.crossVectors(_wf, up).normalize();
      Fz.eyeT = clamp(Fz.eyeT + Fz.lift * Math.max(4, Fz.eyeT * 0.9) * dt, 1.7, 300); if (Fz.lift) setEye(Fz.eyeT);
      Fz.eyeH = lerp(Fz.eyeH, Fz.eyeT, 1 - Math.exp(-dt * 3));
      const sp = (Fz.eyeH > 3 ? clamp(6 + Fz.eyeH * 0.5, 8, 60) : 4.5) * dt, mv = Fz.gas - Fz.brake, sd = -Fz.steerIn; // steerIn + = links
      if (mv || sd) { walkP.addScaledVector(_wf, mv * sp).addScaledVector(_wr, sd * sp * 0.8); if (walkP.distanceTo(walkFrom) > 150) { walkFrom.copy(walkP); peaksT = 0.3; peaksRound = 0; } }
      // auf dem Gelände bleiben (zu Fuss) bzw. Höhe über Grund halten (Drohne)
      erde.toGeo(walkP, _wg); const gh = terrain.heightAt(_wg.lat, _wg.lon); if (gh && !tunnelAt(Fz.s)) walkP.addScaledVector(up, gh.h - _wg.h);
      cp.copy(walkP).addScaledVector(up, Fz.eyeH);
      cl.copy(cp).addScaledVector(yawDir, Math.cos(Fz.pitch) * 100).addScaledVector(up, Math.sin(Fz.pitch) * 100);
      camP.copy(cp); camL.copy(cl); camera.position.copy(camP); camera.up.copy(up); camera.lookAt(camL);
      hoeheEl.textContent = Fz.eyeH > 3 ? `${Math.round(Fz.eyeH)} m über Grund` : '';
      D.focus.copy(walkP);
      car.visible = true; terrainShadows(); mountainShadow(dt, car.position); updateCity(Fz.s); peaksTick(dt);
      return;
    }
    if (Fz.view === 'cockpit') { cp.copy(car.position).addScaledVector(up, 1.18).addScaledVector(right, -0.36).addScaledVector(fwd, 0.15); cl.copy(cp).addScaledVector(look, 30).addScaledVector(up, -1.2); }
    else if (Fz.view === 'hinten') { // steht ein Auto dicht dahinter, rückt die Kamera näher und höher (sonst sässe sie in dessen Haube)
      const eng = traffic.some(t => Math.abs(t.d - Fz.d) < 2.2 && Fz.s - t.s > 0 && Fz.s - t.s < 15) ? 1 : 0; Fz.camNear = lerp(Fz.camNear || 0, eng, 1 - Math.exp(-dt * 3));
      cp.copy(car.position).addScaledVector(look, -lerp(8.5, 5.2, Fz.camNear)).addScaledVector(up, lerp(2.9, 3.9, Fz.camNear)); cl.copy(car.position).addScaledVector(look, 9).addScaledVector(up, 0.9); }
    else if (Fz.view === 'drohne') { const tq = 1 - Fz.tun; cp.copy(car.position).addScaledVector(look, -lerp(9, 45, tq)).addScaledVector(up, lerp(2.6, 26, tq)); cl.copy(car.position).addScaledVector(look, 25); }
    else { const a2 = D.t * 0.25 + yaw, rr = lerp(11, 3.2, Fz.tun); cp.copy(car.position).addScaledVector(right, Math.cos(a2) * rr).addScaledVector(fwd, Math.sin(a2) * rr * (Fz.tun > 0.5 ? 2.4 : 1)).addScaledVector(up, 2.2); cl.copy(car.position).addScaledVector(up, 0.8); }
    const stiff = Fz.view === 'cockpit' ? 1 : 1 - Math.exp(-dt * 6);
    if (first) { camP.copy(cp); camL.copy(cl); first = false; } else { camP.lerp(cp, stiff); camL.lerp(cl, Fz.view === 'cockpit' ? 1 : 1 - Math.exp(-dt * 8)); }
    // nicht unter das Gelände
    const g = {}; erde.toGeo(camP, g); const th = terrain.heightAt(g.lat, g.lon); if (th && g.h < th.h + 1.2 && Fz.view !== 'cockpit' && Fz.tun < 0.05 && th.h - g.h < 12) camP.addScaledVector(up, th.h + 1.2 - g.h);
    camera.position.copy(camP); camera.up.copy(up); if (Fz.view === 'cockpit') camera.up.addScaledVector(right, -Math.sin(Fz.roll) * 0.8); // im Cockpit neigt sich der Horizont mit
    if (Fz.shake > 0.01) { const q = Fz.shake * 0.35, tt = performance.now() * 0.06; camera.position.addScaledVector(up, Math.sin(tt * 1.7) * q).addScaledVector(right, Math.sin(tt * 2.3 + 1) * q); }
    camera.lookAt(camL);
    terrainShadows(); if (Fz.tun < 0.3) mountainShadow(dt, car.position);
    updateCity(Fz.s);
  };
  D.stop = () => {
    D.stopped = true; scene.remove(car); for (const t of traffic) scene.remove(t.car); for (const t of TUN) if (t.mesh) scene.remove(t.mesh); for (let q = 0; q < 12; q++) { CUT.a.value[q].set(0, -1e7, 0); CUT.b.value[q].set(0, -1e7, 0); } if (road) { scene.remove(road); road.geometry.dispose(); }
    for (const g of city.values()) if (g) { scene.remove(g); g.traverse(o => o.geometry?.dispose()); }
    ui.remove(); removeEventListener('keydown', keys); removeEventListener('keyup', keys);
    gl.removeEventListener('pointerdown', pd); gl.removeEventListener('pointermove', pm); gl.removeEventListener('pointerup', pu); gl.removeEventListener('wheel', wh); camera.fov = 50; camera.updateProjectionMatrix();
    modeSel.innerHTML = oldOpts; modeSel.value = S.mode; sunL.castShadow = false; renderer.shadowMap.enabled = false; terrain.maxNodes = keepNodes; sunL.shadow.map?.dispose(); sunL.shadow.map = null; camera.near = 2; camera.updateProjectionMatrix(); D.sunVis = 1;
  };
  D.state = () => ({ s: Fz.s, v: Fz.v * 3.6, d: +Fz.d.toFixed(2), psi: +Fz.psi.toFixed(3), gear: Fz.gear, manual: Fz.manual, tun: +Fz.tun.toFixed(2), view: Fz.view, auto: Fz.auto, city: city.size, sun: D.sunVis, aussicht: Fz.aus, gipfel: peaks.length, verkehr: traffic.filter(t => t.s > -1e5).map(t => [Math.round(t.s - Fz.s), t.dir, Math.round(t.u * 3.6)]), tunnels: TUN.length, msg: warnEl.hidden ? '' : warnEl.textContent });
  /** An eine andere Stelle springen (m ab Start der Strecke): Auto steht dort gerade in der rechten Spur */
  D.jump = sRoute => { if (Fz.aus || Fz.halt) weiter(); Fz.s = clamp(sRoute * L / R.L, 25, L - 10); Fz.v = 0; Fz.d = LANE; Fz.laneT = LANE; Fz.psi = 0; Fz.vd = 0; Fz.spin = 0; first = true; for (const t of traffic) spawn(t, true); };
  D.traffic = traffic; D.setManual = setManual; D.setGear = setGear;
  D.anhalten = anhalten; D.weiter = weiter;
  /** Jahreszeit nach Datum (wie bei den Bahnfahrten): Herbstfarben und kahle Laubbäume, Schnee auf Dächern; Schnee am Strassenrand */
  D.season = iso => { setSeason(iso, 0); };
  D.season(O.datum);
  /** Prüfwert (Tests): Wie viele Haus-Ecken liegen noch in der Fahrbahn (näher als die halbe Strassenbreite an der Achse)? */
  D.probeHaus = (von = 0, bis = 1500) => {
    const i0 = Math.max(0, Math.round(von / FINE)), i1 = Math.min(N - 1, Math.round(bis / FINE)), v = new THREE.Vector3(); let inRoad = 0, near = 0, tot = 0;
    for (const g of city.values()) { if (!g) continue; g.updateMatrixWorld?.(); for (const m of g.children) { if (m.name !== 'buildings') continue; const P = m.geometry.attributes.position;
      for (let k = 0; k < P.count; k += 2) { v.fromBufferAttribute(P, k).applyMatrix4(g.matrix); tot++; let best = 1e9; for (let i = i0; i <= i1; i += 2) { const d = v.distanceToSquared(P_road(i)); if (d < best) best = d; } best = Math.sqrt(best); if (best < ROAD_W / 2) inRoad++; else if (best < ROAD_W / 2 + 2.2) near++; } } }
    return { ecken: tot, inFahrbahn: inRoad, amRand: near };
  };
  const _pr = new THREE.Vector3(), P_road = i => erde.toScene(line[i][0], line[i][1], Hs[i] + 1, _pr);
  /** Prüfwerte (Tests): Strasse über Gelände, grösster Knick im Längsprofil, Masse des Autos */
  D.probe = () => {
    const [i] = at(Fz.s), a = Math.max(1, i - 100), b = Math.min(N - 2, i + 300); let minClear = 99, under = 0, maxKink = 0, n = 0;
    for (let k = a; k <= b; k++) {
      for (const o of [-ROAD_W / 2 + 0.3, 0, ROAD_W / 2 - 0.3]) { const g = groundAtOffset(k, o); if (g == null || Math.abs(g - line[k][2]) > 6) continue; const c = Hs[k] + 0.12 - g; n++; if (c < minClear) minClear = c; if (c < 0) under++; }
      maxKink = Math.max(maxKink, Math.abs(Hs[k + 1] - 2 * Hs[k] + Hs[k - 1]));
    }
    const bb = new THREE.Box3().setFromObject(car), sz = bb.getSize(new THREE.Vector3());
    return { proben: n, unterGelaende: under, kleinsterAbstand: +minClear.toFixed(2), groessterKnick_m: +maxKink.toFixed(3), auto: [car.children.length, +sz.length().toFixed(2)] };
  };
  D.control = o => Object.assign(Fz, o);
  buildRoad(Fz.s);
  return D;
}
