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
