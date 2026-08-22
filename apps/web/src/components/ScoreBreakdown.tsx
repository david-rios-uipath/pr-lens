import { Box, Details, Text } from "@primer/react";
import type { ReportPr } from "@pr-lens/core";
import type { JSX } from "react";

function pct(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

export function ScoreBreakdown({ pr }: { pr: ReportPr }): JSX.Element {
  const breakdown = pr.scores.reviewability?.breakdown ?? [];

  return (
    <Details sx={{ fontSize: 0 }}>
      <Text as="summary" sx={{ color: "fg.muted", cursor: "pointer", fontSize: 0 }}>
        why?
      </Text>
      <Box
        as="table"
        sx={{ mt: 2, width: "100%", borderCollapse: "collapse", fontSize: 0 }}
      >
        <thead>
          <tr>
            <Box as="th" sx={{ textAlign: "left", color: "fg.muted", pr: 2, pb: 1 }}>
              Factor
            </Box>
            <Box as="th" sx={{ textAlign: "left", color: "fg.muted", pr: 2, pb: 1 }}>
              Weight
            </Box>
            <Box as="th" sx={{ textAlign: "left", color: "fg.muted", pr: 2, pb: 1 }}>
              Value
            </Box>
            <Box as="th" sx={{ textAlign: "left", color: "fg.muted", pb: 1 }}>
              Reason
            </Box>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((entry) => (
            <Box as="tr" key={entry.factor} sx={{ color: entry.weight === 0 ? "fg.muted" : "fg.default" }}>
              <Box as="td" sx={{ pr: 2, py: 1 }}>
                {entry.factor}
              </Box>
              <Box as="td" sx={{ pr: 2, py: 1 }}>
                {entry.weight}
              </Box>
              <Box as="td" sx={{ pr: 2, py: 1 }}>
                {pct(entry.value)}
              </Box>
              <Box as="td" sx={{ py: 1 }}>
                {entry.reason}
              </Box>
            </Box>
          ))}
        </tbody>
      </Box>
    </Details>
  );
}
