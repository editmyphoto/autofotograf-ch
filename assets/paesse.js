/* Pässefahrten 3D: Pass wählen, Datum und Uhrzeit einstellen, selbst fahren oder als Flug ansehen.
   Die 3D-Fahrt lädt erst auf Knopfdruck Daten von swisstopo. */
const $ = id => document.getElementById(id);
const fmt = v => new Intl.NumberFormat('de-CH').format(v);
const cache = {};
const load = k => cache[k] ||= fetch(`assets/3d/strecken/${k}.json?v=5`).then(r => r.json());

let key = 'julier', F = null, data = null;
// Voreinstellung: heute, jetzt (nachts 15:00, damit man etwas sieht)
{ const now = new Date(), p = n => String(n).padStart(2, '0'), h = now.getHours();
  $('pfDate').value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  $('pfTime').value = h >= 8 && h < 17 ? `${p(h)}:${p(Math.floor(now.getMinutes() / 5) * 5)}` : '15:00'; }

function render() {
  const d = data;
  $('pfMeta').textContent = `${d.von} – ${d.nach} · ${fmt(d.km)} km · ${fmt(d.hoch)} m hinauf · höchster Punkt ${fmt(d.max)} m ü. M. · ${d.saison || ''} Strasse vor der Fahrt prüfen.`;
  if (F) apply3d();
}
function apply3d() {
  const d = data, wasDriving = !!F.drive;
  const view = { ...d, halte: d.halte.map(h => ({ ...h, licht: undefined })) };
  F.set({ titel: d.name, untertitel: `${d.von} – ${d.nach} · ${fmt(d.km)} km` });
  F.setTime($('pfDate').value, $('pfTime').value);
  F.setRoute(view);
  if (wasDriving) F.fahren(true);
}
async function choose(k) {
  key = k;
  $('pfPass').value = k; if (location.hash.slice(1) !== k) history.replaceState(null, '', '#' + k);
  data = await load(k); render();
}
$('pfPass').addEventListener('change', async () => { F?.pause(); await choose($('pfPass').value); });
for (const id of ['pfDate', 'pfTime']) $(id).addEventListener('change', () => { if (F && $('pfDate').value && $('pfTime').value) F.setTime($('pfDate').value, $('pfTime').value, true); });

async function start3d(drive) {
  const btns = [$('pfStart'), $('pfDrive')]; for (const b of btns) b.disabled = true;
  const btn = drive ? $('pfDrive') : $('pfStart'), label = btn.textContent; btn.textContent = 'Wird geladen …';
  try {
    globalThis.SC_VENDOR = new URL('./3d/vendor/', import.meta.url).href; // Draco-Decoder für die 3D-Häuser von hier, nicht von einem CDN
    const { mountStrecke } = await import('./3d/strecke3d.js?v=25');
    const host = document.createElement('div'); $('pfStage').replaceChildren(host);
    F = await mountStrecke(host, { farbe: '#e0793c', kmh: 40, dauer: 70, modus: 'film', fahren: true, autofarbe: 0x8e2a1c });
    window.__flug = F;
    apply3d();
    if (drive) { F.seek(0); await F.fahren(true); } else setTimeout(() => F.play(), 400);
  } catch (e) {
    for (const b of btns) b.disabled = false; btn.textContent = label;
    $('pfStage').innerHTML = '<div class="pf-poster"><div class="pf-poster-copy"><p>Die 3D-Fahrt konnte nicht starten. Sie braucht 3D-Grafik (WebGL) im Browser. Oft hilft es, die Seite neu zu laden oder andere Tabs zu schliessen.</p><button class="btn btn-solid" type="button" id="pfReload">Neu laden</button></div></div>';
    $('pfReload').addEventListener('click', () => location.reload());
  }
}
$('pfStart').addEventListener('click', () => start3d(false));
$('pfDrive').addEventListener('click', () => start3d(true));

choose([...$('pfPass').options].some(o => o.value === location.hash.slice(1)) ? location.hash.slice(1) : 'julier');

/* Film auf ganzer Breite: spielt nur, solange er sichtbar ist; lädt erst beim Hinscrollen. Bei «weniger Bewegung» nur Standbild. */
(() => {
  const v = $('pfFilm'), btn = $('pfFilmToggle'); if (!v) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let user = still ? 'pause' : null, seen = false;
  const sync = () => { const play = seen && user !== 'pause'; if (play) v.play().catch(() => {}); else v.pause(); btn.textContent = user === 'pause' ? 'Abspielen' : 'Pause'; btn.setAttribute('aria-pressed', user === 'pause' ? 'true' : 'false'); };
  new IntersectionObserver(es => { seen = es[0].isIntersecting; sync(); }, { threshold: 0.35 }).observe(v);
  btn.addEventListener('click', () => { user = user === 'pause' ? null : 'pause'; sync(); });
  sync();
})();
