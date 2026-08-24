import { Box, Text } from "@primer/react";
import type { JSX, ReactNode } from "react";

interface HintTooltipProps {
  /** Emphasized first line. */
  title: string;
  /** Smaller second line under the title, e.g. the affordance. */
  hint: string;
  children: ReactNode;
}

/**
 * Two-line hover/focus tooltip. Primer's own Tooltip takes a plain `text`
 * string, so it can't render the title + hint pair.
 *
 * Purely decorative — aria-hidden, so the trigger must carry its own
 * aria-label covering both lines.
 */
export function HintTooltip({ title, hint, children }: HintTooltipProps): JSX.Element {
  return (
    <Box
      sx={{
        position: "relative",
        display: "inline-flex",
        "&:hover > [data-hint-tooltip], &:focus-within > [data-hint-tooltip]": {
          visibility: "visible",
          opacity: 1,
        },
      }}
    >
      {children}
      <Box
        data-hint-tooltip=""
        aria-hidden
        sx={{
          position: "absolute",
          top: "100%",
          left: 0,
          mt: 1,
          zIndex: 1,
          px: 2,
          py: 1,
          borderRadius: 2,
          bg: "neutral.emphasisPlus",
          boxShadow: "shadow.medium",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          visibility: "hidden",
          opacity: 0,
          transition: "opacity 80ms ease-in",
        }}
      >
        {/*
          Both lines stay at full fg.onEmphasis. In dark mode the emphasis
          surface is #6e7681, where white is only 4.5:1 — dimming the hint
          (opacity, or an fg.muted grey) drops it under AA, so the subheading
          is set apart by size and weight instead.
        */}
        <Text sx={{ display: "block", fontSize: 0, fontWeight: "bold", color: "fg.onEmphasis" }}>{title}</Text>
        <Text sx={{ display: "block", fontSize: "11px", fontWeight: "normal", color: "fg.onEmphasis" }}>{hint}</Text>
      </Box>
    </Box>
  );
}
