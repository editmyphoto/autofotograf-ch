/* Kopie aus der Sonnenstand-3D-Engine (engine/tiles3d.js), nicht hier bearbeiten: ideen/tools/build_autofotograf.py */
/* Echte 3D-Gebäude (swissBUILDINGS3D) und Einzelbäume (Vegetation 3D) von swisstopo – 3D Tiles, Open Data.
   Liefert Three.js-Objekte im lokalen Koordinatensystem des Sonnen-Tools:
   x = Osten, y = Höhe (ellipsoidisch, wird später auf das Gelände ausgerichtet), z = Süden (Meter). */
import * as THREE from './three.module.js';
import { GLTFLoader } from './addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './addons/loaders/DRACOLoader.js';
import { mergeGeometries } from './addons/utils/BufferGeometryUtils.js';

const BLD = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/';
const VEG = 'https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/';
const DRACO = globalThis.SC_VENDOR ? `${globalThis.SC_VENDOR}three/examples/jsm/libs/draco/gltf/` : 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';
const D2R = Math.PI / 180;
const jsonCache = new Map();
let gltf = null;

/* Abfragen beim swisstopo-Server. Ist er kurz überlastet (Netzfehler, 429, 5xx), wird bis zu zweimal mit Pause nochmals gefragt.
   403/404 heisst «diese Kachel gibt es nicht» und wird nicht wiederholt. Ein Fehlschlag wird nicht gemerkt: Die nächste Abfrage versucht es neu. */
const pause = ms => new Promise(r => setTimeout(r, ms));
async function fetchTry(url, read) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url); if (r.ok) return await read(r); if (r.status !== 429 && r.status < 500) return null; } catch { /* nochmals */ }
    if (i < 2) await pause(900 * (i + 1));
  }
  return null;
}
const getJSON = url => { if (!jsonCache.has(url)) { const p = fetchTry(url, r => r.json()); jsonCache.set(url, p); p.then(j => { if (j == null && jsonCache.get(url) === p) jsonCache.delete(url); }); } return jsonCache.get(url); };
const getBin = url => fetchTry(url, r => r.arrayBuffer());

/** Alle Inhalts-Kacheln, deren Region das Rechteck [w,s,e,n] (Radiant) schneidet (Verfeinerung ADD → alle Ebenen). */
async function contentTiles(base, box) {
  const out = [];
  const hit = r => !r || !(r[2] < box[0] || r[0] > box[2] || r[3] < box[1] || r[1] > box[3]);
  async function walk(tile, dir) {
    const r = tile.boundingVolume?.region;
    if (!hit(r)) return;
    const jobs = [];
    const uri = tile.content?.uri || tile.content?.url;
    if (uri) {
      if (uri.endsWith('.json')) {
        jobs.push(getJSON(dir + uri).then(j => j && walk(j.root, dir + (uri.includes('/') ? uri.slice(0, uri.lastIndexOf('/') + 1) : ''))));
      } else out.push(dir + uri);
    }
    for (const c of tile.children || []) jobs.push(walk(c, dir));
    await Promise.all(jobs);
  }
  const root = await getJSON(base + 'tileset.json');
  if (!root) return null;
  await walk(root.root, base);
  return out;
}

/* Die Kacheln liegen in einem festen Raster über der Schweiz (eine Ebene, Verfeinerung ADD).
   Statt das grosse Verzeichnis (mehrere 100 KB JSON) zu durchsuchen, berechnen wir die Adressen direkt.
   Wechselt swisstopo die Version, fallen wir auf die Verzeichnis-Suche zurück. */
const GRID = {
  bld: { ver: '20260520', L: 11, ext: 'b3dm', r: [0.1040118274090453, 0.7996693601551821, 0.1831240027021035, 0.8342953819889662] },
  veg: { ver: '20250728', L: 10, ext: 'i3dm', r: [0.10395173048091878, 0.799669540091651, 0.18307746929678748, 0.83441919811829] },
};
function gridTiles(base, g, box) {
  const n = 2 ** g.L, dx = (g.r[2] - g.r[0]) / n, dy = (g.r[3] - g.r[1]) / n, out = [];
  const x0 = Math.floor((box[0] - g.r[0]) / dx), x1 = Math.floor((box[2] - g.r[0]) / dx);
  const y0 = Math.floor((box[1] - g.r[1]) / dy), y1 = Math.floor((box[3] - g.r[1]) / dy);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${base}${g.ver}/${g.L}/${x}/${y}.${g.ext}`);
  return out;
}
let versionOk = null;
async function gridVersionOk() {
  // Kam die Antwort nicht an, gilt das nicht als «andere Version»: beim nächsten Mal wird neu gefragt (sonst lüde die Seite bis zum Neuladen keine Häuser)
  if (!versionOk) { const p = getJSON(BLD + 'tileset.json').then(j => { if (j == null) { if (versionOk === p) versionOk = null; return false; } return (j?.root?.children?.[0]?.content?.uri || '').startsWith(GRID.bld.ver + '/'); }).catch(() => { if (versionOk === p) versionOk = null; return false; }); versionOk = p; }
  return versionOk;
}

/** Matrix ECEF → lokal (x Ost, y Oben, z Süd) mit Ursprung lat/lon auf dem Ellipsoid */
function ecefToLocal(lat, lon) {
  const a = 6378137, e2 = 6.69437999014e-3, f = lat * D2R, l = lon * D2R;
  const sf = Math.sin(f), cf = Math.cos(f), sl = Math.sin(l), cl = Math.cos(l), N = a / Math.sqrt(1 - e2 * sf * sf);
  const O = new THREE.Vector3(N * cf * cl, N * cf * sl, N * (1 - e2) * sf);
  const R = new THREE.Matrix4().set(
    -sl, cl, 0, 0,
    cf * cl, cf * sl, sf, 0,
    sf * cl, sf * sl, -cf, 0,
    0, 0, 0, 1);
  return R.multiply(new THREE.Matrix4().makeTranslation(-O.x, -O.y, -O.z));
}

function header(dv, off, n) { const a = []; for (let i = 0; i < n; i++) a.push(dv.getUint32(off + i * 4, true)); return a; }
const txt = new TextDecoder();

async function parseB3dm(buf, L) {
  const dv = new DataView(buf);
  const [, , , ftj, ftb, btj, btb] = header(dv, 0, 7);
  const ft = JSON.parse(txt.decode(new Uint8Array(buf, 28, ftj)));
  const glbOff = 28 + ftj + ftb + btj + btb;
  if (!gltf) { const d = new DRACOLoader().setDecoderPath(DRACO); gltf = new GLTFLoader().setDRACOLoader(d); }
  const g = await gltf.parseAsync(buf.slice(glbOff), '');
  const rtc = ft.RTC_CENTER || [0, 0, 0];
  const M = L.clone().multiply(new THREE.Matrix4().makeTranslation(rtc[0], rtc[1], rtc[2])).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  g.scene.updateMatrixWorld(true);
  const geos = [];
  g.scene.traverse(o => {
    if (!o.isMesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', o.geometry.attributes.position.clone());
    const bid = o.geometry.attributes._batchid || o.geometry.attributes._BATCHID; // Nummer des Gebäudes in der Kachel
    if (bid) geo.setAttribute('_batchid', bid.clone());
    if (o.geometry.index) geo.setIndex(o.geometry.index.clone());
    geo.applyMatrix4(M.clone().multiply(o.matrixWorld));
    geos.push(geo.index ? geo.toNonIndexed() : geo);
  });
  return geos;
}

function parseI3dmPositions(buf, off, L, out) {
  const dv = new DataView(buf, off);
  const [, , , ftj, ftb] = header(dv, 0, 8);
  const ft = JSON.parse(txt.decode(new Uint8Array(buf, off + 32, ftj)));
  const fb = off + 32 + ftj, n = ft.INSTANCES_LENGTH;
  const rtc = ft.RTC_CENTER || [0, 0, 0];
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (ft.POSITION) {
      const p = new Float32Array(buf, fb + ft.POSITION.byteOffset + i * 12, 3);
      v.set(p[0] + rtc[0], p[1] + rtc[1], p[2] + rtc[2]);
    } else if (ft.POSITION_QUANTIZED) {
      const q = new Uint16Array(buf.slice(fb + ft.POSITION_QUANTIZED.byteOffset + i * 6, fb + ft.POSITION_QUANTIZED.byteOffset + i * 6 + 6));
      const o = ft.QUANTIZED_VOLUME_OFFSET, s = ft.QUANTIZED_VOLUME_SCALE;
      v.set(o[0] + q[0] / 65535 * s[0] + rtc[0], o[1] + q[1] / 65535 * s[1] + rtc[1], o[2] + q[2] / 65535 * s[2] + rtc[2]);
    } else continue;
    const s = ft.SCALE ? new DataView(buf, fb + ft.SCALE.byteOffset + i * 4, 4).getFloat32(0, true) : 10;
    v.applyMatrix4(L);
    out.push({ x: v.x, y: v.y, z: v.z, h: s });
  }
}

function parseVeg(buf, L, out) {
  const dv = new DataView(buf), magic = txt.decode(new Uint8Array(buf, 0, 4));
  if (magic === 'i3dm') return parseI3dmPositions(buf, 0, L, out);
  if (magic !== 'cmpt') return;
  const n = dv.getUint32(12, true); let off = 16;
  for (let k = 0; k < n; k++) {
    const m = txt.decode(new Uint8Array(buf, off, 4)), len = dv.getUint32(off + 8, true);
    if (m === 'i3dm') parseI3dmPositions(buf, off, L, out);
    off += len;
  }
}

async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]).catch(() => null); } }));
  return res;
}

/**
 * Lädt Gebäude und Bäume für ein Quadrat der Seitenlänge S (m) um lat/lon.
 * Rückgabe { buildings: BufferGeometry|null, trees: [{x,y,z,h}] } – Höhen ellipsoidisch.
 */
export async function loadCity(lat, lon, S, onStatus) {
  const hl = S / 2 / 111320, hn = S / 2 / (111320 * Math.cos(lat * D2R));
  const box = [(lon - hn) * D2R, (lat - hl) * D2R, (lon + hn) * D2R, (lat + hl) * D2R];
  const L = ecefToLocal(lat, lon);
  onStatus?.('3D-Gebäude und Bäume suchen …', 0);
  const [bt, vt] = (await gridVersionOk()) ? [gridTiles(BLD, GRID.bld, box), gridTiles(VEG, GRID.veg, box)] : await Promise.all([contentTiles(BLD, box), contentTiles(VEG, box)]);
  if (!bt) return null;
  let done = 0; const total = bt.length + (vt?.length || 0);
  const tick = () => { ++done; onStatus?.('3D-Gebäude und Bäume laden …', done / Math.max(1, total)); };
  const inside = (x, z, m = 0) => Math.abs(x) <= S / 2 + m && Math.abs(z) <= S / 2 + m;
  const [bgeos, trees] = await Promise.all([
    pool(bt, 12, async u => { const b = await getBin(u); tick(); return b ? parseB3dm(b, L) : []; }),
    (async () => { const out = []; await pool(vt || [], 12, async u => { const b = await getBin(u); tick(); if (b) parseVeg(b, L, out); }); return out; })(),
  ]);
  const list = [];
  for (const arr of bgeos) for (const g of arr || []) {
    g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3());
    if (inside(c.x, c.z)) { g.userData.minY = g.boundingBox.min.y; g.userData.cx = c.x; g.userData.cz = c.z; list.push(g); }
  }
  return { parts: list, trees: trees.filter(t => inside(t.x, t.z)) };
}

/** Baut die Gebäude als ein Mesh (helles Architekturmodell) */
/** Welches Gebäude steht an (x, z)? Dach-Dreieck über dem Punkt, sonst nächster Eckpunkt bis 12 m.
    Rückgabe: Schlüssel (Teil × 100000 + Gebäudenummer) oder null. Braucht die Attribute _part und _batchid (siehe buildingMesh). */
export function houseKeyAt(geo, x, z) {
  const P = geo.attributes.position, B = geo.attributes._batchid, T = geo.attributes._part; if (!P || !T) return null;
  const key = i => T.getX(i) * 100000 + (B ? B.getX(i) : 0);
  let best = null, bestY = -Infinity, near = null, nearD = 12;
  for (let i = 0; i + 2 < P.count; i += 3) {
    const ax = P.getX(i), az = P.getZ(i);
    if (Math.abs(ax - x) > 80 || Math.abs(az - z) > 80) continue;
    const bx = P.getX(i + 1), bz = P.getZ(i + 1), cx = P.getX(i + 2), cz = P.getZ(i + 2);
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) {
      const y = Math.max(P.getY(i), P.getY(i + 1), P.getY(i + 2));
      if (y > bestY) { bestY = y; best = key(i); }
    }
    const d = Math.hypot(ax - x, az - z); if (d < nearD) { nearD = d; near = key(i); }
  }
  return best ?? near;
}

/** Gebäude herausnehmen, die ein genaues Objekt-Modell ersetzt («Haus nach Fotos», hausmodell.js).
    pts = [[x, z], …]: Punkte auf den Gebäuden (Koordinaten wie die Teile aus loadCity).
    Rückgabe { parts: Teile ohne diese Gebäude, removed: Float32Array mit den Dreiecken der entfernten Gebäude (x, y, z) }. */
export function cutHouses(parts, pts) {
  const removed = [];
  const out = parts.map(g => {
    const P = g.attributes.position, B = g.attributes._batchid; if (!B) return g;
    const ids = new Set();
    for (let i = 0; i + 2 < P.count; i += 3) {
      const ax = P.getX(i), az = P.getZ(i), bx = P.getX(i + 1), bz = P.getZ(i + 1), cx = P.getX(i + 2), cz = P.getZ(i + 2);
      for (const [x, z] of pts) {
        if (Math.abs(ax - x) > 80 || Math.abs(az - z) > 80) continue;
        const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) ids.add(Math.round(B.getX(i)));
      }
    }
    if (!ids.size) return g;
    const pos = [], bid = [];
    for (let i = 0; i + 2 < P.count; i += 3) {
      const hit = ids.has(Math.round(B.getX(i)));
      for (let k = 0; k < 3; k++) { if (hit) removed.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k)); else { pos.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k)); bid.push(B.getX(i + k)); } }
    }
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); c.setAttribute('_batchid', new THREE.Float32BufferAttribute(bid, 1));
    Object.assign(c.userData, g.userData);
    return c;
  }).filter(g => g.attributes.position.count > 0);
  return { parts: out, removed: new Float32Array(removed) };
}

/** Gebäude mit den Schlüsseln keys warm einfärben, alle anderen neutral. Ohne Gebäudenummer (_batchid) nur kleine Teile (< 60 m). */
export function tintHouses(mesh, keys) {
  const g = mesh?.geometry, C = g?.attributes.color, T = g?.attributes._part, B = g?.attributes._batchid; if (!C || !T) return;
  const set = new Set(keys.filter(k => k != null && (B || mesh.userData.smallParts?.has(Math.floor(k / 100000)))));
  for (let i = 0; i < C.count; i++) { const on = set.has(T.getX(i) * 100000 + (B ? B.getX(i) : 0)); C.setXYZ(i, 1, on ? 0.8 : 1, on ? 0.5 : 1); }
  C.needsUpdate = true;
}

/* ---------- Jahreszeit (schematisch): Herbstlaub, kahle Laubbäume, Schneedecke ----------
   Gemeinsame Werte für alle Materialien; setSeason(datum, base) beim Datumswechsel aufrufen (ohne neu zu laden).
   Schneegrenze: typische Werte für die Schweizer Alpen je Monatsmitte (nicht der Schnee am gewählten Tag).
   Laub- oder Nadelbaum: nicht in den Daten → nach Höhenlage geschätzt (Tal viele Laubbäume, um 1600–2200 m Lärchen). */
export const SEASON = { autumn: { value: 0 }, bare: { value: 0 }, snowLine: { value: 1e5 }, base: { value: 0 } };
const SNOW_LINE = [700, 800, 1200, 1700, 2200, 2700, 3100, 3200, 3000, 2400, 1500, 900]; // Mitte Jan … Mitte Dez (m ü. M.)
export function setSeason(dateIso, base) {
  const d = new Date(`${dateIso}T12:00:00Z`); if (isNaN(d)) return;
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1), doy = (d - y0) / 864e5; // Tag im Jahr (0 = 1. Jan.)
  const m = (doy - 14.5) / 30.44, i = Math.floor(m), f = m - i, a = SNOW_LINE[((i % 12) + 12) % 12], b = SNOW_LINE[(((i + 1) % 12) + 12) % 12];
  SEASON.snowLine.value = a + (b - a) * f;
  const ss = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  // Herbstfarben ab ca. 20. Sept., am stärksten Mitte Okt. bis Anfang Nov.; kahl ab ca. 10. Nov. bis Mitte April, Austrieb bis Anfang Mai
  SEASON.autumn.value = ss(262, 285, doy) * (1 - ss(305, 325, doy));
  SEASON.bare.value = Math.max(ss(308, 330, doy), 1 - ss(100, 122, doy));
  if (base != null) SEASON.base.value = base;
}
const SNOW_GLSL = `
  float snowAmt( float hAbs, float ny ) {
    float s = smoothstep( snowLine - 120.0, snowLine + 120.0, hAbs );
    return s * smoothstep( 0.55, 0.78, ny ); // steile Felsen bleiben frei
  }`;
/** Schneedecke auf Gelände (Wiesen, Berge) oberhalb der Schneegrenze; verkettbar mit withMask */
export function withSnow(mat) {
  const own = k => Object.prototype.hasOwnProperty.call(mat, k), prev = own('onBeforeCompile') ? mat.onBeforeCompile : null, prevKey = own('customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.snowLine = SEASON.snowLine; sh.uniforms.seasonBase = SEASON.base;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnW; varying vec3 vSnN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSnW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vSnN = mat3( modelMatrix ) * objectNormal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSnW; varying vec3 vSnN; uniform float snowLine; uniform float seasonBase;${SNOW_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float amt = snowAmt( vSnW.y + seasonBase, normalize( vSnN ).y );
  float lum = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  amt *= mix( 0.5, 1.0, smoothstep( 0.12, 0.4, lum ) ); // Wald (dunkel im Luftbild) bleibt teils dunkel
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.94, 0.95, 0.97 ), amt * 0.92 );
}`);
  };
  mat.customProgramCacheKey = () => `snow|${prevKey ? prevKey() : ''}`;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Schematische Fassaden, direkt im Shader (keine zusätzlichen Daten, keine Geometrie). Stufe 1 + 2:
 * - dezentes Fensterraster (ein Fenster etwa alle 2.8 m, Stockwerk 3 m ab Hausfuss), mit hellem Rahmen
 * - Sockelstreifen unten an der Wand, Dächer etwas wärmer und dunkler als die Wände
 * - jedes Haus leicht anders getönt (heller/dunkler, wärmer/kühler), damit Häuserzeilen nicht wie ein Block wirken
 * Pro Ecke braucht es nur das Attribut facInfo = (Zufallswert des Hauses, Höhe des Hausfusses); fehlt der Fuss (< -9e5),
 * zählen die Stockwerke ab absoluter Höhe und es gibt keinen Sockel. Aus der Ferne blendet das Raster aus (kein Flimmern).
 */
export const FACADE = { on: true, strength: 0.13 };
export function withFacade(mat) {
  if (!FACADE.on) return mat;
  const own = k => Object.prototype.hasOwnProperty.call(mat, k), prev = own('onBeforeCompile') ? mat.onBeforeCompile : null, prevKey = own('customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 facInfo; varying vec3 vFacW; varying vec3 vFacN; varying vec2 vFacI;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFacW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vFacN = mat3( modelMatrix ) * objectNormal; vFacI = facInfo;');
    sh.uniforms.snowLine = SEASON.snowLine; sh.uniforms.seasonBase = SEASON.base;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFacW; varying vec3 vFacN; varying vec2 vFacI; uniform float snowLine; uniform float seasonBase;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 fn = normalize( vFacN );
  float wall = 1.0 - smoothstep( 0.2, 0.4, abs( fn.y ) ), roof = smoothstep( 0.35, 0.6, abs( fn.y ) );
  bool hasBase = vFacI.y > -9e5;
  float hy = hasBase ? vFacW.y - vFacI.y : vFacW.y;
  // Haus-Tönung: Helligkeit ±5 %, wärmer/kühler
  float v = vFacI.x, t = fract( v * 7.31 ) - 0.5;
  vec3 tint = vec3( 1.0 + 0.04 * t, 1.0, 1.0 - 0.05 * t ) * ( 0.95 + 0.1 * v );
  diffuseColor.rgb *= mix( vec3( 1.0 ), tint, wall );
  // Dächer: wärmer und etwas dunkler, je Haus leicht verschieden (Ziegel bis Grau)
  vec3 roofCol = mix( vec3( 0.86, 0.78, 0.72 ), vec3( 0.80, 0.80, 0.80 ), fract( v * 3.7 ) );
  diffuseColor.rgb *= mix( vec3( 1.0 ), roofCol, roof );
  // Schnee auf Dächern oberhalb der Schneegrenze
  float rs = roof * smoothstep( snowLine - 120.0, snowLine + 120.0, vFacW.y + seasonBase );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.96, 0.98 ), rs * 0.9 );
  // Fensterraster mit Rahmen
  vec2 tg = normalize( vec2( -fn.z, fn.x ) + 1e-5 );
  vec2 c = vec2( dot( vFacW.xz, tg ) / 2.8, ( hy - ( hasBase ? 0.0 : 0.0 ) ) / 3.0 );
  vec2 w = fwidth( c ) + 1e-4;
  vec2 f = fract( c );
  float wu = smoothstep( 0.29 - w.x, 0.29 + w.x, f.x ) * ( 1.0 - smoothstep( 0.71 - w.x, 0.71 + w.x, f.x ) );
  float wv = smoothstep( 0.30 - w.y, 0.30 + w.y, f.y ) * ( 1.0 - smoothstep( 0.78 - w.y, 0.78 + w.y, f.y ) );
  float ou = smoothstep( 0.25 - w.x, 0.25 + w.x, f.x ) * ( 1.0 - smoothstep( 0.75 - w.x, 0.75 + w.x, f.x ) );
  float ov = smoothstep( 0.26 - w.y, 0.26 + w.y, f.y ) * ( 1.0 - smoothstep( 0.82 - w.y, 0.82 + w.y, f.y ) );
  float fade = 1.0 - smoothstep( 0.12, 0.3, max( w.x, w.y ) );
  float above = hasBase ? smoothstep( 0.9, 1.1, hy ) : 1.0; // keine Fenster im Sockel
  float win = wu * wv, frame = ou * ov - win;
  diffuseColor.rgb *= 1.0 + ( 0.05 * frame - ${FACADE.strength.toFixed(3)} * win ) * wall * fade * above;
  // Sockel: unterster halber Meter etwas dunkler
  if ( hasBase ) diffuseColor.rgb *= 1.0 - 0.07 * wall * ( 1.0 - smoothstep( 0.5, 0.6, hy ) ) * step( -0.5, hy );
}`);
  };
  mat.customProgramCacheKey = () => `fac3|${prevKey ? prevKey() : ''}`;
  mat.needsUpdate = true;
  return mat;
}

/* Pro Ecke: Zufallswert des Hauses und Höhe des sichtbaren Hausfusses (je _batchid, sonst pro Teil ohne Fuss).
   Die Wände von swissBUILDINGS3D reichen meist 3–5 m unter das Gelände (Prüfung 19.11. an 5 Orten). Mit groundAt
   zählt der Fuss deshalb ab dem tiefsten Geländepunkt entlang der Unterkante (talseitig sichtbar), nie unter die Unterkante. */
function facadeInfo(c, gi, batch, groundAt) {
  const n = c.attributes.position.count, P = c.attributes.position, out = new Float32Array(n * 2);
  const rnd = k => { const x = Math.sin(k * 12.9898 + gi * 78.233) * 43758.5453; return x - Math.floor(x); };
  if (batch) {
    const minY = new Map();
    for (let i = 0; i < n; i++) { const b = batch.getX(i), y = P.getY(i), m = minY.get(b); if (m === undefined || y < m) minY.set(b, y); }
    const base = new Map(minY);
    if (groundAt) {
      const gmin = new Map(), cnt = new Map();
      for (let i = 0; i < n; i++) {
        const b = batch.getX(i); if (P.getY(i) > minY.get(b) + 0.3 || (cnt.get(b) || 0) >= 16) continue;
        const g = groundAt(P.getX(i), P.getZ(i)); if (g == null || !Number.isFinite(g) || g > minY.get(b) + 15) continue; // obere Bauteile (Turm, Aufbau) behalten ihre Unterkante
        cnt.set(b, (cnt.get(b) || 0) + 1); if (!gmin.has(b) || g < gmin.get(b)) gmin.set(b, g);
      }
      for (const [b, g] of gmin) base.set(b, Math.max(minY.get(b), g));
    }
    for (let i = 0; i < n; i++) { const b = batch.getX(i); out[i * 2] = rnd(b + 1); out[i * 2 + 1] = base.get(b); }
  } else for (let i = 0; i < n; i++) { out[i * 2] = rnd(0); out[i * 2 + 1] = -1e6; }
  c.setAttribute('facInfo', new THREE.BufferAttribute(out, 2));
}

/** Gebäude zu einem Mesh zusammenfügen. tintable: Farben und Gebäudeschlüssel vorbereiten (Einfärben für Makler, tintHouses).
    groundAt(x, z): Geländehöhe in denselben Koordinaten (optional, für den sichtbaren Hausfuss der Fassaden). */
export function buildingMesh(parts, dy, tintable, groundAt) {
  if (!parts.length) return null;
  const all = parts.every(g => g.attributes._batchid);
  const small = new Set();
  const gs = parts.map((g, gi) => {
    const c = g.clone().translate(0, dy, 0);
    if (FACADE.on) facadeInfo(c, gi, c.attributes._batchid, groundAt);
    if (!all && c.attributes._batchid) c.deleteAttribute('_batchid');
    if (tintable) {
      const n = c.attributes.position.count;
      c.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      c.setAttribute('_part', new THREE.BufferAttribute(new Float32Array(n).fill(gi), 1));
      if (!all) { c.computeBoundingBox(); const sz = c.boundingBox.getSize(new THREE.Vector3()); if (Math.max(sz.x, sz.z) < 60) small.add(gi); }
    }
    return c;
  });
  const geo = mergeGeometries(gs, false);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, withFacade(new THREE.MeshLambertMaterial({ color: 0xf3eee6, side: THREE.DoubleSide, vertexColors: !!tintable })));
  m.userData.smallParts = small;
  m.castShadow = m.receiveShadow = true; m.name = 'buildings';
  return m;
}

/* Baumkronen nach Jahreszeit: Laubbäume (nach Höhenlage geschätzt) im Herbst gelb-orange-rötlich, im Winter kahl (graubraun) */
function withTreeSeason(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.autumn = SEASON.autumn; sh.uniforms.bare = SEASON.bare; sh.uniforms.seasonBase = SEASON.base;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 tInfo; varying vec2 vTI;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTI = tInfo;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTI; uniform float autumn; uniform float bare; uniform float seasonBase;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float h = vTI.y + seasonBase, r = vTI.x;
  // Anteil Laubbäume nach Höhe: Tal ~65 %, 1200–1600 m ~20 %, Lärchen 1600–2200 m ~35 %, darüber wenig
  float p = mix( 0.65, 0.45, smoothstep( 700.0, 1000.0, h ) );
  p = mix( p, 0.2, smoothstep( 1100.0, 1400.0, h ) );
  p = mix( p, 0.35, smoothstep( 1550.0, 1700.0, h ) );
  p = mix( p, 0.1, smoothstep( 2150.0, 2350.0, h ) );
  float dec = step( r, p );
  float k = fract( r * 13.7 );
  vec3 fall = mix( vec3( 0.86, 0.66, 0.22 ), vec3( 0.84, 0.45, 0.16 ), smoothstep( 0.2, 0.7, k ) );
  fall = mix( fall, vec3( 0.66, 0.27, 0.15 ), smoothstep( 0.8, 1.0, k ) * step( h, 1500.0 ) ); // vereinzelt rötlich (nicht bei Lärchen)
  diffuseColor.rgb = mix( diffuseColor.rgb, fall, dec * autumn * 0.9 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.47, 0.42, 0.37 ), dec * bare * 0.85 );
}`);
  };
  mat.customProgramCacheKey = () => 'treeseason';
  mat.needsUpdate = true;
  return mat;
}

/** Bäume als zwei InstancedMeshes (Stamm + Krone) */
export function treeMeshes(trees, groundAt) {
  if (!trees.length) return [];
  const crownG = new THREE.IcosahedronGeometry(1, 1).scale(0.21, 0.34, 0.21).translate(0, 0.62, 0);
  const trunkG = new THREE.CylinderGeometry(0.022, 0.03, 0.34, 6).translate(0, 0.17, 0);
  const crown = new THREE.InstancedMesh(crownG, withTreeSeason(new THREE.MeshLambertMaterial({ color: 0xffffff })), trees.length);
  const tInfo = new Float32Array(trees.length * 2);
  const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x7a6248 }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  trees.forEach((t, i) => {
    const h = Math.max(3, Math.min(45, t.h));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.39996) % (Math.PI * 2));
    m.compose(p.set(t.x, groundAt(t.x, t.z) - 0.3, t.z), q, s.set(h, h, h));
    crown.setMatrixAt(i, m); trunk.setMatrixAt(i, m);
    tInfo[i * 2] = ((i * 0.6180339887) + Math.sin(t.x * 12.99 + t.z * 78.23) * 0.5 + 10) % 1; tInfo[i * 2 + 1] = p.y; // Zufall, Höhe in der Szene
    crown.setColorAt(i, col.setHSL(0.24 + ((i * 37) % 10) / 200, 0.32, 0.30 + ((i * 53) % 10) / 120));
  });
  for (const x of [crown, trunk]) { x.castShadow = x.receiveShadow = true; x.instanceMatrix.needsUpdate = true; }
  crown.instanceColor.needsUpdate = true;
  crownG.setAttribute('tInfo', new THREE.InstancedBufferAttribute(tInfo, 2));
  return [crown, trunk];
}

/**
 * Gebäude und Bäume nur dort, wo keep(x, z) wahr ist (z. B. ein Blickkeil der Fotografen-Ansicht).
 * box = [xMin, zMin, xMax, zMax] in lokalen Metern um lat/lon (x Ost, z Süd). Lädt nur Kacheln, die den Bereich berühren.
 */
export async function loadCityWhere(lat, lon, box, keep, onStatus) {
  const cos = Math.cos(lat * D2R), mx = 111320 * cos, my = 110574;
  const geo = [(lon + box[0] / mx) * D2R, (lat - box[3] / my) * D2R, (lon + box[2] / mx) * D2R, (lat - box[1] / my) * D2R];
  const L = ecefToLocal(lat, lon);
  if (!(await gridVersionOk())) return null;
  // Kachel behalten, wenn ihre Mitte oder eine Ecke im Bereich liegt (Kacheln sind ~170 × 110 m bzw. ~340 × 220 m)
  const pick = (base, g) => {
    const n = 2 ** g.L, dx = (g.r[2] - g.r[0]) / n, dy = (g.r[3] - g.r[1]) / n, out = [];
    const x0 = Math.floor((geo[0] - g.r[0]) / dx), x1 = Math.floor((geo[2] - g.r[0]) / dx);
    const y0 = Math.floor((geo[1] - g.r[1]) / dy), y1 = Math.floor((geo[3] - g.r[1]) / dy);
    const loc = (rx, ry) => [((rx / D2R) - lon) * mx, -((ry / D2R) - lat) * my];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const ax = g.r[0] + x * dx, ay = g.r[1] + y * dy;
      const pts = [loc(ax + dx / 2, ay + dy / 2), loc(ax, ay), loc(ax + dx, ay), loc(ax, ay + dy), loc(ax + dx, ay + dy)];
      if (pts.some(([px, pz]) => keep(px, pz, 120))) out.push(`${base}${g.ver}/${g.L}/${x}/${y}.${g.ext}`);
    }
    return out;
  };
  const bt = pick(BLD, GRID.bld), vt = pick(VEG, GRID.veg);
  let done = 0; const total = bt.length + vt.length;
  const tick = () => { ++done; onStatus?.('3D-Gebäude und Bäume laden …', done / Math.max(1, total)); };
  const [bgeos, trees] = await Promise.all([
    pool(bt, 24, async u => { const b = await getBin(u); tick(); return b ? parseB3dm(b, L) : []; }),
    (async () => { const out = []; await pool(vt, 24, async u => { const b = await getBin(u); tick(); if (b) parseVeg(b, L, out); }); return out; })(),
  ]);
  const list = [];
  for (const arr of bgeos) for (const g of arr || []) {
    g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3());
    if (keep(c.x, c.z, 0)) { g.userData.minY = g.boundingBox.min.y; g.userData.cx = c.x; g.userData.cz = c.z; list.push(g); }
  }
  return { parts: list, trees: trees.filter(t => keep(t.x, t.z, 0)), tiles: bt.length };
}
