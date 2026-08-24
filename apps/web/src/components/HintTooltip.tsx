import { Text } from "@primer/react";
import { clsx } from "clsx";
import type { JSX, ReactNode } from "react";
import styles from "./HintTooltip.module.css";

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
    <span className={clsx(styles.wrapper)}>
      {children}
      <span aria-hidden className={clsx(styles.tooltip)}>
        <Text className={clsx(styles.title)}>{title}</Text>
        <Text className={clsx(styles.hint)}>{hint}</Text>
      </span>
    </span>
  );
}
