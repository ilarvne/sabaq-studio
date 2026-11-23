"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/coss/spinner";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-sm font-medium outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 data-loading:select-none data-loading:text-transparent [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        default: "h-9 px-3",
        icon: "size-9",
        "icon-lg": "size-10",
        "icon-sm": "size-8 sm:size-7",
        "icon-xl": "size-11 [&_svg:not([class*='size-'])]:size-5",
        "icon-xs": "size-7 rounded-md sm:size-6 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-3.5",
        sm: "h-8 gap-1.5 px-2.5",
        xl: "h-11 px-4 text-base [&_svg:not([class*='size-'])]:size-5",
        xs: "h-7 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85 data-pressed:bg-primary/85 *:data-[slot=button-loading-indicator]:text-primary-foreground",
        destructive:
          "border-transparent bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/85 data-pressed:bg-destructive/85 *:data-[slot=button-loading-indicator]:text-white",
        "destructive-outline":
          "border-input bg-card text-destructive-foreground hover:border-destructive/45 hover:bg-destructive/6 data-pressed:bg-destructive/10 *:data-[slot=button-loading-indicator]:text-destructive-foreground",
        ghost:
          "border-transparent text-foreground hover:bg-accent data-pressed:bg-accent *:data-[slot=button-loading-indicator]:text-foreground",
        link:
          "border-transparent text-foreground underline-offset-4 hover:underline data-pressed:underline *:data-[slot=button-loading-indicator]:text-foreground",
        outline:
          "border-input bg-card text-foreground hover:bg-accent active:bg-muted data-pressed:bg-muted *:data-[slot=button-loading-indicator]:text-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent data-pressed:bg-accent *:data-[slot=button-loading-indicator]:text-secondary-foreground",
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
