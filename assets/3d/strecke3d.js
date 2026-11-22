/* Streckenflug 3D: Strasse oder Rennstrecke als Kameraflug über echtes Gelände und Luftbild (swisstopo).
   Gemeinsames Modul für den Streckenfilm (Rennen) und die Pässefahrten (autofotograf.ch).
   Gelände: Gelaende aus der Engine (kacheln.js, unverändert importiert). Sonne nach NOAA (eigene kurze Fassung).
   Szene wie in kacheln.js: x = Ost, y = oben, z = Süd um einen Ursprung in der Mitte der Strecke.

   mountStrecke(root, opts) → api
   opts: { strecke: Objekt aus strecken/*.json, dauer: Filmlänge in s (60), kmh: Tempo für die Uhr (25), start: 'HH:MM',
           datum: 'YYYY-MM-DD', farbe: '#ffb000', titel, untertitel, sponsor, modus: 'film'|'verfolger'|'drohne'|'hoch',
           onHalt(halt|null), onTick(state) } */
import * as THREE from './three.module.js';
import { Erde, Gelaende, SNOW } from './kacheln.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const MOBILE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

/* ---------- Sonne (NOAA, gekürzt; Fehler < 0,05°) ---------- */
export function sonne(ms, lat, lon) {
  const jd = ms / 864e5 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * D2R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D2R) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = eps0 + 0.00256 * Math.cos(om * D2R);
  const dec = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R));
  const y = Math.tan(eps * D2R / 2) ** 2;
  const eqt = 4 * R2D * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R) + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R) - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));
  const d = new Date(ms), mins = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let ha = ((mins + eqt + 4 * lon) / 4 - 180) * D2R;
  const la = lat * D2R;
  let alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * R2D;
  if (alt > -1.5) alt += (1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * D2R)) / 60;
  const bearing = ((Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) * R2D + 180) % 360 + 360) % 360;
  return { alt, bearing };
}
/** Schweizer Ortszeit → Zeitpunkt (ms) */
export function zuerichMs(iso, hhmm) {
  const [h, m] = hhmm.split(':').map(Number), guess = Date.parse(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const off = (ms) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)); const hh = +p.find(x => x.type === 'hour').value, mm = +p.find(x => x.type === 'minute').value; return ((hh * 60 + mm) - (new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes()) + 1440 * 1.5) % 1440 - 720; };
  return guess - off(guess) * 60000;
}
export const uhr = ms => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

/* ---------- GPX einlesen (für Veranstalter: eigene Strecke hineinziehen) ---------- */
export async function streckeAusGpx(text, name = 'Eigene Strecke') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  let pts = [...doc.querySelectorAll('trkpt, rtept')].map(p => [+p.getAttribute('lat'), +p.getAttribute('lon'), p.querySelector('ele') ? +p.querySelector('ele').textContent : null]);
  pts = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) throw new Error('Keine Punkte in der GPX-Datei gefunden.');
  const nm = doc.querySelector('trk > name, metadata > name, rte > name')?.textContent?.trim() || name;
  // auf 25 m neu abtasten
  const STEP = 25, lat0 = pts[0][0], my = 110574, mx = 111320 * Math.cos(lat0 * D2R);
  const xy = pts.map(p => [(p[1] - pts[0][1]) * mx, (p[0] - lat0) * my, p[2]]);
  const out = [xy[0]]; let acc = 0;
  for (let i = 1; i < xy.length; i++) {
    let a = xy[i - 1]; const b = xy[i]; let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + d >= STEP && d > 0) { const t = (STEP - acc) / d; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * t : null]; out.push(a); d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0; }
    acc += d;
  }
  if (out.length > 12000) throw new Error('Strecke zu lang (höchstens 300 km).');
  let R = out.map(p => [lat0 + p[1] / my, pts[0][1] + p[0] / mx, p[2]]);
  if (R.some(p => p[2] == null)) { // ohne Höhen: swissALTI3D über geo.admin.ch
    const lv95 = (lat, lon) => { const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000; return [2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3, 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3]; };
    for (let i = 0; i < R.length; i += 300) {
      const part = R.slice(i, i + 300), body = new URLSearchParams({ geom: JSON.stringify({ type: 'LineString', coordinates: part.map(p => lv95(p[0], p[1]).map(v => Math.round(v * 100) / 100)) }), sr: 2056, nb_points: part.length, distinct_points: 'true' });
      const pr = await fetch('https://api3.geo.admin.ch/rest/services/profile.json', { method: 'POST', body }).then(r => r.json());
      part.forEach((p, k) => { p[2] = pr[Math.min(pr.length - 1, Math.round(k * (pr.length - 1) / Math.max(1, part.length - 1)))]?.alts?.DTM2 ?? 0; });
    }
  }
  const H = R.map(p => p[2]), Hs = H.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - 3); k <= Math.min(H.length - 1, i + 3); k++) { s += H[k]; n++; } return s / n; });
  R = R.map((p, i) => [+p[0].toFixed(6), +p[1].toFixed(6), +Hs[i].toFixed(1)]);
  let up = 0; for (let i = 1; i < R.length; i++) up += Math.max(0, R[i][2] - R[i - 1][2]);
  return { name: nm, step: STEP, km: +((R.length - 1) * STEP / 1000).toFixed(1), hoch: Math.round(up), max: Math.round(Math.max(...H)), pts: R,
    halte: [{ name: 'Start', i: 0, art: 'start', text: '' }, { name: 'Ziel', i: R.length - 1, art: 'ziel', text: '' }], quelle: 'Strecke: eigene GPX-Datei, Gelände © swisstopo' };
}

/* ---------- Linie mit fester Breite in Bildpunkten ---------- */
function ribbonMaterial(o) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: o.depthTest, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { px: { value: o.px }, res: { value: new THREE.Vector2(1, 1) }, prog: { value: 0 }, cDone: { value: new THREE.Color(o.done) }, cAhead: { value: new THREE.Color(o.ahead) }, alpha: { value: o.alpha } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 nextP; attribute float side; attribute float dist; uniform float px; uniform vec2 res; varying float vD; varying float vS;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0), b = projectionMatrix * modelViewMatrix * vec4(nextP, 1.0);
  vec2 sa = a.xy / max(a.w, 1e-3), sb = b.xy / max(b.w, 1e-3), dir = normalize((sb - sa) * res + 1e-6), n = vec2(-dir.y, dir.x);
  a.xy += n * side * px * 2.0 / res * a.w; gl_Position = a; vD = dist; vS = side;
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float prog; uniform vec3 cDone; uniform vec3 cAhead; uniform float alpha; varying float vD; varying float vS;
void main() {
  #include <logdepthbuf_fragment>
  float edge = 1.0 - smoothstep(0.6, 0.85, abs(vS));
  vec3 c = vD <= prog ? cDone : cAhead;
  gl_FragColor = vec4(mix(c * 0.25, c, edge), alpha * (0.75 + 0.25 * edge));
}` });
}
function ribbonGeometry(P, D) {
  const n = P.length, pos = new Float32Array(n * 2 * 3), nxt = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2), dist = new Float32Array(n * 2), idx = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = i < n - 1 ? P[i + 1] : P[i].clone().add(P[i].clone().sub(P[i - 1]));
    for (let s = 0; s < 2; s++) { const k = i * 2 + s; pos.set([a.x, a.y, a.z], k * 3); nxt.set([b.x, b.y, b.z], k * 3); side[k] = s ? 1 : -1; dist[k] = D[i]; }
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('nextP', new THREE.BufferAttribute(nxt, 3));
  g.setAttribute('side', new THREE.BufferAttribute(side, 1)); g.setAttribute('dist', new THREE.BufferAttribute(dist, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

const ICON = { start: '▶', ziel: '🏁', berg: '⛰', verpflegung: '🥤', foto: '📷', info: '•' };

/* ---------- Hauptfunktion ---------- */
export async function mountStrecke(root, opts = {}) {
  const O = Object.assign({ dauer: 60, kmh: 25, start: '10:00', farbe: '#ffb000', modus: 'film', datum: new Date().toISOString().slice(0, 10) }, opts);
  root.classList.add('s3');
  root.innerHTML = `<div class="s3-stage"><div class="s3-gl"></div><div class="s3-labels"></div>
    <div class="s3-hud"><div class="s3-title"></div><div class="s3-stats"></div></div>
    <div class="s3-halt" hidden></div><div class="s3-sponsor" hidden></div>
    <div class="s3-cover"><div><b>Gelände und Luftbild laden …</b><span class="s3-prog"></span></div></div></div>
    <canvas class="s3-profile" height="90"></canvas>
    <div class="s3-bar"><button class="s3-play" aria-label="Abspielen">▶</button><input class="s3-t" type="range" min="0" max="1000" value="0" aria-label="Position auf der Strecke">
      <button class="s3-drive" hidden>🚗 Selbst fahren</button><select class="s3-mode" aria-label="Kamera"><option value="film">Film (automatisch)</option><option value="verfolger">Verfolger</option><option value="drohne">Drohne seitlich</option><option value="hoch">Von oben</option></select></div>`;
  const $ = s => root.querySelector(s);
  const glHost = $('.s3-gl'), labels = $('.s3-labels'), cover = $('.s3-cover'), profile = $('.s3-profile'), tIn = $('.s3-t'), playB = $('.s3-play'), modeSel = $('.s3-mode');
  modeSel.value = O.modus;

  const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  glHost.appendChild(renderer.domElement);
  // Zu wenig Grafikspeicher (v. a. Handy): Browser beendet die 3D-Ansicht → klare Meldung statt schwarzem Bild
  renderer.domElement.addEventListener('webglcontextlost', e => {
    e.preventDefault(); S.lost = true;
    cover.hidden = false; cover.innerHTML = '<div><b>Die 3D-Ansicht wurde vom Browser beendet.</b><span>Meist ist der Grafikspeicher voll. Neu laden hilft.</span><br><button class="s3-reload" type="button">Neu laden</button></div>';
    cover.querySelector('.s3-reload').addEventListener('click', () => location.reload());
  });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 2, 600000);
  const hemi = new THREE.HemisphereLight(0xdde8f6, 0x5a6050, 1.0), sunL = new THREE.DirectionalLight(0xfff3e0, 2.0);
  scene.add(hemi, sunL, sunL.target);
  scene.fog = new THREE.FogExp2(0xc8d6e4, 0.000016);
  const skyU = { top: { value: new THREE.Color(0x5d93cf) }, hor: { value: new THREE.Color(0xc8d6e4) }, up: { value: new THREE.Vector3(0, 1, 0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: new THREE.Color(0xfff0d0) } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500000, 32, 16), new THREE.ShaderMaterial({ uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0);\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform vec3 top, hor, up, sunDir, glow; varying vec3 vD; void main(){\n#include <logdepthbuf_fragment>\nfloat e = dot(vD, up); vec3 c = mix(hor, top, smoothstep(-0.02, 0.45, e)); c = mix(c, hor * 0.78, smoothstep(0.0, -0.2, e)); float s = max(0.0, dot(vD, sunDir)); c += glow * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18); gl_FragColor = vec4(c, 1.0); }' }));
  sky.renderOrder = -2; sky.frustumCulled = false; scene.add(sky);

  let erde, terrain, R; // R: Strecke in der Szene
  const lineMats = [ribbonMaterial({ px: 3, depthTest: true, done: O.farbe, ahead: '#ffffff', alpha: 1 }), ribbonMaterial({ px: 2, depthTest: false, done: O.farbe, ahead: '#ffffff', alpha: 0.5 })];
  const lineMeshes = [];
  const marker = new THREE.Group();
  { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: O.farbe, depthTest: false, transparent: true }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.35 }));
    m.renderOrder = 11; halo.renderOrder = 10; marker.add(halo, m); scene.add(marker); }

  const S = { s: 0, tt: 0, playing: false, mode: O.modus, rec: null, loadedOnce: false, halt: null, camP: new THREE.Vector3(), camL: new THREE.Vector3(), first: true, last: performance.now() };

  function setRoute(data) {
    if (S.drive) api.fahren(false);
    for (const m of lineMeshes) { scene.remove(m); m.geometry.dispose(); }
    lineMeshes.length = 0; labels.innerHTML = '';
    const pts = data.pts, n = pts.length;
    let la = 0, lo = 0; for (const p of pts) { la += p[0]; lo += p[1]; } la /= n; lo /= n;
    if (!erde || Math.hypot(la - erde.lat0, lo - erde.lon0) > 0.3) {
      if (terrain) { scene.remove(terrain.group); terrain.group.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); }); }
      erde = new Erde(la, lo);
      terrain = new Gelaende(scene, erde, MOBILE ? { maxZ: 16, detail: 1.4, conc: 6, maxNodes: 300, anisotropy: 2 } : { maxZ: 17, detail: 2.2, conc: 12, maxNodes: 560, anisotropy: 8, texNear: true });
    }
    const P = pts.map(p => erde.toScene(p[0], p[1], p[2] + 4)), D = pts.map((_, i) => i * data.step);
    const UP = pts.map(p => erde.up(p[0], p[1]));
    const L = D[n - 1];
    // Zeit-Gewichte: an Halten langsamer (der Film verweilt dort)
    const W = new Float32Array(n), T = new Float32Array(n);
    for (let i = 0; i < n; i++) { let w = 1; for (const h of data.halte) { const d = Math.abs(D[i] - h.i * data.step); if (h.art !== 'info') w += 2.2 * Math.exp(-((d / Math.max(400, L * 0.012)) ** 2)); } W[i] = w; }
    for (let i = 1; i < n; i++) T[i] = T[i - 1] + (W[i] + W[i - 1]) / 2; for (let i = 0; i < n; i++) T[i] /= T[n - 1];
    // Mitte und Ausdehnung für die Übersicht
    const box = new THREE.Box3(); for (const p of P) box.expandByPoint(p);
    const C = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
    R = { data, pts, P, D, UP, L, T, C, rad, n };
    const g = ribbonGeometry(P, D);
    lineMats.forEach((m, k) => { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = k ? 5 : 4; scene.add(mesh); lineMeshes.push(mesh); });
    for (const h of data.halte) {
      const el = document.createElement('div'); el.className = 's3-lab s3-' + h.art; el.innerHTML = `<i>${ICON[h.art] || '•'}</i><span>${h.name}</span>`;
      el.addEventListener('click', () => api.seek(h.i * data.step / L, true));
      labels.appendChild(el); h.el = el; h.P = P[h.i];
    }
    $('.s3-title').innerHTML = `<b>${O.titel || data.name}</b><span>${O.untertitel || `${fmt(data.km)} km · ${fmt(data.hoch)} m hinauf · höchster Punkt ${fmt(data.max)} m ü. M.`}</span>`;
    if (O.sponsor) { $('.s3-sponsor').hidden = false; $('.s3-sponsor').innerHTML = O.sponsor; }
    drawProfile(); S.first = true; seekTT(0); S.loadedOnce = false; S.routeT = performance.now(); cover.hidden = false;
    terrain.preload(pts[0][0], pts[0][1], 14);
    return R;
  }

  const fmt = v => new Intl.NumberFormat('de-CH').format(v);
  function idxAt(s) { const f = clamp(s / R.data.step, 0, R.n - 1), i = Math.min(R.n - 2, Math.floor(f)); return [i, f - i]; }
  function posAt(s, out = new THREE.Vector3()) { const [i, f] = idxAt(s); return out.copy(R.P[i]).lerp(R.P[i + 1], f); }
  function hAt(s) { const [i, f] = idxAt(s); return lerp(R.pts[i][2], R.pts[i + 1][2], f); }
  function grade(s) { const a = hAt(s - 100), b = hAt(s + 100); return (b - a) / 200; }
  function sOfTT(tt) { // Filmzeit 0…1 → Strecke (m)
    const T = R.T; let lo = 0, hi = R.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < tt) lo = m; else hi = m; }
    const f = T[hi] > T[lo] ? (tt - T[lo]) / (T[hi] - T[lo]) : 0; return R.D[lo] + f * (R.D[hi] - R.D[lo]);
  }
  function ttOfS(s) { const [i, f] = idxAt(s); return lerp(R.T[i], R.T[i + 1], f); }
  function seekTT(tt) { S.tt = clamp(tt, 0, 1); S.s = sOfTT(S.tt); }

  /* Höhenprofil */
  function drawProfile() {
    const c = profile, W = c.clientWidth || 800, H = 90, dpr = Math.min(2, devicePixelRatio); c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, W, H);
    const hs = R.pts.map(p => p[2]), mn = Math.min(...hs), mx = Math.max(...hs), py = h => H - 14 - (h - mn) / Math.max(1, mx - mn) * (H - 30), px = d => d / R.L * W;
    const prog = S.s;
    for (const pass of [0, 1]) {
      x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i < R.n; i += 2) { if (pass && R.D[i] > prog) break; x.lineTo(px(R.D[i]), py(hs[i])); }
      x.lineTo(pass ? px(Math.min(prog, R.L)) : W, H); x.closePath();
      x.fillStyle = pass ? O.farbe : 'rgba(127,127,127,.28)'; x.fill();
    }
    x.font = '11px system-ui, sans-serif'; x.textAlign = 'center';
    for (const h of R.data.halte) { const X = px(h.i * R.data.step); x.fillStyle = 'rgba(127,127,127,.9)'; x.fillRect(X - 0.5, 10, 1, H - 24); x.fillText(ICON[h.art] || '•', clamp(X, 8, W - 8), 10); }
    x.textAlign = 'left'; x.fillStyle = 'rgba(127,127,127,1)'; x.fillText(`${fmt(Math.round(mx))} m`, 4, 22); x.fillText(`${fmt(Math.round(mn))} m`, 4, H - 2);
    x.textAlign = 'right'; x.fillText(`${fmt(R.data.km)} km`, W - 4, H - 2);
  }
  profile.addEventListener('click', e => { const r = profile.getBoundingClientRect(), sm = (e.clientX - r.left) / r.width * R.L; if (S.drive) S.drive.jump(sm); else api.seek(ttOfS(sm), true); });
  tIn.addEventListener('input', () => { seekTT(tIn.value / 1000); });
  playB.addEventListener('click', () => S.playing ? api.pause() : api.play());
  modeSel.addEventListener('change', () => { if (S.drive) S.drive.view(modeSel.value); else S.mode = modeSel.value; });
  const driveB = $('.s3-drive'); driveB.hidden = !O.fahren;
  driveB.addEventListener('click', () => api.fahren(!S.drive));

  /* Sonne */
  function timeMs() { return zuerichMs(O.datum, O.start) + (S.drive ? S.drive.t * 1000 : S.s / (O.kmh / 3.6) * 1000); }
  function updateSun() {
    const p = R.pts[Math.round(R.n / 2)], ms = timeMs(), so = sonne(ms, p[0], p[1]);
    const e = erde.east(p[0], p[1]), nn = erde.north(p[0], p[1]), u = erde.up(p[0], p[1]);
    const ca = Math.cos(so.alt * D2R), dir = new THREE.Vector3().addScaledVector(e, Math.sin(so.bearing * D2R) * ca).addScaledVector(nn, Math.cos(so.bearing * D2R) * ca).addScaledVector(u, Math.sin(Math.max(so.alt, -4) * D2R)).normalize();
    const sc = S.drive ? S.drive.focus : S.camL;
    sunL.position.copy(sc).addScaledVector(dir, 5000); sunL.target.position.copy(sc); sunL.target.updateMatrixWorld();
    S.sunDir = dir;
    const day = clamp((so.alt + 2) / 10, 0, 1), warm = clamp(1 - so.alt / 18, 0, 1);
    sunL.intensity = 2.1 * day * (S.drive ? S.drive.sunVis * 1.35 * (1 - (S.drive.tun || 0)) : 1); sunL.color.setRGB(1, lerp(0.96, 0.74, warm), lerp(0.9, 0.5, warm));
    hemi.intensity = lerp(0.35, 1.0, day) * (S.drive ? lerp(1, 0.6, S.drive.sunVis) * lerp(1, 0.16, S.drive.tun || 0) : 1);
    skyU.sunDir.value.copy(dir); skyU.up.value.copy(u);
    skyU.top.value.setRGB(lerp(0.08, 0.36, day), lerp(0.1, 0.58, day), lerp(0.22, 0.81, day));
    skyU.hor.value.setRGB(lerp(0.35, lerp(0.78, 0.96, warm * day), day), lerp(0.36, lerp(0.84, 0.78, warm * day), day), lerp(0.45, lerp(0.89, 0.66, warm * day), day));
    scene.fog.color.copy(skyU.hor.value);
    S.sun = so; S.ms = ms;
  }

  /* Kamera */
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _side = new THREE.Vector3(), _g = {};
  function ground(v) { erde.toGeo(v, _g); const h = terrain.heightAt(_g.lat, _g.lon); return h ? { h: h.h, cam: _g.h } : null; }
  function shotFor(s, tt, t) {
    let mode = S.mode;
    const nearHalt = R.data.halte.find(h => h.art !== 'info' && Math.abs(h.i * R.data.step - s) < Math.max(450, R.L * 0.01));
    if (mode === 'film') {
      if (tt < 0.045) mode = 'uebersicht';
      else if (tt > 0.975) mode = 'uebersicht';
      else if (nearHalt) mode = 'orbit';
      else mode = ['verfolger', 'drohne', 'verfolger', 'hoch'][Math.floor(t / 9) % 4];
    }
    const [i] = idxAt(s), up = _u.copy(R.UP[i]);
    const P = posAt(s, _a), dir = posAt(Math.min(R.L, s + 220), _d).sub(posAt(Math.max(0, s - 220), _b));
    dir.addScaledVector(up, -dir.dot(up)).normalize();
    _side.crossVectors(dir, up).normalize();
    const cam = new THREE.Vector3(), look = P.clone();
    if (mode === 'uebersicht') {
      const south = erde.north(erde.lat0, erde.lon0).negate();
      cam.copy(R.C).addScaledVector(south, R.rad * 1.15).addScaledVector(up, R.rad * 0.95); look.copy(R.C);
    } else if (mode === 'verfolger') { cam.copy(P).addScaledVector(dir, -340).addScaledVector(up, 150); look.addScaledVector(dir, 260); }
    else if (mode === 'drohne') { cam.copy(P).addScaledVector(_side, 620).addScaledVector(dir, -180).addScaledVector(up, 330); look.addScaledVector(dir, 120); }
    else if (mode === 'hoch') { cam.copy(P).addScaledVector(dir, -1300).addScaledVector(up, 1700); look.addScaledVector(dir, 500); }
    else if (mode === 'orbit') {
      const a = t * 0.16, hp = nearHalt.P, r = 520;
      cam.copy(hp).addScaledVector(_side, Math.cos(a) * r).addScaledVector(dir, Math.sin(a) * r).addScaledVector(up, 240); look.copy(hp);
    }
    return { cam, look, mode, nearHalt };
  }
  let filmT = 0;
  function placeCamera(dt, jump) {
    const sh = shotFor(S.s, S.tt, filmT);
    const g = ground(sh.cam); if (g && sh.mode !== 'uebersicht') { const clear = g.h + 70 - g.cam; if (clear > 0) sh.cam.addScaledVector(R.UP[idxAt(S.s)[0]], clear); }
    const k = jump ? 1 : 1 - Math.exp(-dt * (sh.mode === 'uebersicht' ? 0.9 : 1.25));
    if (S.first || jump) { S.camP.copy(sh.cam); S.camL.copy(sh.look); S.first = false; }
    else { S.camP.lerp(sh.cam, k); S.camL.lerp(sh.look, 1 - Math.exp(-dt * 2.2)); }
    // nie unter das Gelände
    const g2 = ground(S.camP); if (g2 && g2.cam < g2.h + 25) S.camP.addScaledVector(R.UP[idxAt(S.s)[0]], g2.h + 25 - g2.cam);
    camera.position.copy(S.camP); camera.up.copy(R.UP[idxAt(S.s)[0]]); camera.lookAt(S.camL);
    S.shot = sh.mode;
    if (S.halt !== sh.nearHalt) { S.halt = sh.nearHalt || null; showHalt(S.halt); O.onHalt?.(S.halt); }
    return sh;
  }
  function showHalt(h) {
    const el = $('.s3-halt');
    if (!h) { el.hidden = true; return; }
    el.hidden = false; el.innerHTML = `<i>${ICON[h.art] || '•'}</i><div><b>${h.name}</b><span>${h.text || ''}${h.licht ? ` · ${h.licht}` : ''}</span></div>`;
  }

  /* Beschriftungen und Anzeige */
  const _p = new THREE.Vector3();
  function updateLabels() {
    const W = glHost.clientWidth, H = glHost.clientHeight;
    for (const h of R.data.halte) {
      // Schilder erst kurz vorher zeigen (beim Fahren 1,2 km voraus, im Flug 2,5 km um die Stelle), in der Übersicht alle
      const ds = h.i * R.data.step - S.s, nah = S.drive ? ds > -80 && ds < 1200 : S.shot === 'uebersicht' || Math.abs(ds) < 2500;
      _p.copy(h.P).project(camera); const vis = nah && _p.z < 1 && Math.abs(_p.x) < 1.1 && Math.abs(_p.y) < 1.1 && camera.position.distanceTo(h.P) < 60000;
      h.el.style.display = vis ? '' : 'none';
      if (vis) h.el.style.transform = `translate(${(_p.x + 1) / 2 * W}px, ${(1 - _p.y) / 2 * H}px)`;
    }
  }
  function stats() {
    const next = R.data.halte.find(h => h.i * R.data.step > S.s + 30);
    return { km: S.s / 1000, h: hAt(S.s), g: grade(S.s) * 100, uhr: uhr(S.ms), next, nextKm: next ? (next.i * R.data.step - S.s) / 1000 : 0 };
  }
  function updateHud() {
    const st = stats();
    $('.s3-stats').innerHTML = `<span><b>${st.km.toFixed(1)}</b> km</span><span><b>${fmt(Math.round(st.h))}</b> m ü. M.</span><span><b>${st.g >= 0 ? '+' : ''}${st.g.toFixed(0)}</b> %</span><span><b>${st.uhr}</b> Uhr</span>${st.next && st.nextKm < 5 ? `<span class="s3-next">${ICON[st.next.art] || ''} ${st.next.name} in ${st.nextKm.toFixed(1)} km</span>` : ''}`;
    tIn.value = Math.round(S.tt * 1000);
  }

  /* Grösse */
  let cw = 0, ch = 0;
  function resize(force) {
    if (S.rec) return;
    const W = glHost.clientWidth, H = glHost.clientHeight;
    if (!force && W === cw && H === ch) return; cw = W; ch = H;
    renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
    for (const m of lineMats) m.uniforms.res.value.set(W, H);
    if (R) drawProfile();
  }
  new ResizeObserver(() => resize()).observe(glHost);

  /* Schleife */
  let lastProf = 0;
  function frame(now) { body(now); requestAnimationFrame(frame); }
  function body(now) {
    if (S.lost) return;
    const dt = clamp((now - S.last) / 1000, 0, 0.1); S.last = Math.max(S.last, now);
    resize();
    if (!R) return;
    const busy = terrain.pending > (S.rec ? 2 : 14) || terrain.busy > (S.rec ? 3 : 99);
    if (!S.loadedOnce && ((terrain.loadedCount > 30 && terrain.pending < 20) || (now - S.routeT > 12000 && terrain.loadedCount > 20))) { S.loadedOnce = true; cover.hidden = true; }
    if (!S.loadedOnce) $('.s3-prog').textContent = ` ${terrain.loadedCount} Kacheln`;
    const wait = S.rec && busy;
    if (S.rec) { if (wait && S.rec.mr.state === 'recording') S.rec.mr.pause(); else if (!wait && S.rec.mr.state === 'paused') S.rec.mr.resume(); }
    if (S.drive) S.drive.update(dt);
    else {
      if (S.playing && S.loadedOnce && !wait) {
        const step = dt / O.dauer;
        filmT += dt; seekTT(S.tt + step);
        if (S.tt >= 1) { S.playing = false; playB.textContent = '▶'; if (S.rec) stopRec(); }
      }
      placeCamera(wait ? 0 : dt);
    }
    terrain.update(camera, S.drive ? S.drive.focus : posAt(S.s, _b));
    updateSun();
    posAt(S.s, marker.position); marker.scale.setScalar(camera.position.distanceTo(marker.position) * 0.0055);
    for (const m of lineMats) m.uniforms.prog.value = S.s;
    renderer.render(scene, camera);
    if (S.rec) composite();
    updateLabels(); updateHud();
    if (now - lastProf > 250) { drawProfile(); lastProf = now; }
    O.onTick?.(api.state());
  }

  /* Film aufnehmen: 1920 × 1080, Bild + Einblendungen in einer 2D-Leinwand, pausiert beim Nachladen */
  const comp = document.createElement('canvas'); comp.width = 1920; comp.height = 1080;
  function composite() {
    const x = comp.getContext('2d'), st = stats(), W = 1920, H = 1080;
    x.drawImage(renderer.domElement, 0, 0, W, H);
    if (O.sauber) { // nur Bild, ohne Einblendungen (z. B. Hintergrundvideo auf einer Website)
      x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '400 16px system-ui, sans-serif'; x.textAlign = 'right'; x.fillText('Gelände und Luftbild © swisstopo', W - 28, H - 18); x.textAlign = 'left';
      return;
    }
    const grd = x.createLinearGradient(0, 0, 0, 220); grd.addColorStop(0, 'rgba(0,0,0,.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = grd; x.fillRect(0, 0, W, 220);
    x.fillStyle = '#fff'; x.font = '700 54px system-ui, sans-serif'; x.fillText(O.titel || R.data.name, 60, 96);
    x.font = '400 28px system-ui, sans-serif'; x.globalAlpha = 0.85; x.fillText(O.untertitel || `${fmt(R.data.km)} km · ${fmt(R.data.hoch)} m hinauf`, 60, 140); x.globalAlpha = 1;
    // Werte unten links
    const vals = [[st.km.toFixed(1), 'km'], [fmt(Math.round(st.h)), 'm ü. M.'], [(st.g >= 0 ? '+' : '') + st.g.toFixed(0), '%']];
    let X = 60; x.font = '700 46px system-ui, sans-serif';
    for (const [v, u] of vals) { x.fillStyle = 'rgba(0,0,0,.45)'; const w = x.measureText(v).width + 150; x.beginPath(); x.roundRect(X - 18, H - 250, w, 74, 16); x.fill(); x.fillStyle = '#fff'; x.fillText(v, X, H - 196); x.font = '400 24px system-ui, sans-serif'; x.fillText(u, X + x.measureText(v).width * 0 + w - 128, H - 196); x.font = '700 46px system-ui, sans-serif'; X += w + 16; }
    // Profil unten
    const pw = W - 120, ph = 120, px0 = 60, py0 = H - 150;
    x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.roundRect(px0 - 10, py0 - 10, pw + 20, ph + 20, 14); x.fill();
    x.drawImage(profile, px0, py0, pw, ph);
    if (S.halt) { x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.roundRect(W - 680, 60, 620, 110, 18); x.fill(); x.fillStyle = O.farbe; x.font = '700 40px system-ui, sans-serif'; x.fillText(`${ICON[S.halt.art] || ''} ${S.halt.name}`, W - 650, 112); x.fillStyle = '#fff'; x.font = '400 26px system-ui, sans-serif'; x.fillText([S.halt.text, S.halt.licht].filter(Boolean).join(' · '), W - 650, 150); }
    if (O.sponsorText) { x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.roundRect(W - 420, H - 250, 360, 74, 16); x.fill(); x.fillStyle = '#222'; x.font = '600 26px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText(O.sponsorText, W - 240, H - 203); x.textAlign = 'left'; }
    x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '400 18px system-ui, sans-serif'; x.textAlign = 'right'; x.fillText('Gelände und Luftbild © swisstopo · Strasse © OpenStreetMap', W - 60, H - 12); x.textAlign = 'left';
  }
  function startRec() {
    if (S.rec) return;
    const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('Dieser Browser kann keine Videos aufnehmen.');
    renderer.setPixelRatio(1); renderer.setSize(1920, 1080, false); camera.aspect = 16 / 9; camera.updateProjectionMatrix();
    for (const m of lineMats) { m.uniforms.res.value.set(1920, 1080); m.uniforms.px.value *= 1.6; }
    const mr = new MediaRecorder(comp.captureStream(30), { mimeType: type, videoBitsPerSecond: O.bitrate || 16e6 }), chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { mr.onstop = () => res(new Blob(chunks, { type: type.split(';')[0] })); });
    S.rec = { mr, done, type }; mr.start(500);
    S.mode = 'film'; modeSel.value = 'film'; filmT = 0; S.first = true; seekTT(0); S.playing = true; playB.textContent = '❚❚';
    return done;
  }
  function stopRec() {
    if (!S.rec) return; const r = S.rec; S.rec = null; r.mr.state !== 'inactive' && r.mr.stop();
    for (const m of lineMats) m.uniforms.px.value /= 1.6;
    renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2)); resize(true);
  }

  /* Jahreszeit: Schneegrenze nach Datum (Mitte Januar 700 m … Mitte August 3200 m), wie bei den Bahnfahrten */
  const SNOW_LINE = [700, 800, 1200, 1700, 2200, 2700, 3100, 3200, 3000, 2400, 1500, 900];
  function season() {
    const d = new Date(`${O.datum}T12:00:00Z`); if (isNaN(d)) return;
    const m = ((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 - 14.5) / 30.44, i = Math.floor(m), f = m - i;
    SNOW.line.value = SNOW_LINE[((i % 12) + 12) % 12] * (1 - f) + SNOW_LINE[(((i + 1) % 12) + 12) % 12] * f;
    S.drive?.season?.(O.datum);
  }
  season();
  const api = {
    setRoute, get route() { return R; }, get drive() { return S.drive; }, renderer, camera, scene, get terrain() { return terrain; },
    play() { if (S.tt >= 1) { seekTT(0); filmT = 0; } S.playing = true; playB.textContent = '❚❚'; },
    pause() { S.playing = false; playB.textContent = '▶'; },
    seek(tt, toHalt) { seekTT(tt); if (toHalt) filmT = 0; },
    setMode(m) { S.mode = m; modeSel.value = m; },
    setTime(datum, start, neu) { if (datum) O.datum = datum; if (start) O.start = start; if (neu && S.drive) S.drive.t = 0; season(); },
    set(o) { Object.assign(O, o); if (R && (o.titel || o.untertitel)) $('.s3-title').innerHTML = `<b>${O.titel || R.data.name}</b><span>${O.untertitel || ''}</span>`; },
    /** Selbst fahren (lädt das Fahr-Modul erst bei Bedarf) */
    async fahren(on = true) {
      if (!on) { S.drive?.stop(); S.drive = null; for (const m of lineMeshes) m.visible = true; marker.visible = true; driveB.textContent = '🚗 Selbst fahren'; return; }
      if (!R) return;
      api.pause(); driveB.disabled = true; driveB.textContent = 'Lädt …';
      try {
        const { startFahren } = await import('./fahren3d.js?v=28');
        S.drive = await startFahren({ THREE, scene, camera, renderer, erde, get terrain() { return terrain; }, R, S, O, root, sunL, posAt, idxAt, hAt });
        for (const m of lineMeshes) m.visible = false; marker.visible = false;
        driveB.textContent = '✕ Beenden';
      } finally { driveB.disabled = false; }
    },
    record: startRec, stopRecording: stopRec, get filmbild() { return comp; },
    /** Für Tests im Hintergrund (ohne Bildwiederholung): n Bilder im Abstand dt (ms) rechnen */
    tick(n = 1, dt = 33) { for (let i = 0; i < n; i++) body(S.last + dt); },
    state() { return R ? { tt: S.tt, s: S.s, mode: S.mode, playing: S.playing, loaded: S.loadedOnce, tiles: terrain.loadedCount, pending: terrain.pending, sun: S.sun, halt: S.halt?.name, rec: !!S.rec, drive: S.drive?.state() } : null; },
  };
  if (O.strecke) setRoute(O.strecke);
  requestAnimationFrame(frame);
  return api;
}
