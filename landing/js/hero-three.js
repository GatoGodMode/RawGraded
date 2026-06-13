import * as THREE from 'three';

let activeDispose = null;

/**
 * @param {HTMLCanvasElement} canvas
 */
export function initHeroThree(canvas) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => {};
  }

  if (activeDispose) {
    activeDispose();
    activeDispose = null;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 4.2;

  const coreGeo = new THREE.IcosahedronGeometry(0.35, 2);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xff4d4d,
    transparent: true,
    opacity: 0.95,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  const glowGeo = new THREE.SphereGeometry(0.55, 24, 24);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xdc143c,
    transparent: true,
    opacity: 0.12,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(glow);

  const count = 420;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 1.2 + Math.random() * 2.8;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi) - 0.5;
  }
  const particlesGeo = new THREE.BufferGeometry();
  particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particlesMat = new THREE.PointsMaterial({
    color: 0xff6b6b,
    size: 0.02,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particlesGeo, particlesMat);
  scene.add(particles);

  const ringGeo = new THREE.TorusGeometry(1.1, 0.008, 8, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x8b0f1f,
    transparent: true,
    opacity: 0.35,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI * 0.45;
  scene.add(ring);

  let width = 0;
  let height = 0;
  let animId = 0;
  const clock = new THREE.Clock();

  const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (width < 1 || height < 1) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const animate = () => {
    animId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    core.rotation.y = t * 0.9;
    core.rotation.x = t * 0.35;
    glow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08);
    particles.rotation.y = t * 0.12;
    ring.rotation.z = t * 0.25;
    renderer.render(scene, camera);
  };
  animate();

  const dispose = () => {
    cancelAnimationFrame(animId);
    ro.disconnect();
    coreGeo.dispose();
    coreMat.dispose();
    glowGeo.dispose();
    glowMat.dispose();
    particlesGeo.dispose();
    particlesMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    renderer.dispose();
    if (activeDispose === dispose) activeDispose = null;
  };

  activeDispose = dispose;

  const onPageHide = () => dispose();
  window.addEventListener('pagehide', onPageHide);

  return () => {
    window.removeEventListener('pagehide', onPageHide);
    dispose();
  };
}

/**
 * Defer Three init until after intro.
 */
export function scheduleHeroThree(canvas) {
  const start = () => initHeroThree(canvas);

  const onIntro = () => {
    const run = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(start, { timeout: 800 });
      } else {
        setTimeout(start, 50);
      }
    };
    run();
  };

  if (document.querySelector('.re-intro.is-done')) {
    onIntro();
  } else {
    window.addEventListener('re:introend', onIntro, { once: true });
  }

  return () => {
    if (activeDispose) activeDispose();
  };
}
