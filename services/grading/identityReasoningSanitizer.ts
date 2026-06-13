/** Remove narrative claims that identity (name/set/number) came from the card back. */
const BACK_IDENTITY_PHRASES: RegExp[] = [
  /\b(?:lack|lacking|missing|unclear|no)\s+of\s+clear\s+[^.]{0,80}?\bon\s+the\s+back\s+scan\b/gi,
  /\b(?:set|card\s+number|name|edition|year|artist)[^.]{0,60}?\bon\s+the\s+back\s+(?:scan|image)\b/gi,
  /\bback\s+scan\s+(?:shows?|indicates?|suggests?|for)[^.]{0,80}?\b(?:set|number|name|edition)\b/gi,
  /\b(?:from|on|using)\s+the\s+back\s+scan[^.]{0,80}?\b(?:identity|set|number|name)\b/gi,
  /\bidentity\s+confidence\s+is\s+low[^.]{0,100}?\bback\s+scan\b/gi,
  /\bback\s+of\s+the\s+card[^.]{0,60}?\b(?:set|number|name|edition)\b/gi,
];

export function stripBackIdentityFromReasoning(text: string): string {
  let out = text || '';
  for (const pat of BACK_IDENTITY_PHRASES) {
    out = out.replace(pat, '').replace(/\s+/g, ' ').trim();
  }
  if (/back\s+scan/i.test(out) && /\b(?:set|card\s+number|name|edition)\b/i.test(out)) {
    out = out
      .replace(
        /\b[^.]{0,120}?\bback\s+scan\b[^.]{0,120}?(?:set|card\s+number|name|edition)[^.]*\.?/gi,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  }
  return out;
}
