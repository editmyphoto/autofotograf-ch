/* Pässefahrten 3D: Fotohalte mit Lichtzeiten (ohne 3D) und 3D-Fahrt auf Knopfdruck (lädt erst dann Daten von swisstopo). */
const $ = id => document.getElementById(id);
const PASS = {
  julier: { saison: 'Ganzjährig offen, im Winter mit Winterausrüstung.', winter: [] },
  albula: { saison: 'Im Winter gesperrt, meist etwa November bis Mai.', winter: [11, 12, 1, 2, 3, 4, 5] },
  fluela: { saison: 'Im Winter zeitweise gesperrt (Lawinengefahr).', winter: [] },
};
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DIR = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
const hh = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const dir = b => DIR[Math.round(b / 45) % 8];
const fmt = v => new Intl.NumberFormat('de-CH').format(v);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cache = {};
const load = k => cache[k] ||= fetch(`assets/3d/strecken/${k}.json?v=1`).then(r => r.json());

let key = 'julier', month = new Date().getMonth() + 1, F = null, data = null;
if (month < 5 || month > 10) month = 6; // ausserhalb der Saison: Juni zeigen
const sel = $('pfMonth');
sel.innerHTML = MON.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
sel.value = month;

/** Licht an einem Halt im gewählten Monat: { best, lines[] } */
function licht(h, m) {
  const r = h.licht?.[m - 1];
  if (!r || r[0] == null) return { best: 'Kommt in diesem Monat nicht über die Berge – Schattenlicht den ganzen Tag.', short: 'den ganzen Tag Schatten', lines: [] };
  const [up, down, upAlt, downAlt, bear, mA, mB, eA, eB] = r, lines = [`Sonne über den Bergen ${hh(up)}–${hh(down)} Uhr`];
  if (mA != null && mB - mA >= 6) lines.push(`Warmes Morgenlicht ${hh(mA)}–${hh(mB)}`);
  let best, short;
  if (eA != null && eB - eA >= 6) { lines.push(`Warmes Abendlicht ${hh(eA)}–${hh(eB)}, Licht aus ${dir(bear)}`); best = `Bestes Licht: abends ${hh(eA)}–${hh(eB)} Uhr`; short = `Abendlicht ${hh(eA)}–${hh(eB)}`; }
  else {
    lines.push(`Sonne verschwindet um ${hh(down)} hinter dem Berg (noch ${Math.round(downAlt)}° hoch), danach weiches Schattenlicht`);
    if (mA != null && mB - mA >= 6) { best = `Bestes Licht: morgens ${hh(mA)}–${hh(mB)} Uhr`; short = `Morgenlicht ${hh(mA)}–${hh(mB)}`; }
    else { best = `Weiches Licht ab ${hh(down)} Uhr (Sonne hinter dem Berg)`; short = `Schattenlicht ab ${hh(down)}`; }
  }
  const okE = eA != null && eB - eA >= 6, okM = mA != null && mB - mA >= 6;
  return { best, short, lines, eA: okE ? eA : null, mA: okM ? mA : null, down };
}

/** Abfahrt so planen, dass man zum besten Licht auf dem wichtigsten Fotohalt ist (Ø 40 km/h). */
function plan(d, m) {
  const fotos = d.halte.filter(h => h.art === 'foto'), main = fotos.find(h => /Höhe/.test(h.name)) || fotos[0];
  if (!main) return null;
  const L = licht(main, m), km = main.i * d.step / 1000, fahr = km / 40 * 60 + 10, start = d.halte[0];
  const ziel = L.eA ?? L.mA ?? L.down;
  if (ziel == null) return { text: `<b>${esc(main.name)}:</b> ${esc(L.best)}`, start: '10:00' };
  const ab = Math.max(300, Math.round((ziel - fahr) / 5) * 5);
  const was = L.eA != null ? 'wenn das Abendlicht beginnt' : L.mA != null ? 'zum Morgenlicht' : 'wenn die Sonne hinter dem Berg verschwindet';
  return { text: `Abfahrt in <b>${esc(start.name)} um ${hh(ab)}</b> → um ${hh(ziel)} auf der <b>${esc(main.name)}</b>, ${was} (${fmt(Math.round(km))} km, Ø 40 km/h, mit Halt).`, start: hh(ab) };
}

function render() {
  const d = data, m = month, p = PASS[key];
  $('pfMeta').textContent = `${d.von} – ${d.nach} · ${fmt(d.km)} km · ${fmt(d.hoch)} m hinauf · höchster Punkt ${fmt(d.max)} m ü. M. · ${p.saison}`;
  const pl = plan(d, m);
  $('pfPlan').innerHTML = (p.winter.includes(m) ? `<b>Im ${MON[m - 1]} ist der Pass meist gesperrt.</b> ` : '') + (pl ? pl.text : '');
  $('pfStops').innerHTML = d.halte.map((h, n) => {
    const L = licht(h, m), km = (h.i * d.step / 1000).toFixed(1);
    return `<button class="pf-stop${h.art === 'foto' ? ' is-foto' : ''}" type="button" data-n="${n}"><span class="k">km ${km}${h.art === 'foto' ? ' · Fotohalt' : h.art === 'start' ? ' · Start' : h.art === 'ziel' ? ' · Ziel' : ''}</span><h3>${esc(h.name)}</h3>${h.text ? `<p class="k">${esc(h.text)}</p>` : ''}<p class="best">${esc(L.best)}</p><ul>${L.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></button>`;
  }).join('');
  for (const h of d.halte) { h.licht_kurz = licht(h, m).short; }
  if (F) { apply3d(); }
}
function apply3d() {
  const d = data, pl = plan(d, month);
  const view = { ...d, halte: d.halte.map(h => ({ ...h, licht: h.licht_kurz })) };
  F.set({ titel: d.name, untertitel: `${d.von} – ${d.nach} · ${fmt(d.km)} km · ${MON[month - 1]}` });
  F.setTime(`2027-${String(month).padStart(2, '0')}-15`, pl?.start || '10:00');
  F.setRoute(view);
}

async function choose(k) {
  key = k;
  for (const b of document.querySelectorAll('.pf-tabs button')) b.setAttribute('aria-selected', b.dataset.k === k ? 'true' : 'false');
  data = await load(k); render();
}
document.querySelector('.pf-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b && b.dataset.k !== key) { F?.pause(); choose(b.dataset.k); } });
sel.addEventListener('change', () => { month = +sel.value; F?.pause(); render(); });
$('pfStops').addEventListener('click', e => {
  const b = e.target.closest('.pf-stop'); if (!b || !F) return;
  const h = data.halte[+b.dataset.n]; F.seek(Math.min(0.999, h.i / (data.pts.length - 1)) * 0.999); F.setMode('drohne');
  $('pfStage').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('pfStart').addEventListener('click', async () => {
  const btn = $('pfStart'); btn.disabled = true; btn.textContent = 'Wird geladen …';
  try {
    const { mountStrecke } = await import('./3d/strecke3d.js?v=1');
    const host = document.createElement('div'); $('pfStage').replaceChildren(host);
    F = await mountStrecke(host, { farbe: '#e0793c', kmh: 40, dauer: 70, modus: 'film' });
    window.__flug = F;
    apply3d();
    setTimeout(() => F.play(), 400);
  } catch (e) {
    btn.disabled = false; btn.textContent = '▶ 3D-Fahrt starten';
    btn.insertAdjacentHTML('afterend', '<p>Die 3D-Fahrt konnte nicht starten. Sie braucht einen aktuellen Browser mit WebGL.</p>');
  }
});

choose('julier');
