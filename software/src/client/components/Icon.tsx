import type { CSSProperties } from 'react';

export function Icon({ name, size, style, className = '' }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg className={`icon ${className}`} style={size ? { width: size, height: size, ...style } : style} aria-hidden="true">
      <use href={`/icons.svg#i-${name}`} />
    </svg>
  );
}
