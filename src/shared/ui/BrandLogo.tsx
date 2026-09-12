import React, { useState } from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
}) => {
  const [imageError, setImageError] = useState(false);

  // Dimension mapping
  const sizeMap = {
    sm: { img: 'w-7 h-7', textSmart: 'text-sm font-black', textLife: 'text-sm font-black', gap: 'gap-2' },
    md: { img: 'w-10 h-10', textSmart: 'text-lg font-black', textLife: 'text-lg font-black', gap: 'gap-2.5' },
    lg: { img: 'w-14 h-14', textSmart: 'text-2xl font-black', textLife: 'text-2xl font-black', gap: 'gap-3' },
    xl: { img: 'w-20 h-20', textSmart: 'text-3xl font-black', textLife: 'text-3xl font-black', gap: 'gap-4' },
  }[size];

  return (
    <div className={`flex items-center ${sizeMap.gap} ${className}`}>
      {/* Logo Graphic (Image with clean SVG fallback) */}
      <div className={`relative ${sizeMap.img} shrink-0 rounded-full overflow-hidden bg-white shadow-xs border border-slate-200/60 flex items-center justify-center`}>
        {!imageError ? (
          <img
            src="/smart-life-logo.jpg"
            alt="Logo Smart Creator"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          /* High precision SVG vector reproduction of the Smart Creator crescent logo */
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Outer Green Crescent */}
            <path
              d="M 50 10 A 40 40 0 1 0 78 78 A 34 34 0 1 1 50 16 Z"
              fill="#00C853"
            />
            {/* Inner Black Arc */}
            <path
              d="M 44 20 A 30 30 0 0 0 44 80 A 25 25 0 0 1 44 25 Z"
              fill="#0f172a"
            />
            {/* Lower Green Accent Flick */}
            <path
              d="M 32 60 C 40 75 60 75 75 68 C 60 70 45 68 32 60 Z"
              fill="#00C853"
            />
          </svg>
        )}
      </div>

      {/* Brand Text */}
      {showText && (
        <div className="flex flex-col leading-none tracking-tight">
          <div className="flex items-center gap-1 font-display">
            <span className={`${sizeMap.textSmart} text-[#00C853] tracking-wider`}>
              SMART
            </span>
            <span className={`${sizeMap.textLife} text-[#F59E0B] tracking-wider`}>
              LIFE
            </span>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mt-0.5">
            Veille & Stratégie E-Com
          </span>
        </div>
      )}
    </div>
  );
};
