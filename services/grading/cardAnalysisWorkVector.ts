import type { AnalysisChunkRef, CenteringMeasurement, Defect, GradingResult } from '../../types';
import { sanitizeDetectedEdition } from './firstEditionGuard';
import { filterFrameDefects } from './centeringAssessment';
import { selectGradingRuleset } from '../gradingRulesets';
import { computeGradesFromEvidence, applyComputedGradesToResult } from './gradingMathEngine';

export type IdentityConfidence = 'high' | 'medium' | 'low';

export interface LocalOcrFields {
  name: string;
  cardNumber: string;
  hp?: string;
  type?: string;
  stage?: string;
  attacks?: string;
  weakness?: string;
  resistance?: string;
  retreat?: string;
}

export interface CardIdentity {
  detectedName: string;
  detectedSet: string;
  detectedYear: string;
  detectedEdition: string;
  detectedCardNumber: string;
  detectedArtist: string;
  detectedCharacter: string;
  isHolographic: boolean;
  holoPattern: string;
  backSetSymbol?: string;
  backEditionNote?: string;
  backPrintQuality?: string;
}

export interface CenteringSlice {
  subgrade: number;
  reasoning: string;
}

export interface FramePassSlice {
  reasoning: string;
  passLabel: string;
  imageIndex: number;
  defects: Defect[];
}

export interface PhaseLogEntry {
  label: string;
  summary: string;
  at: number;
}

export interface TcgdexCandidate {
  id: string;
  localId: string;
  name: string;
  set: string;
  year: string;
  artist: string;
  rarity: string;
}

export type PromptContextScope =
  | 'identity'
  | 'centering'
  | 'defects'
  | 'synthesis'
  | 'full';

export function scoreIdentityConfidence(
  ocr: LocalOcrFields,
  candidates: TcgdexCandidate[]
): IdentityConfidence {
  if (candidates.length === 0) return 'low';
  const cleanNum = ocr.cardNumber.split('/')[0].replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  const nameMatch = candidates.filter(
    (c) => c.name.toLowerCase() === ocr.name.toLowerCase() || ocr.name.toLowerCase().includes(c.name.toLowerCase())
  );
  if (nameMatch.length === 0) return 'low';
  if (nameMatch.length === 1 && cleanNum) {
    const c = nameMatch[0];
    const idMatch =
      c.id.toLowerCase().endsWith(`-${cleanNum}`) || c.localId.toLowerCase() === cleanNum;
    if (idMatch) return 'high';
  }
  if (cleanNum && candidates.some((c) => c.localId.toLowerCase() === cleanNum)) return 'medium';
  return nameMatch.length === 1 ? 'medium' : 'low';
}

export function normalizeWorkVectorDefects(raw: unknown, defaultImageIndex: number): Defect[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => {
    const defect = d as Record<string, unknown>;
    const reasoning = String(defect.reasoning || defect.description || '').trim();
    return {
      category: String(defect.category || 'defect'),
      description: reasoning || 'No detail provided.',
      imageIndex: typeof defect.imageIndex === 'number' ? defect.imageIndex : defaultImageIndex,
      confidence: typeof defect.confidence === 'number' ? defect.confidence : 0.75,
      box2d: Array.isArray(defect.box2d) ? (defect.box2d as number[]) : [],
    };
  });
}

export class CardAnalysisWorkVector {
  ocrFields: LocalOcrFields = { name: '', cardNumber: '' };
  identity: CardIdentity = {
    detectedName: '',
    detectedSet: '',
    detectedYear: '',
    detectedEdition: '',
    detectedCardNumber: '',
    detectedArtist: '',
    detectedCharacter: '',
    isHolographic: false,
    holoPattern: 'none',
  };
  identityConfidence: IdentityConfidence = 'low';
  tcgCandidates: TcgdexCandidate[] = [];
  centeringNotes: string[] = [];
  frontDefects: Defect[] = [];
  backDefects: Defect[] = [];
  frameDefects: Defect[] = [];
  framePasses: FramePassSlice[] = [];
  riskFactors: string[] = [];
  synthesisReasoning = '';
  reasoningLog: PhaseLogEntry[] = [];
  analysisChunks: AnalysisChunkRef[] = [];

  appendPhase(label: string, payload: Record<string, unknown>): void {
    const summary =
      typeof payload.reasoning === 'string'
        ? payload.reasoning.slice(0, 280)
        : JSON.stringify(payload).slice(0, 280);
    this.reasoningLog.push({ label, summary, at: Date.now() });
  }

  setOcrFields(fields: LocalOcrFields): void {
    this.ocrFields = fields;
  }

  setIdentityFromPhase1(raw: Record<string, unknown>): void {
    this.identity = {
      detectedName: String(raw.detectedName || this.ocrFields.name || 'Unknown'),
      detectedSet: String(raw.detectedSet || ''),
      detectedYear: String(raw.detectedYear || ''),
      detectedEdition: String(raw.detectedEdition || ''),
      detectedCardNumber: String(raw.detectedCardNumber || this.ocrFields.cardNumber || ''),
      detectedArtist: String(raw.detectedArtist || ''),
      detectedCharacter: String(raw.detectedCharacter || ''),
      isHolographic: Boolean(raw.isHolographic),
      holoPattern: String(raw.holoPattern || 'none'),
    };
    this.appendPhase('Identity front', raw);
  }

  /** Back scan: condition/print notes only — never name, set, number, or edition. */
  setBackCondition(raw: Record<string, unknown>): void {
    this.identity.backPrintQuality = String(raw.backPrintQuality || raw.printQuality || '');
    if (raw.reasoning) this.appendPhase('Back condition', raw);
  }

  setAnalysisChunks(chunks: AnalysisChunkRef[]): void {
    this.analysisChunks = chunks;
  }

  mergeIdentityBands(topRaw: Record<string, unknown>, bottomRaw: Record<string, unknown>): void {
    const name = String(topRaw.detectedName || this.ocrFields.name || '');
    const merged = {
      detectedName: name || this.identity.detectedName,
      detectedCharacter: String(topRaw.detectedCharacter || bottomRaw.detectedCharacter || this.identity.detectedCharacter),
      detectedSet: String(topRaw.detectedSet || bottomRaw.detectedSet || this.identity.detectedSet),
      detectedYear: String(topRaw.detectedYear || bottomRaw.detectedYear || this.identity.detectedYear),
      detectedEdition: String(bottomRaw.detectedEdition || topRaw.detectedEdition || this.identity.detectedEdition),
      detectedCardNumber: String(
        bottomRaw.detectedCardNumber || topRaw.detectedCardNumber || this.ocrFields.cardNumber || ''
      ),
      detectedArtist: String(bottomRaw.detectedArtist || topRaw.detectedArtist || this.identity.detectedArtist),
      isHolographic: Boolean(topRaw.isHolographic ?? bottomRaw.isHolographic ?? this.identity.isHolographic),
      holoPattern: String(topRaw.holoPattern || bottomRaw.holoPattern || this.identity.holoPattern || 'none'),
    };
    merged.detectedEdition = sanitizeDetectedEdition(merged.detectedSet, merged.detectedEdition);
    this.identity = { ...this.identity, ...merged };
    this.appendPhase('Identity top band', topRaw);
    this.appendPhase('Identity bottom band', bottomRaw);
  }

  addCenteringNote(side: 'front' | 'back', reasoning: string): void {
    if (reasoning.trim()) {
      this.centeringNotes.push(`[${side}]: ${reasoning.trim()}`);
      this.appendPhase(`Centering ${side}`, { reasoning });
    }
  }

  addDefects(side: 'front' | 'back' | 'frame', defects: Defect[], label: string): void {
    if (side === 'front') this.frontDefects.push(...defects);
    else if (side === 'back') this.backDefects.push(...defects);
    else this.frameDefects.push(...defects);
    this.appendPhase(label, { defectCount: defects.length });
  }

  addFramePass(pass: FramePassSlice): void {
    this.framePasses.push(pass);
    this.frameDefects.push(...pass.defects);
    this.appendPhase(pass.passLabel, { reasoning: pass.reasoning });
  }

  addChunkPass(
    side: 'front' | 'back',
    row: number,
    col: number,
    imageIndex: number,
    defects: Defect[],
    reasoning: string
  ): void {
    const label = `${side} R${row + 1}C${col + 1}`;
    this.addDefects(side, defects, `Chunk ${label}`);
    if (reasoning.trim()) this.appendPhase(`Chunk ${label}`, { reasoning });
  }

  addRiskFactors(factors: string[]): void {
    for (const f of factors) {
      if (f.trim() && !this.riskFactors.includes(f.trim())) {
        this.riskFactors.push(f.trim());
      }
    }
  }

  setSynthesis(reasoning: string): void {
    this.synthesisReasoning = reasoning;
    this.appendPhase('Final synthesis', { reasoning });
  }

  toPromptContext(scope: PromptContextScope): string {
    const lines: string[] = [];
    if (scope === 'identity' || scope === 'full' || scope === 'synthesis') {
      lines.push(
        `IDENTITY: ${this.identity.detectedName} | ${this.identity.detectedSet} | #${this.identity.detectedCardNumber} | ${this.identity.detectedYear} | ${this.identity.detectedEdition}`
      );
      if (this.identity.isHolographic) {
        lines.push(`HOLO: ${this.identity.holoPattern || 'standard'}`);
      }
      lines.push(`IDENTITY CONFIDENCE: ${this.identityConfidence}`);
      if (this.ocrFields.hp) lines.push(`OCR HP: ${this.ocrFields.hp}, TYPE: ${this.ocrFields.type || '?'}`);
    }
    if (scope === 'defects' || scope === 'full' || scope === 'synthesis') {
      if (this.frontDefects.length) {
        lines.push(
          `FRONT DEFECTS (${this.frontDefects.length}): ${this.frontDefects.map((d) => d.category).join(', ')}`
        );
      }
      if (this.backDefects.length) {
        lines.push(
          `BACK DEFECTS (${this.backDefects.length}): ${this.backDefects.map((d) => d.category).join(', ')}`
        );
      }
      if (this.riskFactors.length) {
        lines.push(`RISK FACTORS: ${this.riskFactors.slice(0, 8).join('; ')}`);
      }
    }
    if (scope === 'synthesis') {
      for (const entry of this.reasoningLog.slice(-12)) {
        lines.push(`[${entry.label}]: ${entry.summary}`);
      }
    }
    return lines.join('\n');
  }

  compileEvidence(): { defects: Defect[]; conflicts: string[] } {
    const conflicts: string[] = [];
    const seen = new Map<string, Defect>();
    const all = [...this.frontDefects, ...this.backDefects, ...this.frameDefects];

    for (const d of all) {
      const key = `${d.imageIndex}:${d.category.toLowerCase()}:${d.description.slice(0, 40)}`;
      const existing = seen.get(key);
      if (existing) {
        if (existing.confidence !== d.confidence) {
          conflicts.push(`Duplicate ${d.category} on image ${d.imageIndex} with differing confidence`);
        }
        continue;
      }
      seen.set(key, d);
    }

    return { defects: filterFrameDefects([...seen.values()]), conflicts };
  }

  toGradingResult(
    useMeasuredCentering: boolean,
    centeringMeasurement?: CenteringMeasurement,
    category?: string
  ): GradingResult {
    const { defects } = this.compileEvidence();
    const reasoningParts = this.reasoningLog.map((e) => `[${e.label}]: ${e.summary}`);
    const reasoning =
      [this.synthesisReasoning, ...this.centeringNotes, ...reasoningParts].filter(Boolean).join(' | ') ||
      'Local Ollama forensic analysis.';

    const ruleset = selectGradingRuleset(this.identity.detectedSet, category || 'Pokemon');
    const computed = computeGradesFromEvidence({
      defects,
      detectedSet: this.identity.detectedSet,
      centeringMeasurement,
      useMeasuredCentering,
      ruleset,
      riskFactors: this.riskFactors,
      reasoning,
      identity: this.identity,
    });

    const shell: GradingResult = {
      centering: 0,
      corners: 0,
      edges: 0,
      surface: 0,
      overall: 0,
      reasoning,
      defects,
      riskFactors: computed.riskFactors,
      predictedGrades: computed.predictedGrades,
      detectedName: this.identity.detectedName,
      detectedCharacter: this.identity.detectedCharacter,
      detectedSet: this.identity.detectedSet,
      detectedYear: this.identity.detectedYear,
      detectedEdition: this.identity.detectedEdition,
      detectedCardNumber: this.identity.detectedCardNumber,
      detectedArtist: this.identity.detectedArtist,
      isHolographic: this.identity.isHolographic,
      holoPattern: this.identity.holoPattern,
      analysisChunks: this.analysisChunks.length ? this.analysisChunks : undefined,
    };

    return applyComputedGradesToResult(shell, computed);
  }
}
