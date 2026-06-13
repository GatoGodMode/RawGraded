/**
 * Single source of truth for graded-slab fake detection (SlabCheckerPlugin / geminiService).
 * Exported to public/guides/slab-authenticity-rules.json for the identification guide page.
 */

export type SlabGradingHouse = 'PSA' | 'BGS' | 'CGC' | 'Other';

export type SlabRefImageVariant = 'authentic' | 'suspect' | 'diagram';

export interface SlabAuthReferenceImage {
  id: string;
  variant: SlabRefImageVariant;
  src: string;
  alt: string;
  caption: string;
  sourceTitle: string;
  sourceUrl: string;
  citeLabel: 'Company Guide' | 'Social Evidence' | 'Reference Photo';
  width?: number;
  height?: number;
}

export interface SlabAuthCheckDef {
  id: string;
  title: string;
  description: string;
  referenceImages?: SlabAuthReferenceImage[];
}

export interface SlabAuthHeroImage {
  house: string;
  src: string;
  alt: string;
  caption: string;
  sourceTitle: string;
  sourceUrl: string;
  citeLabel: SlabAuthReferenceImage['citeLabel'];
}

export const SLAB_AUTH_THRESHOLDS = {
  passMin: 60,
  likelyAuthentic: 75,
  likelyFakeBelow: 50,
  inconclusiveMin: 50,
  inconclusiveMax: 74,
} as const;

export type CiteKind = 'company' | 'social';

export interface SlabAuthExternalRef {
  kind: CiteKind;
  citeLabel: 'Company Guide' | 'Social Evidence';
  title: string;
  url: string;
  note: string;
}

export interface SlabAuthCertLink {
  house: string;
  title: string;
  url: string;
  note: string;
}

const PSA_CHECKS: SlabAuthCheckDef[] = [
  {
    id: 'LABEL_TYPOGRAPHY',
    title: 'Label typography',
    description:
      'Font weight, kerning, and capitalization on the front label. PSA uses a specific proprietary font. Suspect if characters look thin, oddly spaced, or pixelated.',
  },
  {
    id: 'SILVER_LOGO_PLACEMENT',
    title: 'Silver logo placement',
    description:
      'Front label has a silver PSA logo at bottom center connecting to the red border. Back label has silver PSA logo at top center. Check positions are correct.',
  },
  {
    id: 'SILVER_LOGO_ILLUMINATION',
    title: 'Silver logo illumination',
    description:
      'Real silver PSA logos have an "on/off" reflective illumination effect — one side is lighter, the other darker depending on angle. In video, note if this shifting is present or absent.',
  },
  {
    id: 'RAISED_PLASTIC_LOGO',
    title: 'Raised plastic logo',
    description:
      'Real PSA slabs have a tactile raised "PSA" embossed in the bottom right corner of the plastic on both front and back. Check for its presence and correct position.',
  },
  {
    id: 'FUGITIVE_INK',
    title: 'Fugitive ink watermark',
    description:
      'PSA labels contain a subtle blue "fugitive ink" watermark of the PSA logo on the white portions of both front and back labels. Look for a faint bluish tint or PSA outline in white label areas.',
  },
  {
    id: 'PLASTIC_CLARITY',
    title: 'Plastic clarity & weld',
    description:
      'Real PSA plastic is optically clear and smooth, with no clouding, frosting, or cracking especially along the sonic weld seam. Frosting or cracks near the edges strongly indicate tampering or a fake.',
  },
  {
    id: 'SERIAL_FORMAT',
    title: 'Serial / cert format',
    description: 'PSA cert numbers are 7–8 digits. Note the serial visible on the label and verify it against PSA’s database.',
  },
  {
    id: 'CARD_SLAB_FIT',
    title: 'Card-to-slab fit',
    description:
      'The card inside should fit snugly with uniform, minimal gap all around — not floating loosely.',
  },
  {
    id: 'LABEL_COLOR_QUALITY',
    title: 'Label color quality',
    description:
      'The red border on PSA labels should be a deep red, not pink or brown. Label background should be bright white, not off-yellow.',
  },
];

const BGS_CHECKS: SlabAuthCheckDef[] = [
  {
    id: 'TRADEMARK_SYMBOL',
    title: 'Beckett ® trademark',
    description:
      '"BECKETT" on the case must have a registered trademark symbol ® (not ©, not missing). The ® should be small, raised, and match the font weight.',
  },
  {
    id: 'LABEL_COLOR_SIZE',
    title: 'Label color & size',
    description:
      'BGS labels are gold-colored with specific proportions. The label should not be washed out, too small, or the wrong shade of gold.',
  },
  {
    id: 'SUBGRADE_LAYOUT',
    title: 'Subgrade layout',
    description:
      'BGS labels show 4 subgrades (Centering, Corners, Edges, Surface) in specific positions with their values — check that layout matches official BGS format with correct labels.',
  },
  {
    id: 'INNER_SLEEVE',
    title: 'Inner sleeve',
    description:
      'BGS cards are housed inside a thin inner sleeve within the plastic case. Visible gap or direct card-to-plastic contact is suspicious.',
  },
  {
    id: 'CERT_FORMAT',
    title: 'Cert number format',
    description: 'BGS cert numbers are 10 digits, zero-padded (e.g. 0015876182). Verify format if visible.',
  },
  {
    id: 'PLASTIC_CLARITY',
    title: 'Plastic clarity',
    description: 'BGS cases are clear with no frosting or cracks.',
  },
  {
    id: 'CARD_SLAB_FIT',
    title: 'Card-to-slab fit',
    description: 'Card should fit snugly, not floating.',
  },
];

const GENERIC_CHECKS: SlabAuthCheckDef[] = [
  {
    id: 'LABEL_TYPOGRAPHY',
    title: 'Label typography',
    description: 'Font quality, spacing, and professional print quality.',
  },
  {
    id: 'PLASTIC_CLARITY',
    title: 'Plastic clarity',
    description: 'Clear plastic with no frosting, warping, or cracks.',
  },
  {
    id: 'CARD_SLAB_FIT',
    title: 'Card-to-slab fit',
    description: 'Card fits snugly, not floating loosely.',
  },
  {
    id: 'SERIAL_FORMAT',
    title: 'Serial / cert format',
    description: 'Cert number is clearly printed and legible.',
  },
  {
    id: 'SEAL_INTEGRITY',
    title: 'Seal integrity',
    description: 'Case weld/seal appears intact with no signs of opening.',
  },
];

export const SLAB_AUTH_CHECKS: Record<SlabGradingHouse, SlabAuthCheckDef[]> = {
  PSA: PSA_CHECKS,
  BGS: BGS_CHECKS,
  CGC: GENERIC_CHECKS,
  Other: GENERIC_CHECKS,
};

/** Per-check external citations (company + social). */
export const SLAB_AUTH_CHECK_REFS: Partial<
  Record<SlabGradingHouse, Partial<Record<string, SlabAuthExternalRef[]>>>
> = {
  PSA: {
    LABEL_TYPOGRAPHY: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'PSA Security: A Buyer’s Guide',
        url: 'https://www.psacard.com/services/psasecurityabuyersguide',
        note: 'Label typography, alignment, and counterfeit risk when buying online.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'PokéSats — fake PSA slab typography',
        url: 'https://pokesats.com/newsroom/how-to-spot-a-fake-psa-slab/',
        note: 'Community guide on font weight, kerning, and brick-red GEM MT bar.',
      },
    ],
    SILVER_LOGO_PLACEMENT: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'WikiHow — PSA slab visual verification',
        url: 'https://www.wikihow.com/Fake-Psa-Slabs',
        note: 'Silver PSA logo placement on front and back labels.',
      },
    ],
    SILVER_LOGO_ILLUMINATION: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'WikiHow — illumination effect on silver logos',
        url: 'https://www.wikihow.com/Fake-Psa-Slabs',
        note: 'Real logos shift light/dark by angle; fakes often look flat or uniformly holographic.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'r/PokeInvesting — spotting fake slabs',
        url: 'https://www.reddit.com/r/PokeInvesting/comments/1ap6y8z/how_to_spot_fake_psa_slabs/',
        note: 'Collector discussion on reflective logo and case tells.',
      },
    ],
    RAISED_PLASTIC_LOGO: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'WikiHow — raised PSA on case plastic',
        url: 'https://www.wikihow.com/Fake-Psa-Slabs',
        note: 'Embossed PSA in bottom-right of front and back plastic.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Gentlemen’s Vault — embossed logo check',
        url: 'https://gentlemenvault.com/seller-caught-selling-fake-pokemon-slabs-on-ebay-is-there-a-way-to-authenticate-graded-slabs/',
        note: 'Hobby write-up: missing embossed logo is a common fake tell.',
      },
    ],
    FUGITIVE_INK: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Gentlemen’s Vault — fugitive ink pattern',
        url: 'https://gentlemenvault.com/seller-caught-selling-fake-pokemon-slabs-on-ebay-is-there-a-way-to-authenticate-graded-slabs/',
        note: 'Faint PSA graphic in white label areas.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'LegitApp — label magnification (watermark dots)',
        url: 'https://legitapp.com/blog/real-vs-fake-how-to-authenticate-a-psa-graded-pokemon-card',
        note: 'Faint blue PSA watermark vs blotchy counterfeit printing.',
      },
    ],
    PLASTIC_CLARITY: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'PSA Security: A Buyer’s Guide',
        url: 'https://www.psacard.com/services/psasecurityabuyersguide',
        note: 'Case quality, sonic seal, and tamper signs.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — slab legit-check',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'Sonic weld seam, frosting, and clarity checks across graders.',
      },
    ],
    SERIAL_FORMAT: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'PSA Cert Verification',
        url: 'https://www.psacard.com/cert',
        note: 'Official database lookup — cert alone does not guarantee the physical slab is genuine.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'PokéSats — cert number vs card image',
        url: 'https://pokesats.com/newsroom/how-to-spot-a-fake-psa-slab/',
        note: 'Stolen cert numbers on fake labels; compare PSA on-file image to the card in hand.',
      },
    ],
    CARD_SLAB_FIT: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — fit and tampering',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'Snug fit and reholder/tamper context.',
      },
    ],
    LABEL_COLOR_QUALITY: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'PokéSats — red shade on GEM MT bar',
        url: 'https://pokesats.com/newsroom/how-to-spot-a-fake-psa-slab/',
        note: 'Brick-red vs orange/pink counterfeit labels.',
      },
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'PSA Security: A Buyer’s Guide (label light test)',
        url: 'https://www.psacard.com/services/psasecurityabuyersguide',
        note: 'Hold label to strong light — authentic labels allow faint see-through; stacked fake labels do not.',
      },
    ],
  },
  BGS: {
    TRADEMARK_SYMBOL: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — BGS holder notes',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'Beckett case markings and label expectations.',
      },
    ],
    LABEL_COLOR_SIZE: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'Beckett — walking through the BGS process',
        url: 'https://www.beckett.com/news/walking-bgs-process/',
        note: 'Official label creation and gold label standards.',
      },
    ],
    SUBGRADE_LAYOUT: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'Beckett Graded Card Lookup',
        url: 'https://www.beckett.com/grading/card-lookup',
        note: 'Verify subgrades and card details match the database entry.',
      },
    ],
    INNER_SLEEVE: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'Beckett — BGS slabbing (inner sleeve)',
        url: 'https://www.beckett.com/news/walking-bgs-process/',
        note: 'Archival inner sleeve before ultrasonic weld — direct card-to-plastic contact is suspicious.',
      },
    ],
    CERT_FORMAT: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'Beckett Cert Lookup',
        url: 'https://www.beckett.com/grading/card-lookup',
        note: '10-digit zero-padded serial on label; confirm online.',
      },
    ],
    PLASTIC_CLARITY: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'Beckett — sonic weld sealing',
        url: 'https://www.beckett.com/news/walking-bgs-process/',
        note: 'Crystal-clear shell, ultrasonic weld, tamper-resistant seal.',
      },
    ],
    CARD_SLAB_FIT: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'Beckett ticket/slab diagram (inner sleeve)',
        url: 'https://www.beckett.com/ticket-grading',
        note: 'Inner sleeve prevents internal movement; snug overall fit.',
      },
    ],
  },
  CGC: {
    LABEL_TYPOGRAPHY: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'CGC Counterfeit Alert (print quality)',
        url: 'https://www.cgccards.com/news/article/14799/counterfeit-alert-fleer-michael-jordan/',
        note: 'Official example of typography and print pixilation on fakes.',
      },
    ],
    PLASTIC_CLARITY: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'CGC Cert Verification',
        url: 'https://www.cgccards.com/certlookup/',
        note: 'Confirms holder is genuine and has not been tampered with.',
      },
    ],
    CARD_SLAB_FIT: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'CGC holder security features',
        url: 'https://www.cgccards.com/',
        note: 'State-of-the-art holder optics and security features.',
      },
    ],
    SERIAL_FORMAT: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'CGC Cert Lookup',
        url: 'https://www.cgccards.com/certlookup/',
        note: 'Enter cert number or scan QR on label back.',
      },
    ],
    SEAL_INTEGRITY: [
      {
        kind: 'company',
        citeLabel: 'Company Guide',
        title: 'CGC Cert Verification (tamper check)',
        url: 'https://www.cgccards.com/certlookup/',
        note: 'Database + holder images help detect swapped or reopened cases.',
      },
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — CGC holo & seal notes',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'Community cross-grader seal and hologram checks.',
      },
    ],
  },
  Other: {
    LABEL_TYPOGRAPHY: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — graded slab overview',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'General label and cert checks for non-PSA slabs.',
      },
    ],
    PLASTIC_CLARITY: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — case clarity',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'Frosting, weld, and holder quality across brands.',
      },
    ],
    SERIAL_FORMAT: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'r/pokemoncards — PSA cert lookup PSA megathread',
        url: 'https://www.reddit.com/r/pokemoncards/comments/1bqj8wq/psa_certification_lookup_megathread/',
        note: 'Community resource for cert verification workflow (apply same discipline to any grader).',
      },
    ],
    SEAL_INTEGRITY: [
      {
        kind: 'social',
        citeLabel: 'Social Evidence',
        title: 'Poke Master Center — seal integrity',
        url: 'https://www.pokemastercenter.com/how-to-legit-check-pokemon-cards-and-graded-slabs/',
        note: 'Weld and reopen signs for generic slabs.',
      },
    ],
  },
};

export const SLAB_AUTH_HOUSE_CERT_LINKS: Record<SlabGradingHouse, SlabAuthCertLink[]> = {
  PSA: [
    {
      house: 'PSA',
      title: 'PSA Cert Verification',
      url: 'https://www.psacard.com/cert',
      note: 'Verify cert number; compare card image and grade to the slab in hand.',
    },
    {
      house: 'PSA',
      title: 'PSA Security: A Buyer’s Guide',
      url: 'https://www.psacard.com/services/psasecurityabuyersguide',
      note: 'Label light test, database limits, and buying from authorized dealers.',
    },
    {
      house: 'PSA',
      title: 'PSA — counterfeiting & reporting',
      url: 'https://www.psacard.com/communication',
      note: 'Official stance on counterfeit slabs and item verification requests.',
    },
  ],
  BGS: [
    {
      house: 'BGS',
      title: 'Beckett Graded Card Lookup',
      url: 'https://www.beckett.com/grading/card-lookup',
      note: 'Instant cert verification for BGS, BVG, and BCCG.',
    },
  ],
  CGC: [
    {
      house: 'CGC',
      title: 'CGC Cert Lookup',
      url: 'https://www.cgccards.com/certlookup/',
      note: 'Cert number or QR scan; view holder images from grading.',
    },
  ],
  Other: [
    {
      house: 'Other',
      title: 'Use the grader’s official cert tool',
      note: 'Always look up the serial on the grading company’s website before relying on visual checks alone.',
      url: 'https://www.psacard.com/cert',
    },
  ],
};

export const SGC_CERT_ONLY: SlabAuthCertLink = {
  house: 'SGC',
  title: 'SGC Cert Code Lookup',
  url: 'https://www.gosgc.com/cert-code-lookup',
  note: 'RawGraded does not run SGC-specific visual checks yet — verify the cert code (7 or 11 characters) and QR first.',
};

export function getChecksForHouse(gradingHouse: SlabGradingHouse): SlabAuthCheckDef[] {
  return SLAB_AUTH_CHECKS[gradingHouse];
}

export function getBaseCheckNames(gradingHouse: SlabGradingHouse): string[] {
  return getChecksForHouse(gradingHouse).map((c) => c.id);
}

/** Numbered prompt block for Gemini (matches legacy format). */
export function buildHouseChecksPrompt(gradingHouse: SlabGradingHouse): string {
  const checks = getChecksForHouse(gradingHouse);
  const header =
    gradingHouse === 'PSA'
      ? 'PSA-SPECIFIC CHECKS — examine each carefully on the images:'
      : gradingHouse === 'BGS'
        ? 'BGS/BECKETT-SPECIFIC CHECKS — examine each carefully on the images:'
        : 'GENERIC GRADED SLAB CHECKS:';

  const lines = checks.map((c, i) => `${i + 1}. ${c.id}: ${c.description}`);
  return `${header}\n${lines.join('\n')}`;
}

export function buildSlabAuthInstructionsBlock(): string {
  const t = SLAB_AUTH_THRESHOLDS;
  return [
    `INSTRUCTIONS:`,
    `- For each check listed, assign a score from 0 (completely fails) to 100 (passes perfectly) and set "pass" to true if score >= ${t.passMin}.`,
    `- Provide a "detail" string (1-2 sentences) explaining your reasoning for each check.`,
    `- If visual evidence is clear, provide "box2d": [ymin, xmin, ymax, xmax] (normalized 0-1000) bounding the specific feature.`,
    `- If providing box2d, provide "imageIndex": 0 for front image, 1 for back image, or 2,3,4,etc for the video frame that best shows the feature.`,
    `- Set "serial_detected" to the cert number you can read from the label (empty string if unreadable).`,
    `- Set "card_name_detected" to the card name/description visible inside the slab.`,
    `- Compute "authenticity_score" as the weighted average of all check scores.`,
    `- Set "verdict" to: "LIKELY AUTHENTIC" (score >= ${t.likelyAuthentic}), "INCONCLUSIVE" (score ${t.inconclusiveMin}-${t.inconclusiveMax}), or "LIKELY FAKE" (score < ${t.likelyFakeBelow}).`,
    `- Write a 3-5 sentence "ai_reasoning" summary covering the most important findings.`,
    ``,
    `IMPORTANT: Be conservative. When in doubt about a check (e.g. image is unclear or you cannot see the feature), score it 50 and note the limitation.`,
    `Return ONLY valid JSON matching the schema.`,
  ].join('\n');
}

type GuideAttributionEntry = {
  id: string;
  house: string;
  checkId: string | null;
  variant: SlabRefImageVariant;
  src: string;
  alt: string;
  caption: string;
  sourceTitle: string;
  sourceUrl: string;
  citeLabel: SlabAuthReferenceImage['citeLabel'];
  hero?: boolean;
  certVerify?: boolean;
};

/** Merge downloaded reference images from attribution.json into guide payload. */
export function enrichGuidePayloadWithImages<T extends ReturnType<typeof buildSlabAuthGuidePayload>>(
  payload: T,
  attributionEntries: GuideAttributionEntry[]
): T {
  const byCheck = new Map<string, SlabAuthReferenceImage[]>();
  const heroes: SlabAuthHeroImage[] = [];
  const certVerifyImages: SlabAuthReferenceImage[] = [];

  const variantOrder: Record<SlabRefImageVariant, number> = {
    authentic: 0,
    diagram: 1,
    suspect: 2,
  };

  for (const e of attributionEntries) {
    const img: SlabAuthReferenceImage = {
      id: e.id,
      variant: e.variant,
      src: e.src,
      alt: e.alt,
      caption: e.caption,
      sourceTitle: e.sourceTitle,
      sourceUrl: e.sourceUrl,
      citeLabel: e.citeLabel,
    };
    if (e.certVerify) {
      certVerifyImages.push(img);
      continue;
    }
    if (e.hero) {
      heroes.push({
        house: e.house,
        src: img.src,
        alt: img.alt,
        caption: img.caption,
        sourceTitle: img.sourceTitle,
        sourceUrl: img.sourceUrl,
        citeLabel: img.citeLabel,
      });
      continue;
    }
    if (!e.checkId) continue;
    const key = `${e.house}::${e.checkId}`;
    const list = byCheck.get(key) ?? [];
    list.push(img);
    byCheck.set(key, list);
  }

  const houses = { ...payload.houses } as T['houses'];
  for (const house of Object.keys(houses) as SlabGradingHouse[]) {
    const block = houses[house];
    if (!block) continue;
    const checks = block.checks.map((c) => {
      const key = `${house}::${c.id}`;
      const refs = byCheck.get(key);
      if (!refs?.length) return c;
      const sorted = [...refs].sort(
        (a, b) => (variantOrder[a.variant] ?? 9) - (variantOrder[b.variant] ?? 9)
      );
      return { ...c, referenceImages: sorted };
    });
    houses[house] = { ...block, checks };
  }

  return {
    ...payload,
    houses,
    houseHeroes: heroes,
    certVerifyImages: certVerifyImages.sort(
      (a, b) => (variantOrder[a.variant] ?? 9) - (variantOrder[b.variant] ?? 9)
    ),
  };
}

/** JSON payload for the public identification guide. */
export function buildSlabAuthGuidePayload() {
  const houses: SlabGradingHouse[] = ['PSA', 'BGS', 'CGC', 'Other'];
  return {
    updated: '2026-05-30',
    thresholds: { ...SLAB_AUTH_THRESHOLDS },
    disclaimer:
      'Certification database lookup confirms a number exists and may show grading images — it does not by itself prove the physical slab in your hand is genuine. Counterfeiters sometimes reuse real cert numbers on fake holders.',
    houses: Object.fromEntries(
      houses.map((h) => [
        h,
        {
          checks: SLAB_AUTH_CHECKS[h].map((c) => ({ ...c })),
          certLinks: SLAB_AUTH_HOUSE_CERT_LINKS[h],
          checkRefs: SLAB_AUTH_CHECK_REFS[h] ?? {},
        },
      ])
    ),
    houseHeroes: [] as SlabAuthHeroImage[],
    certVerifyImages: [] as SlabAuthReferenceImage[],
    sgcCertOnly: SGC_CERT_ONLY,
    resources: [
      {
        kind: 'social' as const,
        citeLabel: 'Social Evidence' as const,
        title: 'r/psagrading',
        url: 'https://www.reddit.com/r/psagrading/',
        note: 'Community focused on PSA grading and slab authentication questions.',
      },
      {
        kind: 'company' as const,
        citeLabel: 'Company Guide' as const,
        title: 'PSA Authorized Dealers',
        url: 'https://www.psacard.com/dealers',
        note: 'PSA encourages buying verified items from authorized dealers when possible.',
      },
    ],
  };
}
