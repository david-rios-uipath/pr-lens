import type { ReportPr } from "@pr-lens/core";
import { clsx } from "clsx";
import type { JSX } from "react";
import styles from "./ScoreBreakdown.module.css";

function pct(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

interface ScoreBreakdownProps {
  pr: ReportPr;
  /** Toggled by the score label in PrRow. */
  open: boolean;
  /** Target of the score label's aria-controls. */
  id: string;
}

export function ScoreBreakdown({ pr, open, id }: ScoreBreakdownProps): JSX.Element | null {
  const breakdown = pr.scores.reviewability?.breakdown ?? [];

  if (!open) return null;

  return (
    <table id={id} className={clsx(styles.table)}>
      <thead>
        <tr>
          <th className={clsx(styles.head)}>Factor</th>
          <th className={clsx(styles.head)}>Weight</th>
          <th className={clsx(styles.head)}>Value</th>
          <th className={clsx(styles.headLast)}>Reason</th>
        </tr>
      </thead>
      <tbody>
        {breakdown.map((entry) => (
          <tr key={entry.factor} className={clsx(entry.weight === 0 ? styles.rowUnweighted : undefined)}>
            <td className={clsx(styles.cell)}>{entry.factor}</td>
            <td className={clsx(styles.cell)}>{entry.weight}</td>
            <td className={clsx(styles.cell)}>{pct(entry.value)}</td>
            <td className={clsx(styles.cellLast)}>{entry.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
