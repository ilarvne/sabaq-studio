"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentPropsWithoutRef<"textarea"> &
  React.RefAttributes<HTMLTextAreaElement> & {
    size?: "sm" | "default" | "lg" | number;
    unstyled?: boolean;
  };

export function Textarea({
  className,
  size = "default",
  unstyled = false,
  ref,
  ...props
}: TextareaProps): React.ReactElement {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-grid w-full rounded-lg border border-input bg-card text-sm transition-colors duration-150 motion-reduce:transition-none has-focus-visible:border-ring has-focus-visible:ring-2 has-focus-visible:ring-ring/30 has-aria-invalid:border-destructive has-focus-visible:has-aria-invalid:ring-destructive/24 has-disabled:opacity-55",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        ref={ref}
        value={props.value}
        defaultValue={props.defaultValue}
        disabled={props.disabled}
        id={props.id}
        name={props.name}
        render={(defaultProps: React.ComponentProps<"textarea">) => (
          <textarea
            className={cn(
              "field-sizing-content min-h-17.5 w-full rounded-[inherit] px-[11px] py-2 text-foreground outline-none placeholder:text-muted-foreground max-sm:min-h-20.5",
              size === "sm" &&
                "min-h-14 max-sm:min-h-16",
              size === "lg" && "min-h-20 py-3 max-sm:min-h-22",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { FieldPrimitive };
