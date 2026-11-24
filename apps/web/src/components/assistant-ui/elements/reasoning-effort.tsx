"use client";

import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import { cn } from '@/lib/utils';
import { field } from './surfaces';

type EffortLevel = { key: string; label: string };

// Selection-only adaptation of the assistant-ui Reasoning Effort element.
export function ReasoningEffort({ label, levels, selectedKey, disabled, onSelect }: {
  label: string;
  levels: readonly EffortLevel[];
  selectedKey?: string;
  disabled?: boolean;
  onSelect: (key: string) => void;
}) {
  return <div data-slot="reasoning-effort" className="grid gap-1.5">
    <span className="text-xs font-medium">{label}</span>
    <ToggleGroup aria-label={label} className={cn(field, 'w-full p-0.5')} size="sm" spacing={1}
      disabled={disabled} value={selectedKey ? [selectedKey] : []}
      onValueChange={values => { if (values[0]) onSelect(values[0]); }}>
      {levels.map(level => <ToggleGroupItem className="min-w-0 flex-1 rounded-md aria-pressed:bg-popover aria-pressed:shadow-xs aria-pressed:inset-ring aria-pressed:inset-ring-border" key={level.key} value={level.key}>
        {level.label}
      </ToggleGroupItem>)}
    </ToggleGroup>
  </div>;
}
