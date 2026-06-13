/** Grade badge background gradient (matches SlabSlip / web galleria). */
export function getGradeGradient(grade: number | string | undefined): string {
  const numGrade = Number(grade);
  if (Number.isNaN(numGrade)) return 'linear-gradient(135deg, #1f2937 0%, #000000 100%)';
  if (numGrade === 10) return 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 50%, #8A6F1C 100%)';
  if (numGrade >= 9) return 'linear-gradient(135deg, #E8E8E8 0%, #B0B0B0 50%, #686868 100%)';
  return 'linear-gradient(135deg, #8A6F1C 0%, #4A3A12 100%)';
}
