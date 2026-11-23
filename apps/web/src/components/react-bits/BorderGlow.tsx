import type { CSSProperties, ReactNode } from 'react';
import './border-glow.css';

// Adapted from React Bits BorderGlow. The studio runs the sweep continuously on a decorative layer.
const meshPositions = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const meshColorIndices = [0, 1, 2, 0, 1, 2, 1] as const;

type BorderGlowProps = {
  children: ReactNode;
  colors: readonly [string, string, string];
  glowColor: string;
  duration?: number;
  borderRadius?: number;
  glowRadius?: number;
};

export function BorderGlow({
  children,
  colors,
  glowColor,
  duration = 16,
  borderRadius = 14,
  glowRadius = 14,
}: BorderGlowProps) {
  const gradients = meshPositions.map(
    (position, index) =>
      `radial-gradient(at ${position}, ${colors[meshColorIndices[index]]} 0px, transparent 50%) border-box`,
  );
  const style = {
    '--border-glow-mesh': [...gradients, `linear-gradient(${colors[0]} 0 100%) border-box`].join(', '),
    '--border-glow-color': glowColor,
    '--border-glow-duration': `${duration}s`,
    '--border-glow-radius': `${borderRadius}px`,
    '--border-glow-padding': `${glowRadius}px`,
  } as CSSProperties;
  return (
    <div className="border-glow-card" style={style}>
      <div className="border-glow-decoration" aria-hidden="true">
        <span className="edge-light" />
      </div>
      <div className="border-glow-inner">{children}</div>
    </div>
  );
}
