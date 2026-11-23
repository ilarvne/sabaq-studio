import { CaretDownIcon } from '@phosphor-icons/react';
import type { Locale, Slide } from '@sabaq/lesson/types';
import './slide-position-picker.css';

const labels = {
  en: 'Go to slide',
  ru: 'Перейти к слайду',
  kk: 'Слайдқа өту',
};

interface SlidePositionPickerProps {
  slides: readonly Pick<Slide, 'id' | 'title'>[];
  index: number;
  locale: Locale;
  onChange: (index: number) => void;
}

export function SlidePositionPicker({ slides, index, locale, onChange }: SlidePositionPickerProps) {
  return (
    <label className="slide-position-picker">
      <span className="sr-only">{labels[locale]}</span>
      <span aria-hidden="true" className="slide-position-readout">
        {index + 1} / {slides.length}<CaretDownIcon />
      </span>
      <select value={index} onChange={event => onChange(Number(event.target.value))} title={labels[locale]}>
        {slides.map((slide, position) => (
          <option key={slide.id} value={position}>
            {position + 1}{slide.title && ` · ${slide.title}`}
          </option>
        ))}
      </select>
    </label>
  );
}
