/**
 * DeadSouls | App - логика главной страницы (оплата, визуал).
 */

const STORAGE_PAID = "bridge_paid_session";
const el = (id) => document.getElementById(id);

function unlockDownloadUi() {
  sessionStorage.setItem(STORAGE_PAID, "1");
  const hint = el("pay-hint");
  const dl = el("download-block");
  const payBtn = el("btn-pay");
  if (hint) hint.hidden = false;
  if (dl) dl.hidden = false;
  if (payBtn) payBtn.disabled = true;
}

function restorePaidUi() {
  if (sessionStorage.getItem(STORAGE_PAID) === "1") {
    unlockDownloadUi();
  }
}

function initComparisonSlider() {
  const container = document.getElementById("comp-container");
  const slider = document.getElementById("comp-slider");
  const overlayVideo = document.querySelector(".overlay-layer video");

  if (!container || !slider) return;

  const videos = container.querySelectorAll("video");
  videos.forEach(vid => {
    vid.muted = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");

    const playPromise = vid.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        console.warn("Safari заблокировал автоплей видео. Ожидаем касания пользователя.");
      });
    }
  });

  slider.addEventListener("touchstart", () => {
    videos.forEach(vid => {
      if (vid.paused) {
        vid.play().catch(() => {});
      }
    });
  }, { passive: true });

  const syncVideoWidth = () => {
    if (overlayVideo) {
      overlayVideo.style.width = container.offsetWidth + "px";
    }
  };

  slider.addEventListener("input", (e) => {
    const value = e.target.value + "%";
    container.style.setProperty("--pos", value);
  });

  window.addEventListener("resize", syncVideoWidth);
  syncVideoWidth();
}

/** Наклон карточки и блик по курсору на бегущих лентах */
function initFeatureCards() {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  if (reduceMotion) return;

  const section = document.querySelector(".features-section");
  if (!section) return;

  /** @param {MouseEvent} e */
  function onFeatMove(e) {
    const card = e.currentTarget;
    if (!(card instanceof HTMLElement)) return;
    const r = card.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    card.style.setProperty("--glow-x", `${Math.max(0, Math.min(100, x))}%`);
    card.style.setProperty("--glow-y", `${Math.max(0, Math.min(100, y))}%`);
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--tilt-x", `${py * -6}deg`);
    card.style.setProperty("--tilt-y", `${px * 8}deg`);
  }

  /** @param {MouseEvent} e */
  function onFeatLeave(e) {
    const card = e.currentTarget;
    if (!(card instanceof HTMLElement)) return;
    card.style.removeProperty("--tilt-x");
    card.style.removeProperty("--tilt-y");
    card.style.removeProperty("--glow-x");
    card.style.removeProperty("--glow-y");
  }

  section.querySelectorAll(".feat-card").forEach((card) => {
    card.addEventListener("mousemove", onFeatMove);
    card.addEventListener("mouseleave", onFeatLeave);
  });
}

function init() {
  restorePaidUi();
  initComparisonSlider();

  el("btn-pay")?.addEventListener("click", () => {
    unlockDownloadUi();
  });

  initFeatureCards();
}

init();