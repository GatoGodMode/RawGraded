/**
 * Renders identify-fake-slabs.html from slab-authenticity-rules.json
 */

function citeBadgeClass(label) {
  if (label === 'Company Guide') return 'cite-badge cite-badge--company';
  if (label === 'Social Evidence') return 'cite-badge cite-badge--social';
  return 'cite-badge cite-badge--reference';
}

function badgeClass(kind) {
  if (kind === 'company') return 'cite-badge cite-badge--company';
  if (kind === 'social') return 'cite-badge cite-badge--social';
  return 'cite-badge cite-badge--rawgraded';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function variantLabel(v) {
  if (v === 'authentic') return 'Authentic reference';
  if (v === 'suspect') return 'Suspect / contrast';
  return 'Diagram';
}

function renderRefFigure(img) {
  const ext = img.src.split('.').pop()?.toLowerCase() || '';
  const media =
    ext === 'gif'
      ? `<img class="ref-figure__img" src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" loading="lazy" decoding="async" data-lightbox-src="${escapeHtml(img.src)}" />`
      : `<img class="ref-figure__img" src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" loading="lazy" decoding="async" width="600" height="400" data-lightbox-src="${escapeHtml(img.src)}" />`;
  return `<figure class="ref-figure ref-figure--${escapeHtml(img.variant)}">
    <span class="ref-figure__variant">${escapeHtml(variantLabel(img.variant))}</span>
    <button type="button" class="ref-figure__zoom" data-lightbox-src="${escapeHtml(img.src)}" aria-label="Enlarge image">${media}</button>
    <figcaption>
      <p class="ref-figure__caption">${escapeHtml(img.caption)}</p>
      <p class="ref-figure__attr">
        <span class="${citeBadgeClass(img.citeLabel)}">${escapeHtml(img.citeLabel)}</span>
        <a href="${escapeHtml(img.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(img.sourceTitle)}</a>
      </p>
    </figcaption>
  </figure>`;
}

function renderRefCompare(images) {
  if (!images?.length) return '';
  return `<div class="ref-compare" role="group" aria-label="Visual comparison">
    ${images.map(renderRefFigure).join('')}
  </div>`;
}

function renderCertLinks(links) {
  if (!links?.length) return '';
  return `<ul class="cert-list">${links
    .map(
      (l) => `<li>
        <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.title)}</a>
        <span class="cite-badge cite-badge--company">Company Guide</span>
        <span class="note">${escapeHtml(l.note)}</span>
      </li>`
    )
    .join('')}</ul>`;
}

function renderCiteList(refs) {
  if (!refs?.length) return '';
  return `<ul class="cite-list">${refs
    .map(
      (r) => `<li>
        <div class="cite-list__meta">
          <span class="${badgeClass(r.kind)}">${escapeHtml(r.citeLabel)}</span>
          <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a>
        </div>
        <p class="note">${escapeHtml(r.note)}</p>
      </li>`
    )
    .join('')}</ul>`;
}

function renderCheckCard(check, refs) {
  const external = refs?.[check.id] || [];
  const visuals = check.referenceImages?.length
    ? `<h4 class="check-card__visual-heading">Visual comparison</h4>${renderRefCompare(check.referenceImages)}`
    : '';
  return `<article class="check-card" id="check-${escapeHtml(check.id)}">
    <div class="check-card__head">
      <h3 class="check-card__title">${escapeHtml(check.title)}</h3>
      <span class="cite-badge cite-badge--rawgraded">RawGraded Detection Rule</span>
      <code class="check-card__id">${escapeHtml(check.id)}</code>
    </div>
    <p class="check-card__rule">${escapeHtml(check.description)}</p>
    ${visuals}
    ${external.length ? `<h4 class="check-card__refs-heading">References</h4>${renderCiteList(external)}` : ''}
  </article>`;
}

function renderHouseHero(hero) {
  if (!hero) return '';
  return `<div class="house-hero">
    ${renderRefFigure({
      id: `hero-${hero.house}`,
      variant: 'authentic',
      src: hero.src,
      alt: hero.alt,
      caption: hero.caption,
      sourceTitle: hero.sourceTitle,
      sourceUrl: hero.sourceUrl,
      citeLabel: hero.citeLabel,
    })}
  </div>`;
}

function renderHouseSection(houseKey, houseData, sectionId, heading, hero) {
  const { checks, certLinks, checkRefs } = houseData;
  return `<section id="${sectionId}">
    <h2>${escapeHtml(heading)}</h2>
    <p class="lead">These checks match what RawGraded’s Slab Checker runs for <strong>${escapeHtml(houseKey)}</strong> slabs (AI-assisted in the app).</p>
    ${renderHouseHero(hero)}
    <h3>Official cert verification</h3>
    ${renderCertLinks(certLinks)}
    <h3>Visual checks</h3>
    ${checks.map((c) => renderCheckCard(c, checkRefs)).join('')}
  </section>`;
}

function renderScoring(thresholds) {
  return `<section id="how-we-score">
    <h2>How RawGraded scores slabs</h2>
    <p>In the dashboard <strong>Slab Checker</strong>, each detection rule is scored 0–100. A check <strong>passes at ${thresholds.passMin}+</strong>. If evidence is unclear, the model scores about <strong>50</strong> and notes the limitation.</p>
    <div class="score-grid">
      <div class="score-card"><strong>Likely authentic</strong>Overall ≥ ${thresholds.likelyAuthentic}</div>
      <div class="score-card"><strong>Inconclusive</strong>${thresholds.inconclusiveMin}–${thresholds.inconclusiveMax}</div>
      <div class="score-card"><strong>Likely fake</strong>Below ${thresholds.likelyFakeBelow}</div>
    </div>
    <p class="callout callout--tip">This page is a <strong>manual checklist</strong> using the same rules. For photo/video analysis and saved reports, use the in-app Slab Checker.</p>
  </section>`;
}

function renderCertVerifyAll(data) {
  const houses = ['PSA', 'BGS', 'CGC'];
  const visual =
    data.certVerifyImages?.length
      ? `<h3>Visual comparison — cert vs slab in hand</h3>${renderRefCompare(data.certVerifyImages)}`
      : '';
  let html = `<section id="cert-verify">
    <h2>Step 1: Cert lookup (all graders)</h2>
    <p>${escapeHtml(data.disclaimer)}</p>
    ${visual}`;
  for (const h of houses) {
    html += `<h3>${h}</h3>${renderCertLinks(data.houses[h].certLinks)}`;
  }
  html += `<h3>SGC (cert only)</h3>${renderCertLinks([data.sgcCertOnly])}
    <p class="callout callout--warn">RawGraded does not yet run SGC-specific visual detection rules—verify the cert code and QR first.</p>
  </section>`;
  return html;
}

function renderResources(resources) {
  if (!resources?.length) return '';
  return `<section id="resources">
    <h2>More resources</h2>
    <ul class="cite-list">${resources
      .map(
        (r) => `<li>
          <div class="cite-list__meta">
            <span class="${badgeClass(r.kind)}">${escapeHtml(r.citeLabel)}</span>
            <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a>
          </div>
          <p class="note">${escapeHtml(r.note)}</p>
        </li>`
      )
      .join('')}</ul>
  </section>`;
}

function initLightbox() {
  let overlay = document.getElementById('guide-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'guide-lightbox';
    overlay.className = 'guide-lightbox';
    overlay.hidden = true;
    overlay.innerHTML =
      '<button type="button" class="guide-lightbox__close" aria-label="Close">×</button><img class="guide-lightbox__img" alt="" />';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.guide-lightbox__close')) {
        overlay.hidden = true;
        document.body.classList.remove('guide-lightbox-open');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) {
        overlay.hidden = true;
        document.body.classList.remove('guide-lightbox-open');
      }
    });
  }
  const imgEl = overlay.querySelector('.guide-lightbox__img');
  document.querySelectorAll('[data-lightbox-src]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const src = el.getAttribute('data-lightbox-src');
      const alt = el.querySelector('img')?.getAttribute('alt') || 'Reference image';
      if (!src) return;
      e.preventDefault();
      imgEl.src = src;
      imgEl.alt = alt;
      overlay.hidden = false;
      document.body.classList.add('guide-lightbox-open');
    });
  });
}

function heroForHouse(heroes, house) {
  return (heroes || []).find((h) => h.house === house);
}

async function main() {
  const mount = document.getElementById('guide-mount');
  if (!mount) return;

  try {
    const res = await fetch('/guides/slab-authenticity-rules.json', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const heroes = data.houseHeroes || [];

    mount.innerHTML = [
      renderScoring(data.thresholds),
      renderCertVerifyAll(data),
      renderHouseSection('PSA', data.houses.PSA, 'psa', 'PSA — 9 detection rules', heroForHouse(heroes, 'PSA')),
      renderHouseSection('BGS', data.houses.BGS, 'bgs', 'BGS / Beckett — 7 detection rules', heroForHouse(heroes, 'BGS')),
      renderHouseSection('CGC', data.houses.CGC, 'cgc-other', 'CGC &amp; other generic slabs — 5 detection rules', heroForHouse(heroes, 'CGC')),
      renderResources(data.resources),
    ].join('');

    mount.dataset.state = 'ready';
    initLightbox();
  } catch (err) {
    mount.dataset.state = 'error';
    const detail = err?.message ? escapeHtml(err.message) : 'Unknown error';
    mount.innerHTML = `<div class="callout callout--warn">
      <strong>Could not load checklist data.</strong> The page needs <code>/guides/slab-authenticity-rules.json</code> on the server (often missing from <code>dist/guides/</code> after deploy).
      <br /><br />On your machine run <code>npm run build</code>, then upload the entire <code>dist/guides/</code> folder (HTML, JS, CSS, JSON, and <code>ref/</code> images).
      <br /><br /><span style="font-size:13px;color:var(--text-2);">Error: ${detail}</span>
    </div>`;
    console.error('[guides]', err);
  }
}

main();
