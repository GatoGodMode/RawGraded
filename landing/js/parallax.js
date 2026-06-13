/**
 * @param {HTMLElement} root
 */
export function initParallax(root) {
  const layers = root.querySelectorAll('[data-parallax-depth]');
  if (!layers.length) return () => {};

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return () => {};

  let px = 0;
  let py = 0;
  let sy = 0;
  let raf = 0;

  const onMove = (e) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    px = (e.clientX / w - 0.5) * 2;
    py = (e.clientY / h - 0.5) * 2;
    schedule();
  };

  const onScroll = () => {
    sy = window.scrollY;
    schedule();
  };

  const apply = () => {
    raf = 0;
    layers.forEach((el) => {
      const depth = parseFloat(el.getAttribute('data-parallax-depth') || '0.2');
      const mx = px * depth * 28;
      const my = py * depth * 22 + sy * depth * 0.08;
      el.style.transform = `translate3d(${mx}px, ${my}px, 0) scale(${1 + depth * 0.02})`;
    });
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(apply);
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  schedule();

  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
}
