import { CheckIcon, DotFillIcon, XIcon } from "@primer/octicons-react";
import { Box, Label, Link, Text } from "@primer/react";
import type { ReportPr } from "@pr-lens/core";
import type { JSX } from "react";
import { agoLabel, scoreOf, sizeBucket, topReasons } from "../lib/selectors.js";

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

export function PrRow({ pr }: { pr: ReportPr }): JSX.Element {
  const score = scoreOf(pr);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        py: 2,
        px: 3,
        borderBottom: "1px solid",
        borderColor: "border.default",
      }}
    >
      <Label variant={scoreVariant(score)}>{score}</Label>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Link href={pr.url} target="_blank" rel="noreferrer">
            {pr.title}
          </Link>
          <CiIcon ci={pr.ci} />
        </Box>
        <Text sx={{ fontSize: 0, color: "fg.muted", display: "block" }}>
          #{pr.number} by {pr.author} · {agoLabel(pr.updatedAt, Date.now())}
        </Text>
        <Text sx={{ fontSize: 0, color: "fg.muted", display: "block" }}>
          {topReasons(pr, 3).join(" · ")}
        </Text>
      </Box>

      <Text sx={{ fontSize: 0, whiteSpace: "nowrap" }}>
        <Text sx={{ color: "success.fg" }}>+{pr.additions}</Text>{" "}
        <Text sx={{ color: "danger.fg" }}>-{pr.deletions}</Text>
      </Text>
      <Label variant="secondary">{sizeBucket(pr)}</Label>

      <Box sx={{ display: "flex", gap: 1 }}>
        <Label>{pr.componentPrimary}</Label>
        {pr.componentsSecondary.map((component) => (
          <Label key={component} variant="secondary">
            {component}
          </Label>
        ))}
      </Box>
    </Box>
  );
}
