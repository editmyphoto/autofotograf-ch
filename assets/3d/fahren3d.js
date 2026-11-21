/* Selbst fahren: eigenes Auto (markenfrei) auf der Passstrasse, Gas/Bremse, Cockpit- und Verfolger-Ansicht.
   Wie bei den Bahnfahrten: Strasse als eigene, scharfe Fläche, Häuser und Bäume von swisstopo (tiles3d.js der Engine),
   nahe Schatten per Shadow Map, Bergschatten über einen Strahl Richtung Sonne durchs Gelände.
   Wird von strecke3d.js erst geladen, wenn jemand «Selbst fahren» antippt. */
import * as THREE from './three.module.js';
import { loadCityWhere, buildingMesh, treeMeshes } from './tiles3d.js';

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
  g.add(ext([[2.2, 0.3], [2.3, 0.52], [2.12, 0.68], [1.1, 0.8], [-1.2, 0.86], [-2.0, 0.9], [-2.24, 0.82], [-2.27, 0.46], [-2.18, 0.3]], 1.84, 0.12, paint));
  g.add(ext([[0.9, 0.82], [0.12, 1.24], [-0.85, 1.27], [-1.78, 0.9], [-1.7, 0.84]], 1.5, 0.08, glass));
  g.add(ext([[0.1, 1.255], [-0.84, 1.285], [-0.82, 1.32], [0.08, 1.295]], 1.36, 0.05, paint));
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 3.2), dark); sill.position.set(0, 0.32, 0); g.add(sill);
  // Räder
  const wg = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 20).rotateZ(Math.PI / 2), rim = new THREE.CylinderGeometry(0.22, 0.22, 0.27, 12).rotateZ(Math.PI / 2);
  g.userData.wheels = [];
  for (const [x, z] of [[-0.86, -1.42], [0.86, -1.42], [-0.86, 1.38], [0.86, 1.38]]) {
    const w = new THREE.Group(); w.add(new THREE.Mesh(wg, dark), new THREE.Mesh(rim, chrome)); w.position.set(x, 0.34, z); g.add(w); g.userData.wheels.push(w);
  }
  // Lichter
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), tl = new THREE.MeshBasicMaterial({ color: 0xc0201a });
  for (const x of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), hl); h.position.set(x, 0.62, -2.31); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.05), tl); t.position.set(x, 0.74, 2.29); g.add(t);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ---------- Strasse: Fläche mit Rand- und Mittellinien (Shader) ---------- */
function roadMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, { W: { value: ROAD_W } }]),
    lights: true, fog: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: `#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vN;
void main() { vUv = uv; vec3 transformedNormal = normalMatrix * normal; vN = transformedNormal;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0); vec4 mvPosition = viewMatrix * worldPosition; gl_Position = projectionMatrix * mvPosition;
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
uniform float W; varying vec2 vUv; varying vec3 vN;
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
  float a = smoothstep(W * 0.5, W * 0.5 - 0.25, ax);                       // weicher Rand ins Gelände
  vec3 L = directionalLights[0].direction; float dif = max(dot(normalize(vN), L), 0.0);
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    sh = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
  #endif
  vec3 col = c * (ambientLightColor + hemisphereLights[0].skyColor * 0.55 + directionalLights[0].color * dif * sh);
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
  const src = R.pts, line = [];
  for (let i = 0; i < src.length - 1; i++) {
    const p0 = src[Math.max(0, i - 1)], p1 = src[i], p2 = src[i + 1], p3 = src[Math.min(src.length - 1, i + 2)];
    const n = Math.round(R.data.step / FINE);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      line.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), lerp(p1[2], p2[2], t)]);
    }
  }
  line.push(src[src.length - 1]);
  const N = line.length, L = (N - 1) * FINE, Hs = new Float32Array(N), Hok = new Uint8Array(N);
  const P = line.map(p => erde.toScene(p[0], p[1], p[2])), UP = line.map(p => erde.up(p[0], p[1]));
  // Höhe der Strasse: Gelände, wenn es nahe an der Streckenhöhe liegt (sonst Tunnel/Brücke: Streckenhöhe)
  function roadH(i) {
    const h = terrain.heightAt(line[i][0], line[i][1]);
    if (h && h.z >= 15 && Math.abs(h.h - line[i][2]) < 6) { Hs[i] = h.h; Hok[i] = h.z; } else if (!Hok[i]) Hs[i] = line[i][2];
    return Hs[i];
  }
  for (let i = 0; i < N; i++) Hs[i] = line[i][2];
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

  /* Strasse als Fläche (Fenster um das Auto, wird nachgeführt) */
  const roadMat = roadMaterial(); let road = null, roadFrom = -1, roadZ = 0;
  function buildRoad(s) {
    const i0 = Math.max(0, Math.floor((s - WIN * 0.4) / FINE)), i1 = Math.min(N - 1, Math.ceil((s + WIN) / FINE));
    const n = i1 - i0 + 1, pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
    const v = new THREE.Vector3(), side = new THREE.Vector3(), d = new THREE.Vector3();
    const C = P[i0].clone();
    for (let k = 0; k < n; k++) {
      const i = i0 + k; roadH(i);
      erde.toScene(line[i][0], line[i][1], Hs[i] + 0.18, v);
      dirAt(i * FINE, d); side.crossVectors(d, UP[i]).normalize();
      for (let q = 0; q < 2; q++) {
        const sg = q ? 1 : -1, w = v.clone().addScaledVector(side, sg * ROAD_W / 2).sub(C);
        pos.set([w.x, w.y, w.z], (k * 2 + q) * 3); uv.set([sg, i * FINE], (k * 2 + q) * 2);
      }
      if (k < n - 1) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if (road) { scene.remove(road); road.geometry.dispose(); }
    road = new THREE.Mesh(g, roadMat); road.position.copy(C); road.receiveShadow = true; road.renderOrder = 2; road.frustumCulled = false; scene.add(road);
    roadFrom = s; roadZ = terrain.loadedCount;
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
      if (c.parts.length) {
        const med = a => { a = a.filter(Number.isFinite).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 49.5; };
        const geoid = med(c.parts.map(g => g.userData.minY - gAt(g.userData.cx, g.userData.cz)));
        const m = buildingMesh(c.parts, -geoid, false, gAt); if (m) { m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); grp.add(m); }
      }
      const trees = (MOBILE ? c.trees.filter((_, k) => k % 2 === 0) : c.trees);
      for (const m of treeMeshes(trees, gAt)) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
      scene.add(grp); city.set(todo, grp);
      // alte Felder freigeben
      for (const [k2, g2] of city) { if (k2 === todo || k2 === key || k2 === kA || !g2) continue; const [y2, x2] = k2.split(',').map(Number); if (Math.hypot(y2 - ay, x2 - ax) > 2.5) { scene.remove(g2); g2.traverse(o => { o.geometry?.dispose(); }); city.delete(k2); } }
    } finally { cityBusy = false; }
  }

  /* Licht: Schatten nahe am Auto, Bergschatten per Strahl durchs Gelände */
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sunL.castShadow = true; const SM = MOBILE ? 2048 : 4096; sunL.shadow.mapSize.set(SM, SM);
  Object.assign(sunL.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 3000, far: 7000 }); sunL.shadow.camera.updateProjectionMatrix();
  sunL.shadow.bias = -0.00006; sunL.shadow.normalBias = 0.06; sunL.shadow.map?.dispose(); sunL.shadow.map = null;
  let shadowTiles = -1;
  const seen = new WeakSet();
  function terrainShadows() { if (terrain.loadedCount === shadowTiles) return; shadowTiles = terrain.loadedCount; for (const m of terrain.group.children) { if (seen.has(m)) continue; seen.add(m); m.castShadow = true; m.receiveShadow = true; m.material.needsUpdate = true; } }
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
  const Fz = { s: clamp(S.s, 0, L - 10), v: 0, gas: 0, brake: 0, auto: false, view: 'hinten', look: 0, lookV: 0, warnT: 0, halt: false, aus: false, pitch: 0 };
  D.t = 0; D.focus = new THREE.Vector3();
  camera.near = 0.1; camera.updateProjectionMatrix();

  /* Bedienung: Anzeige + Pedale (Touch) + Tasten */
  const ui = document.createElement('div'); ui.className = 's3-drive-ui';
  ui.innerHTML = `<div class="s3-speedo"><b>0</b><span>km/h</span></div><div class="s3-warn" hidden>Zu schnell für die Kurve!</div>
    <div class="s3-peaks"></div><div class="s3-view-hint" hidden>Ziehen zum Umschauen · Mausrad oder zwei Finger zum Zoomen</div>
    <div class="s3-pedals"><button class="s3-brake" aria-label="Bremse">Bremse</button><div class="s3-mid"><button class="s3-halt-b">📷 Anhalten &amp; Aussicht</button><button class="s3-auto" aria-pressed="false">Autopilot</button></div><button class="s3-gas" aria-label="Gas">Gas</button></div>
    <p class="s3-keys">Pfeiltasten ↑ Gas, ↓ Bremse, H Anhalten, A Autopilot, V Ansicht · ziehen: umschauen</p>`;
  $('.s3-stage').appendChild(ui);
  const speedEl = ui.querySelector('.s3-speedo b'), warnEl = ui.querySelector('.s3-warn'), autoB = ui.querySelector('.s3-auto'), haltB = ui.querySelector('.s3-halt-b'), peaksEl = ui.querySelector('.s3-peaks'), hintEl = ui.querySelector('.s3-view-hint');
  haltB.addEventListener('click', () => Fz.aus || Fz.halt ? weiter() : anhalten());
  const hold = (el, key) => { const on = e => { e.preventDefault(); Fz[key] = 1; if (key === 'gas' || key === 'brake') setAuto(false); if (key === 'gas' && (Fz.aus || Fz.halt)) weiter(); }, off = () => { Fz[key] = 0; }; el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off); };
  hold(ui.querySelector('.s3-gas'), 'gas'); hold(ui.querySelector('.s3-brake'), 'brake');
  const setAuto = on => { Fz.auto = on; autoB.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  autoB.addEventListener('click', () => setAuto(!Fz.auto));
  const keys = e => {
    if (!root.isConnected || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const d = e.type === 'keydown';
    if (['ArrowUp', 'KeyW'].includes(e.code)) { Fz.gas = d ? 1 : 0; if (d) { setAuto(false); if (Fz.aus || Fz.halt) weiter(); } e.preventDefault(); }
    else if (d && e.code === 'KeyH') { Fz.aus || Fz.halt ? weiter() : anhalten(); }
    else if (['ArrowDown', 'KeyS', 'Space'].includes(e.code)) { Fz.brake = d ? 1 : 0; if (d) setAuto(false); e.preventDefault(); }
    else if (d && e.code === 'KeyA') setAuto(!Fz.auto);
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
    if (Fz.aus) Fz.pitch = clamp(Fz.pitch + (e.clientY - dragY) * k, -0.6, 0.7);
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
    Fz.aus = true; haltB.textContent = '▶ Weiterfahren'; hintEl.hidden = false; setTimeout(() => { hintEl.hidden = true; }, 5000);
    // Blick zuerst auf die offene Seite (dorthin, wo das Gelände tiefer liegt)
    const p = point(Fz.s, 0, new THREE.Vector3()), d = dirAt(Fz.s, new THREE.Vector3()), [i] = at(Fz.s), r = new THREE.Vector3().crossVectors(d, UP[i]).normalize(), g = {};
    const hSide = sg => { let sum = 0; for (const m of [150, 400, 900]) { erde.toGeo(p.clone().addScaledVector(r, sg * m), g); sum += terrain.heightAt(g.lat, g.lon)?.h ?? 0; } return sum; };
    const rechts = hSide(1) < hSide(-1); Fz.look = rechts ? Math.PI / 2 : -Math.PI / 2; Fz.pitch = 0.06;
    Fz.stand = rechts ? LANE + 4.5 : -(ROAD_W / 2 + 3); // auf der Seite der Aussicht stehen, das Auto bleibt hinter einem
    peaksT = 0.2; peaksRound = 0;
  }
  function weiter() { Fz.aus = false; Fz.halt = false; Fz.look = 0; Fz.pitch = 0; haltB.textContent = '📷 Anhalten & Aussicht'; hintEl.hidden = true; peaksEl.innerHTML = ''; peaks = []; camera.fov = 50; camera.updateProjectionMatrix(); }

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

  /* Schleife (von strecke3d.js jedes Bild aufgerufen) */
  const camP = new THREE.Vector3(), camL = new THREE.Vector3(); let first = true, roadT = 0;
  const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
  D.update = dt => {
    // Fahrphysik (einfach): Gas, Bremse, Luft/Rollen, Steigung, Autopilot nach Kurvenradius
    const k = curvature(Fz.s + Fz.v * 1.5), vCurve = Math.min(25, Math.sqrt(3.2 / Math.max(k, 1e-4)));
    const [i0] = at(Fz.s), j0 = Math.min(N - 1, i0 + 4), grade = (Hs[j0] - Hs[i0]) / ((j0 - i0) * FINE || 1);
    let a = Fz.gas * 3.0 - Fz.brake * 7.5 - 0.0009 * Fz.v * Fz.v - 0.12 - 9.81 * grade * 0.55;
    if (Fz.auto) { const tgt = Math.min(vCurve, 22); a = clamp((tgt - Fz.v) * 1.2, -6, 2.2); }
    if (Fz.halt || Fz.aus) { a = -6; if (Fz.halt && Fz.v < 0.2) { Fz.halt = false; aussichtStart(); } }
    if (!Fz.gas && !Fz.auto && Fz.v < 0.3 && !Fz.brake) a = Math.min(a, 0);
    Fz.v = clamp(Fz.v + a * dt, 0, 33);
    const lat = Fz.v * Fz.v * curvature(Fz.s);
    if (lat > 5.2) { Fz.warnT = 1.2; Fz.v = Math.max(0, Fz.v - 4 * dt); }
    Fz.warnT -= dt; warnEl.hidden = Fz.warnT <= 0;
    Fz.s = clamp(Fz.s + Fz.v * dt, 0, L - 0.1); if (Fz.s >= L - 0.2) { Fz.v = 0; setAuto(false); }
    D.t += dt * (Fz.v > 0.1 ? 1 : 0.2);
    S.s = Fz.s * R.L / L; S.tt = S.s / R.L;
    speedEl.textContent = Math.round(Fz.v * 3.6);
    // Strasse nachführen
    roadT -= dt;
    if (roadFrom < 0 || Math.abs(Fz.s - roadFrom) > WIN * 0.35 || (roadT <= 0 && terrain.loadedCount !== roadZ)) { buildRoad(Fz.s); roadT = 1.5; }
    // Auto setzen (rechte Spur), Ausrichtung nach Fahrtrichtung und Steigung
    point(Fz.s, LANE, car.position); const ahead = point(Fz.s + 2.2, LANE, _p), back = point(Fz.s - 2.2, LANE, _q);
    const [ci] = at(Fz.s); car.up.copy(UP[ci]); car.lookAt(back); // Modell schaut nach -z → nach vorne zeigt die Rückseite des Ziels
    car.position.addScaledVector(UP[ci], 0.0);
    for (const w of car.userData.wheels) w.rotation.x -= Fz.v * dt / 0.34;
    car.visible = Fz.view !== 'cockpit';
    D.focus.copy(car.position);
    // Kamera
    const fwd = _d.copy(ahead).sub(back).normalize(), up = UP[ci], right = _s.crossVectors(fwd, up).normalize();
    const yaw = Fz.look, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const look = new THREE.Vector3().copy(fwd).multiplyScalar(cy).addScaledVector(right, sy);
    const cp = new THREE.Vector3(), cl = new THREE.Vector3();
    if (Fz.aus) {
      // neben dem Auto am Strassenrand stehen, Augenhöhe 1,7 m, frei umschauen
      cp.copy(point(Fz.s, Fz.stand || LANE + 4.5, _q)).addScaledVector(up, 1.7);
      const yawDir = new THREE.Vector3().copy(fwd).multiplyScalar(Math.cos(Fz.look)).addScaledVector(right, Math.sin(Fz.look));
      cl.copy(cp).addScaledVector(yawDir, Math.cos(Fz.pitch) * 100).addScaledVector(up, Math.sin(Fz.pitch) * 100);
      camP.copy(cp); camL.copy(cl); camera.position.copy(camP); camera.up.copy(up); camera.lookAt(camL);
      car.visible = true; terrainShadows(); mountainShadow(dt, car.position); updateCity(Fz.s); peaksTick(dt);
      return;
    }
    if (Fz.view === 'cockpit') { cp.copy(car.position).addScaledVector(up, 1.18).addScaledVector(right, -0.36).addScaledVector(fwd, 0.15); cl.copy(cp).addScaledVector(look, 30).addScaledVector(up, -1.2); }
    else if (Fz.view === 'hinten') { cp.copy(car.position).addScaledVector(look, -8.5).addScaledVector(up, 2.9); cl.copy(car.position).addScaledVector(look, 9).addScaledVector(up, 0.9); }
    else if (Fz.view === 'drohne') { cp.copy(car.position).addScaledVector(look, -45).addScaledVector(up, 26); cl.copy(car.position).addScaledVector(look, 25); }
    else { const a2 = D.t * 0.25 + yaw; cp.copy(car.position).addScaledVector(right, Math.cos(a2) * 11).addScaledVector(fwd, Math.sin(a2) * 11).addScaledVector(up, 2.2); cl.copy(car.position).addScaledVector(up, 0.8); }
    const stiff = Fz.view === 'cockpit' ? 1 : 1 - Math.exp(-dt * 6);
    if (first) { camP.copy(cp); camL.copy(cl); first = false; } else { camP.lerp(cp, stiff); camL.lerp(cl, Fz.view === 'cockpit' ? 1 : 1 - Math.exp(-dt * 8)); }
    // nicht unter das Gelände
    const g = {}; erde.toGeo(camP, g); const th = terrain.heightAt(g.lat, g.lon); if (th && g.h < th.h + 1.2 && Fz.view !== 'cockpit') camP.addScaledVector(up, th.h + 1.2 - g.h);
    camera.position.copy(camP); camera.up.copy(up); camera.lookAt(camL);
    terrainShadows(); mountainShadow(dt, car.position);
    updateCity(Fz.s);
  };
  D.stop = () => {
    D.stopped = true; scene.remove(car); if (road) { scene.remove(road); road.geometry.dispose(); }
    for (const g of city.values()) if (g) { scene.remove(g); g.traverse(o => o.geometry?.dispose()); }
    ui.remove(); removeEventListener('keydown', keys); removeEventListener('keyup', keys);
    gl.removeEventListener('pointerdown', pd); gl.removeEventListener('pointermove', pm); gl.removeEventListener('pointerup', pu); gl.removeEventListener('wheel', wh); camera.fov = 50; camera.updateProjectionMatrix();
    modeSel.innerHTML = oldOpts; modeSel.value = S.mode; sunL.castShadow = false; renderer.shadowMap.enabled = false; camera.near = 2; camera.updateProjectionMatrix(); D.sunVis = 1;
  };
  D.state = () => ({ s: Fz.s, v: Fz.v * 3.6, view: Fz.view, auto: Fz.auto, city: city.size, sun: D.sunVis, aussicht: Fz.aus, gipfel: peaks.length });
  D.anhalten = anhalten; D.weiter = weiter;
  D.control = o => Object.assign(Fz, o);
  buildRoad(Fz.s);
  return D;
}
