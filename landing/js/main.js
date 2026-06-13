import '../css/raw-engine.css';
import { runIntroGlitch } from './intro-glitch.js';
import { initParallax } from './parallax.js';
import { scheduleHeroThree } from './hero-three.js';

const intro = document.getElementById('re-intro');
const main = document.getElementById('re-main');
const backdrop = document.getElementById('re-backdrop');
const canvas = document.getElementById('re-hero-canvas');

if (intro && main) {
  runIntroGlitch(intro, main);
}

let teardownParallax = () => {};
if (backdrop) {
  teardownParallax = initParallax(backdrop);
}

let teardownThree = () => {};
if (canvas) {
  teardownThree = scheduleHeroThree(canvas);
}

window.addEventListener('pagehide', () => {
  teardownParallax();
  teardownThree();
});
