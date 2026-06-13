import React, { useState } from 'react';
import { brandLogoSrc, BRAND_LABELS, type BrandLogoKey } from './BrandLogos';

export const BrandLogoImg: React.FC<{
  brand: BrandLogoKey;
  className?: string;
  title?: string;
}> = ({ brand, className = '', title }) => {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span
        className={`inline-flex items-center justify-center text-[9px] font-black uppercase tracking-wider ${className}`}
        title={title || BRAND_LABELS[brand]}
      >
        {BRAND_LABELS[brand]}
      </span>
    );
  }
  return (
    <img
      src={brandLogoSrc(brand)}
      alt=""
      role="presentation"
      title={title || BRAND_LABELS[brand]}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
};
