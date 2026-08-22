import { CheckIcon, DotFillIcon, XIcon } from "@primer/octicons-react";
import { Box, Label, Link, Text } from "@primer/react";
import type { ReportPr } from "@pr-lens/core";
import { useState } from "react";
import type { JSX } from "react";
import { agoLabel, reviewLabel, scoreOf } from "../lib/selectors";
import { ScoreBreakdown } from "./ScoreBreakdown";

function scoreVariant(score: number): "success" | "attention" | "danger" {
  if (score >= 70) return "success";
  if (score >= 40) return "attention";
  return "danger";
}

function CiIcon({ ci }: { ci: ReportPr["ci"] }): JSX.Element {
  if (ci === "SUCCESS") return <CheckIcon fill="var(--fgColor-success, #3fb950)" />;
  if (ci === "FAILURE") return <XIcon fill="var(--fgColor-danger, #f85149)" />;
  return <DotFillIcon fill="var(--fgColor-muted, #848d97)" />;
}

export function PrRow({ pr, affinity }: { pr: ReportPr; affinity?: number }): JSX.Element {
  const score = scoreOf(pr);
  const review = reviewLabel(pr);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const breakdownId = `breakdown-${String(pr.number)}`;

  return (
    <Box
      sx={{
        display: "flex",
        // top-anchored: a wrapping title grows downward without dragging the
        // score, diff and component tags down with it
        alignItems: "flex-start",
        gap: 3,
        pt: "12px",
        pb: 2,
        px: 3,
        borderBottom: "1px solid",
        borderColor: "border.default",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          as="button"
          type="button"
          onClick={() => {
            setBreakdownOpen((prev) => !prev);
          }}
          aria-expanded={breakdownOpen}
          aria-controls={breakdownId}
          aria-label={`Score ${String(score)} — why?`}
          sx={{ background: "none", border: 0, p: 0, cursor: "pointer" }}
        >
          <Label variant={scoreVariant(score)}>{score}</Label>
        </Box>
        {affinity !== undefined && (
          <Text sx={{ fontSize: 0, color: "fg.muted", whiteSpace: "nowrap" }}>
            aff {Math.round(affinity * 100)}
          </Text>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* -4px trims the title's line-box leading so it sits level with the score pill */}
        <Text as="span" sx={{ display: "block", mt: "-4px" }}>
          <Link href={pr.url} target="_blank" rel="noreferrer">
            {pr.title}
          </Link>
          {/* nbsp keeps the icon glued to the last word when the title wraps */}
          &nbsp;
          <CiIcon ci={pr.ci} />
        </Text>
        <Text sx={{ fontSize: 0, color: "fg.muted", display: "block" }}>
          #{pr.number} by {pr.author} · {agoLabel(pr.updatedAt, Date.now())} ·{" "}
          {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </Text>
        <ScoreBreakdown pr={pr} open={breakdownOpen} id={breakdownId} />
      </Box>

      <Text sx={{ fontSize: 0, whiteSpace: "nowrap" }}>
        <Text sx={{ color: "success.fg" }}>+{pr.additions}</Text>{" "}
        <Text sx={{ color: "danger.fg" }}>-{pr.deletions}</Text>
      </Text>
      {review !== null && <Label variant={review.variant}>{review.text}</Label>}

      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
        <Label sx={{ width: "min-content"}}>{pr.componentPrimary}</Label>
        {pr.componentsSecondary.map((component) => (
          <Label key={component} variant="secondary" sx={{ width: "min-content"}}>
            {component}
          </Label>
        ))}
      </Box>
    </Box>
  );
}
