"use client";

import { type ComponentProps, Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";
import { take } from "../utils/range";

export interface Segment {
  text: string;
  mono?: boolean;
}

export function StreamingText({
  segments,
  count,
  streaming,
  className,
  ...props
}: Omit<
  ComponentProps<"p">,
  "children" | "segments" | "count" | "streaming"
> & {
  segments: Segment[];
  count: number;
  streaming: boolean;
}) {
  const words = useMemo(
    () =>
      segments.flatMap((segment) =>
        segment.text
          .split(" ")
          .map((word) => ({ word, mono: segment.mono ?? false })),
      ),
    [segments],
  );
  const shown = take(words, count);

  return (
    <p
      data-slot="streaming-text"
      className={cn(
        "min-h-[8.5rem] max-w-sm text-sm leading-relaxed text-pretty",
        className,
      )}

      {...props}
    >
      {shown.map(({ word, mono: isMono }, index) => (
        <Fragment key={index}>
          {index > 0 && " "}
          {isMono ? <code className="bg-foreground/[0.06] rounded-md px-1.5 py-0.5 font-mono text-[0.85em]">{word}</code> : word}
        </Fragment>
      ))}
      {streaming && shown.length > 0 && (
        <span
          aria-hidden
          className="-mb-0.5 ml-0.5 inline-block h-3 w-0.5 rounded-full bg-primary"
        />
      )}
    </p>
  );
}
