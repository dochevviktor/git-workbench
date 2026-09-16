import { useRef } from 'react';

interface SplitterProps {
  readonly orientation: 'vertical' | 'horizontal';
  readonly label: string;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  /** When true, dragging toward the start of the axis grows the value. */
  readonly inverted?: boolean;
  readonly onChange: (value: number) => void;
}

const keyboardStep = 16;

/** A pointer- and keyboard-resizable divider between two panes. */
export function Splitter({
  orientation,
  label,
  value,
  minimum,
  maximum,
  inverted = false,
  onChange,
}: SplitterProps) {
  const drag = useRef<{ pointerId: number; origin: number; start: number } | undefined>(undefined);
  const clamp = (next: number) => Math.round(Math.max(minimum, Math.min(maximum, next)));
  const axis = (event: { clientX: number; clientY: number }) =>
    orientation === 'vertical' ? event.clientX : event.clientY;

  return (
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, origin: axis(event), start: value };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const delta = axis(event) - current.origin;
        onChange(clamp(current.start + (inverted ? -delta : delta)));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onKeyDown={(event) => {
        const decrease = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
        const increase = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== decrease && event.key !== increase) return;
        const direction = event.key === decrease ? -1 : 1;
        event.preventDefault();
        onChange(clamp(value + (inverted ? -direction : direction) * keyboardStep));
      }}
    />
  );
}
