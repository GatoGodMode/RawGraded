import '../css/raw-engine-marketing.css';

async function injectPartial(url, mountId) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return;
    const html = await res.text();
    if (!html.trim()) return;
    mount.innerHTML = html;
    mount.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', () => {
        document.querySelector('.re-mkt__nav')?.classList.remove('is-open');
        document.querySelector('.re-mkt__nav-toggle')?.setAttribute('aria-expanded', 'false');
      });
    });
  } catch {
    /* partial unavailable (e.g. offline preview) */
  }
}

void injectPartial('/landing/partials/suite-launcher.html', 're-mkt-suite-mount');
void injectPartial('/landing/partials/trust-sections.html', 're-mkt-trust-mount');

const navToggle = document.querySelector('.re-mkt__nav-toggle');
const nav = document.querySelector('.re-mkt__nav');

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

document.querySelectorAll('.re-mkt__nav a[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => {
    nav?.classList.remove('is-open');
    navToggle?.setAttribute('aria-expanded', 'false');
  });
});

const form = document.getElementById('re-mkt-subscribe');
const msg = document.getElementById('re-mkt-subscribe-msg');

if (form && msg) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    msg.textContent = 'Thanks — we will notify you when RawGraded Studio launches.';
    msg.classList.add('is-visible');
    form.reset();
  });
}
