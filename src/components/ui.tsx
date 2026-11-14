/** Small shared UI primitives. */
import type { ReactNode } from 'react';
import { audio } from '../audio/AudioEngine';

export function Button({ children, onClick, kind = 'default', disabled, title, className = '' }: { children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button
      type="button"
      className={`btn btn-${kind} ${className}`}
      disabled={disabled}
      title={title}
      onClick={() => {
        audio.unlock();
        audio.uiClick();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, hint }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) {
  return (
    <label className="slider" title={hint}>
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-value">{format ? format(value) : value.toFixed(2)}</span>
    </label>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
        <i />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented-row">
      {label && <span className="slider-label">{label}</span>}
      <div className="segmented">
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScreenFrame({ title, subtitle, onBack, children, wide, actions }: { title: string; subtitle?: string; onBack?: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  return (
    <div className="screen">
      <div className={`screen-inner ${wide ? 'wide' : ''}`}>
        <header className="screen-head">
          {onBack && (
            <Button kind="ghost" onClick={onBack} className="back">
              ← Back
            </Button>
          )}
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="screen-actions">{actions}</div>
        </header>
        <div className="screen-body">{children}</div>
      </div>
    </div>
  );
}

/* unit helpers */
export const KT = 1.94384;
export const FT = 3.28084;
export function fmtSpeed(ms: number, units: 'aviation' | 'metric'): string {
  return units === 'aviation' ? `${Math.round(ms * KT)} kt` : `${Math.round(ms * 3.6)} km/h`;
}
export function fmtAlt(m: number, units: 'aviation' | 'metric'): string {
  return units === 'aviation' ? `${Math.round((m * FT) / 10) * 10} ft` : `${Math.round(m)} m`;
}
export function fmtDist(m: number, units: 'aviation' | 'metric'): string {
  return units === 'aviation' ? `${(m / 1852).toFixed(1)} nm` : `${(m / 1000).toFixed(1)} km`;
}
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
