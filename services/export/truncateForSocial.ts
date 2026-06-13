/** Trim grading reasoning for social export caption block. */
export function truncateForSocial(reasoning: string | undefined, maxChars = 320): string {
  let text = (reasoning || '').trim();
  if (!text) return 'Condition assessed from front scan, forensic grid, and measured centering where available.';

  text = text
    .replace(/\[Centering notes\]:[^|]*/gi, '')
    .replace(/\[Re-identified\]:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}
