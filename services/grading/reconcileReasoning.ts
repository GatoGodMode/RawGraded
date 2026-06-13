import type { GradingResult } from '../../types';
import { stripBackIdentityFromReasoning } from './identityReasoningSanitizer';

const CONTRADICTION_PATTERNS = [
  /pack[-\s]?fresh/gi,
  /no visible imperfections/gi,
  /no visible defects/gi,
  /flawless/gi,
  /gem mint condition/gi,
  /\bgem mint\b/gi,
  /pristine/gi,
  /within the acceptable range for a 10/gi,
  /corners and edges are sharp/gi,
  /surface is clean/gi,
];

export function reconcileGradingReasoning(result: GradingResult): GradingResult {
  let reasoning = stripBackIdentityFromReasoning(result.reasoning || '');
  const wearText = [reasoning, ...(result.riskFactors || [])].join(' ');
  const hasWear =
    result.defects.length > 0 ||
    result.edges <= 8.5 ||
    result.corners <= 8.5 ||
    result.overall <= 8.5 ||
    /\b(whitening|edge\s*wear|silvering|nick|chip|scuff)\b/i.test(wearText);

  if (!hasWear) return result;

  let stripped = false;
  for (const pat of CONTRADICTION_PATTERNS) {
    if (pat.test(reasoning)) {
      reasoning = reasoning.replace(pat, '').replace(/\s+/g, ' ').trim();
      stripped = true;
    }
  }

  if (stripped) {
    reasoning = `${reasoning}\n\n[Reconciled]: Forensic text adjusted — wear indicators and subgrades take precedence.`.trim();
  }

  return { ...result, reasoning };
}
