# autofotograf.ch — Startcode (Konzept „Pass & PS")

Statische Seite, kein Framework, kein Build-Schritt. Einfach `index.html`
öffnen oder den Ordner auf ein beliebiges Static-Hosting (z. B. Netlify,
Vercel, GitHub Pages, oder direkt beim Domain-Provider) hochladen.

## Struktur

```
autofotograf-ch/
├── index.html         Alle Inhalte, Struktur, SEO-Meta & JSON-LD
├── impressum.html
├── datenschutz.html
├── 404.html
├── assets/
│   ├── styles.css      Design-Tokens oben im File, dann Sektionen
│   ├── script.js        Nav, Scroll-Reveal, Sound, Kontaktformular
│   ├── favicon.svg + favicon-32/16.png + apple-touch-icon.png
│   ├── social-share.jpg Für Open-Graph/Twitter-Vorschau beim Teilen
│   └── img/              44 Galerie-Bilder + Hero
├── robots.txt
├── sitemap.xml
└── README.md
```

## Bereits erledigt

- Bild-Dateinamen sind SEO-optimiert und decken beide Suchbegriffe ab:
  22 Bilder heissen `autofotograf-graubuenden-<auto>-<szene>.jpg` (Bilder mit
  sichtbarer Bündner Berg-/Chur-Kulisse), 22 heissen
  `autofotograf-schweiz-<auto>-<szene>.jpg` (generische Detail-/Interieur-/
  Hallenaufnahmen ohne erkennbare Region) — z. B.
  `autofotograf-graubuenden-porsche-bergpanorama.jpg` vs.
  `autofotograf-schweiz-porsche-motorhaube-detail.jpg`. Variiert pro Bild
  statt überall denselben Namen zu wiederholen (das würde Google eher als
  Keyword-Stuffing werten). Neue Bilder sollten dem gleichen Muster folgen —
  „Graubünden" nur, wenn die Landschaft/Chur im Bild erkennbar ist, sonst
  „Schweiz".
- Echtes Favicon (SVG + PNG-Fallbacks für Safari/iOS)
- Eigenes Social-Share-Bild (1200×630, mit Logo & Headline, nicht mehr nur ein Hero-Crop)
- 404-Seite im Look der restlichen Seite
- Impressum & Datenschutzerklärung (siehe Punkt weiter unten für offene Details)
- Accessibility-Check: eine `<h1>`, saubere Überschriften-Hierarchie, keine doppelten IDs, alle Bilder mit Alt-Text, alle internen Links geprüft

## Was jetzt noch fehlt, bevor die Seite live geht

### 1. Echte Fotos — von dir kuratiert
Hero und Geschenk-Banner nutzen echte Fotos aus `assets/img/`. Die Galerie
ist in vier einzeln horizontal scrollbare Reihen unterteilt (`.car-gallery`),
eine pro Auto, in dieser Reihenfolge: **Porsche → Morgan Cabrio → Nissan
Skyline → Alfa Romeo Giulia** — insgesamt 44 Bilder (8–12 pro Auto).

Die Auswahl kam direkt von dir über den Ordner
`Bilder für die Website/Ausgewählt/<Auto>/` — jedes Bild aus diesen Ordnern
wurde übernommen, in Dateinamen-Reihenfolge. Willst du die Auswahl ändern,
einfach Bilder in den passenden Unterordner legen oder daraus entfernen und
Bescheid geben, dann baue ich die jeweilige Reihe neu auf. Weitere Bilder
folgen dem gleichen Muster:

```html
<img src="assets/img/dateiname.jpg"
     alt="Autofotografie [Marke Modell] auf [Pass/Ort], Graubünden[, Lichtstimmung]"
     loading="lazy" width="1200" height="1500">
```

- `loading="lazy"` für alles ausser dem ersten (obersten) Galerie-Bild und dem Hero.
- Neue Bilder mit `sips -Z 2000 -s format jpeg -s formatOptions 78 quelle.jpg --out assets/img/ziel.jpg`
  (macOS-Bordmittel) auf Webgrösse bringen, bevor sie eingesetzt werden — die
  Originale aus der Kamera sind 7–45 MB pro Bild.

**Wichtig:** Das komplette Rohmaterial (inkl. RAW/.ARW-Dateien, ca. 7.5 GB)
liegt bewusst **ausserhalb** dieses Ordners unter
`/Users/rinaldokraettli/Claude/Bilder für die Website/` — nicht mit hochladen,
sonst landen Rohdateien auf dem Webserver. Nur `assets/img/` gehört zur Seite.

### 2. Kontaktformular — aktiv ✓
Läuft über Formspree, Endpoint `https://formspree.io/f/xqpkaoep` ist in
`assets/script.js` eingetragen. Mit einer Testnachricht verifiziert (Erfolgs-
meldung kam korrekt zurück). Die Datenschutzerklärung nennt Formspree bereits
namentlich inkl. Hinweis auf Datenübermittlung in die USA.

Falls du das Formspree-Konto wechselst oder ein zweites Formular brauchst:
in `assets/script.js` die `ENDPOINT`-Konstante anpassen.

### 3. Sound — aktiv ✓
Ein Song für die ganze Seite: `assets/audio/wanted.mp3` ("Bobby Quick —
Wanted", Instrumental, lizenziert über Artlist.io). Ein Klick auf das
Lautsprecher-Icon in der Nav blendet ihn sanft ein/aus (Fade, kein
abruptes Ein/Aus), läuft dann in Schlaufe. Startet nie von selbst — Browser
blockieren Autoplay mit Ton ohnehin, und ein leiser Startzustand mit
sichtbarem Regler ist auch einfach die höflichere Lösung.

Song wechseln: Datei in `assets/audio/` austauschen und den Dateinamen in
`assets/script.js` (Abschnitt „SOUND", `new Audio(...)`) anpassen. Bitte
nur lizenzierte Quellen verwenden (Artlist, Epidemic Sound, Musicbed o. Ä.),
keine YouTube-Rips.

### 4. Impressum & Datenschutz — Entwürfe stehen, noch prüfen lassen
`impressum.html` und `datenschutz.html` sind fertig verlinkt (Footer +
Hinweis beim Kontaktformular). Beide basieren auf dem tatsächlichen
technischen Stand der Seite (nur Kontaktformular, keine Cookies/Analytics,
Google Fonts). Bevor die Seite live geht:
- Sobald ein Formular-Dienstleister (z. B. Formspree) aktiv ist, in
  `datenschutz.html` unter „Kontaktformular" den Anbieter namentlich nennen
  (inkl. Hinweis auf Datenübermittlung ins Ausland, falls zutreffend — bei
  Formspree z. B. USA).
- Beide Texte sind ein solider Startpunkt, aber kein Rechtsgutachten — kurz
  von einer fachkundigen Person gegenprüfen lassen, besonders wenn sich
  Angebot, Hosting oder Rechtsform ändern.

### 5. Domain & Deployment — live ✓
- Code liegt auf GitHub: `github.com/editmyphoto/autofotograf-ch`
- Deployed auf Vercel (Projekt `autofotograf-ch`, Team `editmyphoto`),
  Auto-Deploy bei jedem Push auf `main`
- **Live unter https://autofotograf.ch** (redirected automatisch auf
  `https://www.autofotograf.ch`, SSL aktiv)
- Fallback-URL: https://autofotograf-ch.vercel.app
- DNS liegt bei Hostpoint, DNS-Zone von `autofotograf.ch`:
  - `A @ → 76.76.21.21` (Vercel)
  - `CNAME www → cname.vercel-dns.com` (Vercel)
  - Alle bestehenden Mail-Records (MX, SPF, DKIM, DMARC) unverändert
    gelassen — E-Mail läuft weiter über Hostpoint
- Vercel zeigt evtl. noch „DNS Change Recommended" (gelb, optional) —
  das ist nur ein Performance-Vorschlag, kein Fehler; Seite funktioniert
  bereits vollständig
- Nach dem Go-Live: Seite bei der Google Search Console anmelden und
  `sitemap.xml` einreichen (`index.html`, `robots.txt`, `sitemap.xml`
  verweisen bereits korrekt auf `https://www.autofotograf.ch/`)

## Preise / Pakete

Bewusst entfernt (auf Wunsch) — keine Paket-Karten, keine Preise auf der
Seite. Falls später doch etwas zum Thema Preis stehen soll, eignet sich am
ehesten ein kurzer FAQ-Abschnitt statt fixer Pakete, z. B. „Was kostet ein
Shooting?" mit einer Bandbreite statt exakten Zahlen.

## SEO-Basis, die schon drin ist

- Semantische Überschriften-Hierarchie (ein `<h1>`, klar strukturierte `<h2>`)
- `<title>` und Meta-Description auf „Autofotograf Schweiz" (national) mit
  „Graubünden" als regionaler Spezialisierung ausgerichtet — Titel bewusst
  ohne „| autofotograf.ch"-Anhängsel gehalten, damit er in der Google-Suche
  nicht abgeschnitten wird
- Open-Graph- und Twitter-Card-Tags fürs Teilen in Social Media
- `ProfessionalService`-JSON-LD mit Adresse, Bewertungen (`AggregateRating`
  + einzelne `Review`-Einträge aus den drei echten Kundenstimmen) — hilft
  bei Rich Snippets in der Google-Suche
- `robots.txt` + `sitemap.xml`
- Keine externen JS-Frameworks → schnelle Ladezeit, gut für Core Web Vitals

Für später: ein einfaches Blog/Journal (z. B. „Die 5 schönsten Pässe für
ein Auto-Shooting in Graubünden") baut zusätzliche thematische Autorität
auf und bringt organischen Traffic jenseits der reinen Kontaktanfragen.

## Design-Tokens ändern

Alle Farben und Schriften sind zentral in `assets/styles.css` unter `:root`
definiert. Wer die Richtung später Richtung „Zeitlos" (warm, Vintage) oder
„Studio Weiss" (minimal, hell) verschieben will, ändert im Kern nur diese
Variablen plus die beiden Google-Fonts-Links in `index.html` — die
HTML-Struktur und alle Texte bleiben unverändert.
