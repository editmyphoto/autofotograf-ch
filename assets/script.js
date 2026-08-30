/* ==========================================================================
   autofotograf.ch — Interaktion
   Vier unabhängige Teile: Nav-Zustand, Scroll-Reveal, Sound-Architektur,
   Kontaktformular. Jeder Teil funktioniert auch, wenn ein anderer fehlschlägt.
   ========================================================================== */

document.getElementById("year").textContent = new Date().getFullYear();

/* ---------------------------- NAV: solid on scroll ---------------------------- */
(() => {
  const nav = document.getElementById("siteNav");
  if (!nav) return;
  const onScroll = () => nav.classList.toggle("is-solid", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();

/* ---------------------------- SCROLL REVEAL ---------------------------- */
(() => {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );
  items.forEach((el) => io.observe(el));
})();

/* ---------------------------------------------------------------------------
   SOUND-ARCHITEKTUR
   ---------------------------------------------------------------------------
   Idee: keine einzelne Hintergrundmusik, sondern kurze Ambient-Loops pro
   "Kapitel". Der Hero hat sein eigenes Klangbild; in der Galerie schaltet
   der Klang je nach Auto-Typ um (data-mood="oldtimer" | "modern") — genau
   das "abschnittweise andere Musik" aus dem Briefing.

   Es sind absichtlich noch KEINE Audiodateien verlinkt: Musik/Sounds
   brauchen eine lizenzierte Quelle (z. B. Artlist, Epidemic Sound,
   eigene Aufnahmen), keine YouTube-Rips. Sobald Dateien unter
   assets/audio/ liegen, unten in TRACKS die Pfade eintragen — der Rest
   läuft automatisch: Crossfade zwischen Kapiteln, ein Master-Toggle,
   nie Autoplay mit Ton (das blockt der Browser ohnehin, und niemand
   will das auf dem Handy im Tram).
   ---------------------------------------------------------------------------- */
(() => {
  const TRACKS = {
    hero: null, // z. B. "assets/audio/hero-wind-standgas.mp3"
    oldtimer: null, // z. B. "assets/audio/oldtimer-swing.mp3"
    modern: null, // z. B. "assets/audio/modern-synth.mp3"
  };

  const toggle = document.getElementById("soundToggle");
  const caption = document.getElementById("soundCaption");
  if (!toggle) return;

  const players = {};
  Object.entries(TRACKS).forEach(([key, src]) => {
    if (!src) return;
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0;
    audio.preload = "none";
    players[key] = audio;
  });

  let enabled = false;
  let current = null;
  const FADE_MS = 900;
  const TARGET_VOLUME = 0.35;

  function fade(audio, to, ms) {
    if (!audio) return;
    const from = audio.volume;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / ms);
      audio.volume = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(step);
      else if (to === 0) audio.pause();
    }
    if (to > 0 && audio.paused) {
      audio.play().catch(() => {
        /* Browser blockt Autoplay oder Datei fehlt — stumm bleiben statt Fehler zu werfen */
      });
    }
    requestAnimationFrame(step);
  }

  function switchTo(key, label) {
    if (!enabled) return;
    const next = players[key] || null;
    if (next === current) return;
    if (current) fade(current, 0, FADE_MS);
    if (next) fade(next, TARGET_VOLUME, FADE_MS);
    current = next;
    if (caption) {
      caption.textContent = label || "";
      caption.classList.toggle("is-visible", Boolean(label && next));
    }
  }

  toggle.addEventListener("click", () => {
    enabled = !enabled;
    toggle.setAttribute("aria-pressed", String(enabled));
    if (!enabled && current) {
      fade(current, 0, FADE_MS);
      current = null;
      if (caption) caption.classList.remove("is-visible");
    } else if (enabled) {
      // beim Einschalten sofort das aktuell sichtbare Kapitel starten
      const visible = document.querySelector("[data-audio-chapter]:not([data-audio-chapter='none'])");
      if (visible) switchTo(visible.dataset.audioChapter, chapterLabel(visible.dataset.audioChapter));
    }
  });

  function chapterLabel(key) {
    if (key === "hero") return "Wind & Standgas — Julierpass";
    if (key === "oldtimer") return "Swing-Ambience — Youngtimer";
    if (key === "modern") return "Synth-Puls — moderne Szene";
    return "";
  }

  // Hero-Kapitel
  const heroEl = document.querySelector('[data-audio-chapter="hero"]');
  if (heroEl) {
    const heroIO = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && switchTo("hero", chapterLabel("hero"))),
      { threshold: 0.5 }
    );
    heroIO.observe(heroEl);
  }

  // Auto-Galerien: je nach data-mood umschalten, sobald eine Galerie
  // (Porsche, Morgan, Nissan, Alfa Romeo) mehrheitlich im Bild ist
  const moodEls = document.querySelectorAll(".car-gallery[data-mood]");
  if (moodEls.length) {
    const moodIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio > 0.45) {
            const mood = e.target.dataset.mood;
            switchTo(mood, chapterLabel(mood));
          }
        });
      },
      { threshold: [0.45] }
    );
    moodEls.forEach((el) => moodIO.observe(el));
  }
})();

/* ---------------------------- AUTO-GALERIEN: Pfeil-Scroll ---------------------------- */
(() => {
  document.querySelectorAll(".car-gallery").forEach((gallery) => {
    const track = gallery.querySelector(".car-gallery-track");
    if (!track) return;
    gallery.querySelectorAll("[data-scroll]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.dataset.scroll === "prev" ? -1 : 1;
        track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: "smooth" });
      });
    });
  });
})();

/* ---------------------------- KONTAKTFORMULAR ---------------------------- */
(() => {
  const form = document.getElementById("contactForm");
  const status = document.getElementById("formStatus");
  if (!form || !status) return;

  const ENDPOINT = "https://formspree.io/f/xqpkaoep";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (form.firma.value) return; // Honeypot ausgelöst — still abbrechen, keine Fehlermeldung an Bots

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (!ENDPOINT) {
      status.dataset.state = "error";
      status.textContent =
        "Formular ist noch nicht angebunden. Bitte ENDPOINT in assets/script.js setzen (siehe README.md).";
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    status.dataset.state = "";
    status.textContent = "Wird gesendet …";

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
      if (response.ok) {
        status.dataset.state = "ok";
        status.textContent = "Danke! Ich melde mich innerhalb von 24 Stunden.";
        form.reset();
      } else {
        throw new Error("Versand fehlgeschlagen");
      }
    } catch (err) {
      status.dataset.state = "error";
      status.textContent = "Senden hat nicht geklappt — bitte direkt per E-Mail oder Telefon melden.";
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
