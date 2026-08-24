import { CheckIcon, DotFillIcon, XIcon } from "@primer/octicons-react";
import { Label, Link, Text } from "@primer/react";
import type { ReportPr } from "@pr-lens/core";
import { useState } from "react";
import { clsx } from "clsx";
import type { JSX } from "react";
import { agoLabel, reviewLabel, scoreOf } from "../lib/selectors";
import { HintTooltip } from "./HintTooltip";
import styles from "./PrRow.module.css";
import { ScoreBreakdown } from "./ScoreBreakdown";

function scoreVariant(score: number): "success" | "attention" | "danger" {
  if (score >= 70) return "success";
  if (score >= 40) return "attention";
  return "danger";
}

function CiIcon({ ci }: { ci: ReportPr["ci"] }): JSX.Element {
  if (ci === "SUCCESS") return <CheckIcon fill="var(--fgColor-success)" />;
  if (ci === "FAILURE") return <XIcon fill="var(--fgColor-danger)" />;
  return <DotFillIcon fill="var(--fgColor-muted)" />;
}

export function PrRow({ pr, affinity }: { pr: ReportPr; affinity?: number }): JSX.Element {
  const score = scoreOf(pr);
  const review = reviewLabel(pr);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const breakdownId = `breakdown-${String(pr.number)}`;

  return (
    <div className={clsx(styles.row)}>
      <div className={clsx(styles.scoreCell)}>
        <HintTooltip title="Reviewability score" hint="click to learn more">
          <button
            type="button"
            onClick={() => {
              setBreakdownOpen((prev) => !prev);
            }}
            aria-expanded={breakdownOpen}
            aria-controls={breakdownId}
            aria-label={`Reviewability score ${String(score)} — click to learn more`}
            className={clsx(styles.scoreButton)}
          >
            <Label variant={scoreVariant(score)}>{score}</Label>
          </button>
        </HintTooltip>
        {affinity !== undefined && (
          <Text className={clsx(styles.affinity)}>aff {Math.round(affinity * 100)}</Text>
        )}
      </div>

      <div className={clsx(styles.main)}>
        <Text as="span" className={clsx(styles.title)}>
          <Link href={pr.url} target="_blank" rel="noreferrer">
            {pr.title}
          </Link>
          {/* nbsp keeps the icon glued to the last word when the title wraps */}
          &nbsp;
          <CiIcon ci={pr.ci} />
        </Text>
        <Text className={clsx(styles.subtitle)}>
          #{pr.number} by {pr.author} · {agoLabel(pr.updatedAt, Date.now())} ·{" "}
          {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </Text>
        <ScoreBreakdown pr={pr} open={breakdownOpen} id={breakdownId} />
      </div>

      <Text className={clsx(styles.diff)}>
        <Text className={clsx(styles.additions)}>+{pr.additions}</Text>{" "}
        <Text className={clsx(styles.deletions)}>-{pr.deletions}</Text>
      </Text>
      {review !== null && <Label variant={review.variant}>{review.text}</Label>}

      <div className={clsx(styles.components)}>
        <Label className={clsx(styles.componentLabel)}>{pr.componentPrimary}</Label>
        {pr.componentsSecondary.map((component) => (
          <Label key={component} variant="secondary" className={clsx(styles.componentLabel)}>
            {component}
          </Label>
        ))}
      </div>
    </div>
  );
}
