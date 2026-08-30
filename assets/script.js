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
   SOUND
   ---------------------------------------------------------------------------
   Ein Song für die ganze Seite, per Klick ein-/ausblendbar. Startet nie von
   selbst (Browser blockieren Autoplay mit Ton ohnehin, und niemand will das
   ungefragt auf dem Handy im Tram).
   ---------------------------------------------------------------------------- */
(() => {
  const toggle = document.getElementById("soundToggle");
  if (!toggle) return;

  const audio = new Audio("assets/audio/wanted.mp3");
  audio.loop = true;
  audio.volume = 0;
  audio.preload = "none";

  let enabled = false;
  const FADE_MS = 900;
  const TARGET_VOLUME = 0.35;

  function fade(to, ms) {
    const from = audio.volume;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / ms);
      audio.volume = Math.min(1, Math.max(0, from + (to - from) * t));
      if (t < 1) requestAnimationFrame(step);
      else if (to === 0) audio.pause();
    }
    if (to > 0 && audio.paused) {
      audio.play().catch(() => {
        /* Browser blockt Autoplay — stumm bleiben statt Fehler zu werfen */
      });
    }
    requestAnimationFrame(step);
  }

  toggle.addEventListener("click", () => {
    enabled = !enabled;
    toggle.setAttribute("aria-pressed", String(enabled));
    fade(enabled ? TARGET_VOLUME : 0, FADE_MS);
  });
})();

/* ---------------------------------------------------------------------------
   UI-SOUNDEFFEKTE
   ---------------------------------------------------------------------------
   Ein kurzer Swoosh beim Durchscrollen der Auto-Galerien, ein knackiges
   Klickgeräusch auf Buttons/Links — beides synthetisch per Web Audio API
   erzeugt (kein Sample aus dem Song, kein Lizenzthema). Läuft nur, wenn
   der Sound-Toggle aktiv ist.
   ---------------------------------------------------------------------------- */
(() => {
  const toggle = document.getElementById("soundToggle");
  if (!toggle) return;

  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function isEnabled() {
    return toggle.getAttribute("aria-pressed") === "true";
  }

  function noiseBuffer(ac, seconds, fadeOut) {
    const size = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buffer = ac.createBuffer(1, size, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      const env = fadeOut ? 1 - i / size : 1;
      data[i] = (Math.random() * 2 - 1) * env;
    }
    return buffer;
  }

  function playSwoosh() {
    if (!isEnabled()) return;
    const ac = getCtx();
    const dur = 0.35;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer(ac, dur, false);

    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(350, ac.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2600, ac.currentTime + dur * 0.55);
    filter.frequency.exponentialRampToValueAtTime(280, ac.currentTime + dur);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ac.currentTime + 0.04);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + dur);

    noise.connect(filter).connect(gain).connect(ac.destination);
    noise.start();
    noise.stop(ac.currentTime + dur);
  }

  function playClick() {
    if (!isEnabled()) return;
    const ac = getCtx();
    const dur = 0.06;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer(ac, dur, true);

    const filter = ac.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.28, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);

    noise.connect(filter).connect(gain).connect(ac.destination);
    noise.start();
    noise.stop(ac.currentTime + dur);
  }

  // Swoosh beim Durchscrollen einer Auto-Galerie — einmal pro Scroll-Geste,
  // nicht bei jedem Scroll-Event (sonst nervt es sofort)
  document.querySelectorAll(".car-gallery-track").forEach((track) => {
    let settleTimer = null;
    let isScrolling = false;
    track.addEventListener(
      "scroll",
      () => {
        if (!isScrolling) {
          isScrolling = true;
          playSwoosh();
        }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => { isScrolling = false; }, 250);
      },
      { passive: true }
    );
  });

  // Klickgeräusch auf Buttons, Pfeilen und Hauptnavigation
  document.querySelectorAll(".btn, .car-gallery-nav button, .nav-links a").forEach((el) => {
    el.addEventListener("click", playClick);
  });
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
