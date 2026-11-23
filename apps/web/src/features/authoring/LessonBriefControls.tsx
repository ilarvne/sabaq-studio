import { useId, useState } from 'react';
import { CheckIcon, ClockIcon, GraduationCapIcon } from '@phosphor-icons/react';
import type { CreateInput, Locale } from '@sabaq/lesson/types';
import { formatTimeUnit } from '@sabaq/lesson/speech-time';
import { Button } from '@/components/shadcn/button';
import { Input } from '@/components/shadcn/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/shadcn/popover';
import './lesson-brief-controls.css';

type Answers = NonNullable<CreateInput['answers']>;
const labels = {
  en: {
    level: 'Audience',
    duration: 'Lesson time',
    levelTitle: 'Who are you teaching?',
    durationTitle: 'How long is the lesson?',
    auto: 'Decide automatically',
    levels: ['Middle school', 'High school', 'Adult learners'],
    customLevel: 'Other audience',
    customDuration: 'Other duration',
    levelHint: 'e.g. First-year nursing students',
    apply: 'Apply',
  },
  kk: {
    level: 'Аудитория',
    duration: 'Сабақ уақыты',
    levelTitle: 'Сабақ кімге арналған?',
    durationTitle: 'Сабақ қанша уақытқа созылады?',
    auto: 'Автоматты түрде таңдау',
    levels: ['Орта буын', 'Жоғары сынып', 'Ересек оқушылар'],
    customLevel: 'Басқа аудитория',
    customDuration: 'Басқа ұзақтық',
    levelHint: 'Мысалы, медицина колледжінің студенттері',
    apply: 'Қолдану',
  },
  ru: {
    level: 'Аудитория',
    duration: 'Время урока',
    levelTitle: 'Для кого этот урок?',
    durationTitle: 'Сколько длится урок?',
    auto: 'Определить автоматически',
    levels: ['Средние классы', 'Старшие классы', 'Взрослые'],
    customLevel: 'Другая аудитория',
    customDuration: 'Другая длительность',
    levelHint: 'Например, первокурсники медколледжа',
    apply: 'Применить',
  },
};

export function LessonBriefControls({
  locale,
  answers,
  onChange,
  disabled,
}: {
  locale: Locale;
  answers: Answers;
  onChange: (answers: Answers) => void;
  disabled: boolean;
}) {
  const [active, setActive] = useState<'level' | 'duration' | null>(null);
  const [custom, setCustom] = useState('');
  const fieldId = useId();
  const c = labels[locale];
  return (
    <div className="brief-controls">
      {(['level', 'duration'] as const).map((key) => {
        const time = key === 'duration';
        const values = time ? ['10', '20', '45'] : ['middle', 'secondary', 'adult'];
        const options = values.map((value, index) => ({
          value,
          title: time ? formatTimeUnit(Number(value),locale,'minute') : c.levels[index],
        }));
        const selected = answers[key];
        const valueText =
          options.find((option) => option.value === selected)?.title ??
          (time && selected && Number.isFinite(Number(selected)) ? formatTimeUnit(Number(selected),locale,'minute') : selected);
        const Icon = time ? ClockIcon : GraduationCapIcon;
        function apply(value?: string) {
          onChange({ ...answers, [key]: value });
          setActive(null);
        }
        const valid = time ? /^\d{1,3}$/u.test(custom.trim()) && Number(custom) > 0 : Boolean(custom.trim());
        return (
          <Popover
            key={key}
            open={active === key}
            onOpenChange={(open) => {
              setActive(open ? key : null);
              if (open) setCustom(selected && !values.includes(selected) ? selected : '');
            }}
          >
            <PopoverTrigger
              render={<Button type="button" size="sm" variant="ghost" disabled={disabled} />}
              className="brief-chip"
              title={`${c[key]}${valueText ? ` · ${valueText}` : ''}`}
              data-selected={Boolean(selected)}
              aria-label={`${c[key]}${valueText ? ` · ${valueText}` : ''}`}
            >
              <Icon aria-hidden="true" />
              <span>{valueText || c[key]}</span>
            </PopoverTrigger>
            <PopoverContent align="start" className="brief-question-card">
              <PopoverTitle>{time ? c.durationTitle : c.levelTitle}</PopoverTitle>
              <div className="brief-question-options">
                {[{ value: undefined, title: c.auto }, ...options].map((option) => (
                  <Button
                    key={option.value ?? 'auto'}
                    type="button"
                    variant="ghost"
                    aria-pressed={selected === option.value}
                    onClick={() => apply(option.value)}
                  >
                    {option.title}
                    {selected === option.value && <CheckIcon />}
                  </Button>
                ))}
              </div>
              <label htmlFor={`${fieldId}-${key}`}>{time ? c.customDuration : c.customLevel}</label>
              <div className="brief-custom-answer">
                <Input
                  id={`${fieldId}-${key}`}
                  type={time ? 'number' : 'text'}
                  min={time ? 1 : undefined}
                  max={time ? 999 : undefined}
                  maxLength={time ? 3 : 100}
                  placeholder={time ? formatTimeUnit(30,locale,'minute') : c.levelHint}
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (valid) apply(custom.trim());
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!valid}
                  onClick={() => apply(custom.trim())}
                >
                  {c.apply}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
