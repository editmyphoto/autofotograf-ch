/* ============================================================
   Besucher-Statistik (Vercel Web Analytics, ohne Cookies)
   Zählt anonym: Klicks auf Kontakt-Wege, externe Links, PDFs,
   Elemente mit data-track="Name", abgespielte Videos und wie
   lange eine Seite sichtbar offen war.
   Eigene Ereignisse anderswo: window.va('event', { name: '…' })
   ============================================================ */
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
// Adresszeile ohne #… und ?… senden (dort können Orte oder Koordinaten stehen)
window.va('beforeSend', function (ev) {
  try { var u = new URL(ev.url); u.hash = ''; u.search = ''; return Object.assign({}, ev, { url: u.toString() }); } catch (e) { return ev; }
});
(function () {
  const track = (name, data) => { try { window.va('event', data ? { name, data } : { name }); } catch (e) {} };
  const file = (path) => decodeURIComponent(String(path).split('?')[0].split('#')[0].split('/').pop() || '');

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-track]');
    if (t) return track(t.getAttribute('data-track'));
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    let url; try { url = new URL(href, location.href); } catch (err) { return; }
    if (href.startsWith('tel:')) return track('Kontakt', { art: 'Telefon' });
    if (href.startsWith('mailto:')) return track('Kontakt', { art: 'E-Mail' });
    if (url.hostname === 'wa.me') return track('Kontakt', { art: 'WhatsApp' });
    if (url.hash === '#kontakt' && url.origin === location.origin) return track('Kontakt', { art: 'Zum Kontakt' });
    if (/\.pdf$/i.test(url.pathname)) return track('PDF geöffnet', { datei: file(url.pathname) });
    if (url.origin !== location.origin && /^https?:$/.test(url.protocol)) return track('Externer Link', { ziel: url.hostname.replace(/^www\./, '') });
  }, true);

  const played = new Set();
  document.addEventListener('play', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    const name = file(v.currentSrc || v.getAttribute('src') || '').replace(/\.(mp4|webm|mov)$/i, '');
    if (!name || played.has(name)) return;
    played.add(name); track('Video abgespielt', { video: name });
  }, true);

  // Verweildauer: nur Zeit zählen, in der die Seite sichtbar ist
  const steps = [[30, '30 Sek.'], [120, '2 Min.'], [300, '5 Min.']];
  let active = 0, next = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible' || next >= steps.length) return;
    active += 5;
    if (active >= steps[next][0]) {
      track('Verweildauer', { stufe: steps[next][1], seite: location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/' });
      next++;
    }
  }, 5000);
})();
