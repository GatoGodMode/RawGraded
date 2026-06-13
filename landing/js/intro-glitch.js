const INTRO_MS = 1200;
const PHASES = [
  { name: 'boot', at: 0 },
  { name: 'rgb', at: 80 },
  { name: 'clip', at: 380 },
  { name: 'settle', at: 720 },
  { name: 'done', at: INTRO_MS },
];

/**
 * @param {HTMLElement} introEl
 * @param {HTMLElement} mainEl
 * @returns {Promise<void>}
 */
export function runIntroGlitch(introEl, mainEl) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced) {
    introEl.classList.add('is-done');
    introEl.setAttribute('data-phase', 'done');
    document.body.classList.remove('intro-active');
    mainEl.classList.add('is-visible');
    dispatchIntroEnd();
    return Promise.resolve();
  }

  document.body.classList.add('intro-active');
  introEl.setAttribute('data-phase', 'boot');

  return new Promise((resolve) => {
    const start = performance.now();
    let lastPhase = 'boot';

    const tick = (now) => {
      const elapsed = now - start;

      for (let i = PHASES.length - 1; i >= 0; i--) {
        if (elapsed >= PHASES[i].at) {
          const phase = PHASES[i].name;
          if (phase !== lastPhase) {
            lastPhase = phase;
            introEl.setAttribute('data-phase', phase);
          }
          break;
        }
      }

      if (elapsed < INTRO_MS) {
        requestAnimationFrame(tick);
        return;
      }

      introEl.classList.add('is-done');
      introEl.setAttribute('data-phase', 'done');
      document.body.classList.remove('intro-active');
      mainEl.classList.add('is-visible');
      dispatchIntroEnd();
      resolve();
    };

    requestAnimationFrame(tick);
  });
}

export function dispatchIntroEnd() {
  window.dispatchEvent(new CustomEvent('re:introend'));
}
