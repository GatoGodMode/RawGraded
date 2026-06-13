import React, { forwardRef } from 'react';
import LogoR from '../LogoR';
import type { CardData, GradingResult, ResolvedCardIdentity } from '../../types';
import { getGradeGradient } from '../../services/export/gradeGradient';
import { truncateForSocial } from '../../services/export/truncateForSocial';
import { deriveTcgCondition } from '../../services/grading/tcgGradeNormalize';

const S = 1080 / 800;

export interface StudioSocial1080TargetProps {
  cardData: CardData;
  grade: GradingResult;
  resolvedId: ResolvedCardIdentity;
  certId: string;
}

function formatGradeLabel(overall: number): string {
  if (overall === 10) return 'GEM MINT';
  if (overall >= 9) return 'MINT';
  return 'EXCELLENT';
}

function formatPredicted(value: number | undefined, fallback: number): string {
  if (typeof value === 'number' && value > 0) return String(value);
  return String(fallback);
}

const StudioSocial1080Target = forwardRef<HTMLDivElement, StudioSocial1080TargetProps>(
  function StudioSocial1080Target({ cardData, grade, resolvedId, certId }, ref) {
    const predicted = grade.predictedGrades;
    const overall = grade.overall;
    const caption = truncateForSocial(grade.reasoning);
    const tcgLabel = predicted?.tcg ? deriveTcgCondition(grade) : null;
    const frontSrc = cardData.frontCropped || cardData.frontRaw || '';
    const backSrc = cardData.backCropped || cardData.backRaw || '';
    const yearLine = grade.detectedYear || cardData.metadata.year;
    const numberPart = resolvedId.detectedCardNumber ? ` • #${resolvedId.detectedCardNumber}` : '';

    return (
      <div
        ref={ref}
        style={{
          width: 1080,
          height: 1080,
          background: '#090909',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '"Playfair Display", "Georgia", serif',
          overflow: 'hidden',
          position: 'relative',
          color: '#D4AF37',
        }}
        aria-hidden
      >
        <div
          style={{
            position: 'absolute',
            top: 12 * S,
            left: 12 * S,
            right: 12 * S,
            bottom: 12 * S,
            border: '1px solid #2A2416',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 18 * S,
            left: 18 * S,
            right: 18 * S,
            bottom: 18 * S,
            border: '1px solid #1A160D',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `${36 * S}px ${44 * S}px 0`,
            flexShrink: 0,
            position: 'relative',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 * S }}>
            <LogoR size={36 * S} />
            <div>
              <p style={{ fontSize: 24 * S, fontWeight: 600, letterSpacing: '0.05em', color: '#D4AF37', margin: 0, lineHeight: 1 }}>
                RAWGRADED
              </p>
              <p
                style={{
                  fontSize: 8 * S,
                  fontFamily: 'system-ui, sans-serif',
                  letterSpacing: '0.4em',
                  textTransform: 'uppercase',
                  color: '#887440',
                  margin: 0,
                  marginTop: 6 * S,
                }}
              >
                Studio · Verified AI Scan
              </p>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p
              style={{
                fontSize: 8 * S,
                fontFamily: 'system-ui, sans-serif',
                letterSpacing: '0.4em',
                textTransform: 'uppercase',
                color: '#887440',
                margin: 0,
              }}
            >
              Audit ID
            </p>
            <p style={{ fontSize: 20 * S, letterSpacing: '0.15em', color: '#D4AF37', margin: 0, marginTop: 4 * S }}>{certId}</p>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: `${32 * S}px ${44 * S}px 0`,
            position: 'relative',
            zIndex: 10,
            minHeight: 0,
          }}
        >
          <div style={{ marginBottom: 24 * S, textAlign: 'center' }}>
            <h2
              style={{
                fontSize: 32 * S,
                fontWeight: 400,
                fontStyle: 'italic',
                color: '#E8C55A',
                margin: 0,
                lineHeight: 1.35,
                padding: `0 ${12 * S}px`,
              }}
            >
              {resolvedId.detectedName || 'Unknown Card'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 * S, marginTop: 12 * S }}>
              <span style={{ width: 40 * S, height: 1, background: '#3A3121' }} />
              <span
                style={{
                  fontSize: 11 * S,
                  fontFamily: 'system-ui, sans-serif',
                  letterSpacing: '0.25em',
                  color: '#AA9155',
                  textTransform: 'uppercase',
                }}
              >
                {resolvedId.detectedSet || '—'}
                {yearLine ? ` • ${yearLine}` : ''}
                {numberPart}
              </span>
              <span style={{ width: 40 * S, height: 1, background: '#3A3121' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flex: 1, gap: 32 * S, minHeight: 0 }}>
            <div style={{ width: 280 * S, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div
                style={{
                  width: 180 * S,
                  height: 180 * S,
                  border: '1px solid #D4AF37',
                  padding: 6 * S,
                  marginBottom: 20 * S,
                  background: '#040404',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    background: getGradeGradient(overall),
                    boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8)',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 100 * S,
                        fontWeight: 400,
                        color: '#fff',
                        lineHeight: 1,
                        fontFamily: '"Playfair Display", "Georgia", serif',
                      }}
                    >
                      {overall}
                    </span>
                  </div>
                </div>
              </div>

              <span
                style={{
                  fontSize: 12 * S,
                  fontFamily: 'system-ui, sans-serif',
                  fontWeight: 300,
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  color: '#D4AF37',
                  marginBottom: 16 * S,
                }}
              >
                {formatGradeLabel(overall)}
              </span>

              <div style={{ width: '100%', borderTop: '1px solid #2A2416', padding: `${16 * S}px 0` }}>
                <span
                  style={{
                    fontSize: 7 * S,
                    fontFamily: 'system-ui, sans-serif',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: '#5A4D2B',
                    display: 'block',
                    textAlign: 'center',
                    marginBottom: 12 * S,
                  }}
                >
                  Projected equivalents
                </span>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontFamily: 'system-ui, sans-serif',
                    padding: `0 ${8 * S}px`,
                  }}
                >
                  <div>
                    <span style={{ fontSize: 8 * S, color: '#887440' }}>PSA </span>
                    <span style={{ fontSize: 14 * S, color: '#D4AF37', fontWeight: 700 }}>
                      {formatPredicted(predicted?.psa, overall)}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: 8 * S, color: '#887440' }}>BGS </span>
                    <span style={{ fontSize: 14 * S, color: '#D4AF37', fontWeight: 700 }}>
                      {formatPredicted(predicted?.bgs, overall)}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: 8 * S, color: '#887440' }}>CGC </span>
                    <span style={{ fontSize: 14 * S, color: '#D4AF37', fontWeight: 700 }}>
                      {formatPredicted(predicted?.cgc, overall)}
                    </span>
                  </div>
                </div>
                {tcgLabel && (
                  <p
                    style={{
                      textAlign: 'center',
                      marginTop: 12 * S,
                      fontSize: 9 * S,
                      fontFamily: 'system-ui, sans-serif',
                      letterSpacing: '0.15em',
                      color: '#887440',
                      textTransform: 'uppercase',
                    }}
                  >
                    TCG · {tcgLabel}
                  </p>
                )}
              </div>

              <div
                style={{
                  width: '100%',
                  borderTop: '1px solid #2A2416',
                  marginTop: 12 * S,
                  paddingTop: 12 * S,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10 * S,
                }}
              >
                {[
                  { label: 'Centering', val: grade.centering },
                  { label: 'Corners', val: grade.corners },
                  { label: 'Edges', val: grade.edges },
                  { label: 'Surface', val: grade.surface },
                ].map((sub) => (
                  <div
                    key={sub.label}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: `0 ${8 * S}px` }}
                  >
                    <span
                      style={{
                        fontSize: 9 * S,
                        fontFamily: 'system-ui, sans-serif',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: '#887440',
                      }}
                    >
                      {sub.label}
                    </span>
                    <span style={{ fontSize: 15 * S, fontWeight: 700, color: '#FBF9F6' }}>{sub.val ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, gap: 16 * S }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 * S, minHeight: 0 }}>
                {frontSrc ? (
                  <div
                    style={{
                      padding: 12 * S,
                      background: '#111',
                      border: '1px solid #3A3121',
                      boxShadow: '0 20px 40px #040404',
                      transform: 'rotate(-1deg)',
                    }}
                  >
                    <div style={{ border: '1px solid #2A2416', padding: 2, background: '#090909' }}>
                      <img src={frontSrc} alt="" style={{ height: 240 * S, width: 'auto', maxWidth: 200 * S, display: 'block' }} />
                    </div>
                  </div>
                ) : null}
                {backSrc ? (
                  <div
                    style={{
                      padding: 12 * S,
                      background: '#111',
                      border: '1px solid #3A3121',
                      boxShadow: '0 20px 40px #040404',
                      transform: 'rotate(1.5deg)',
                      marginTop: 32 * S,
                    }}
                  >
                    <div style={{ border: '1px solid #2A2416', padding: 2, background: '#090909' }}>
                      <img src={backSrc} alt="" style={{ height: 230 * S, width: 'auto', maxWidth: 190 * S, display: 'block' }} />
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  borderTop: '1px solid #2A2416',
                  paddingTop: 14 * S,
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    fontSize: 8 * S,
                    fontFamily: 'system-ui, sans-serif',
                    letterSpacing: '0.25em',
                    textTransform: 'uppercase',
                    color: '#887440',
                    margin: `0 0 ${8 * S}px`,
                  }}
                >
                  Analysis
                </p>
                <p
                  style={{
                    fontSize: 13 * S,
                    fontFamily: 'system-ui, sans-serif',
                    fontWeight: 300,
                    lineHeight: 1.55,
                    color: '#C4B896',
                    margin: 0,
                  }}
                >
                  {caption}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `0 ${44 * S}px ${28 * S}px`,
            position: 'relative',
            zIndex: 10,
            flexShrink: 0,
          }}
        >
          <p
            style={{
              fontSize: 7 * S,
              fontFamily: 'system-ui, sans-serif',
              letterSpacing: '0.4em',
              textTransform: 'uppercase',
              color: '#5A4D2B',
              margin: 0,
            }}
          >
            RawGraded Studio · Local engine
          </p>
          {resolvedId.source === 'pricecharting' && (
            <p style={{ fontSize: 7 * S, fontFamily: 'system-ui, sans-serif', letterSpacing: '0.2em', color: '#887440', margin: 0 }}>
              ID: PriceCharting
            </p>
          )}
        </div>
      </div>
    );
  }
);

export default StudioSocial1080Target;
