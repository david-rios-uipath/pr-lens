import { CheckIcon } from "@primer/octicons-react";
import { Box, Spinner, Text } from "@primer/react";
import type { JSX } from "react";
import type { ScanProgress } from "../lib/scanProgress";
import { formatElapsed } from "../lib/scanProgress";

export function ScanProgressIndicator({ progress }: { progress: ScanProgress }): JSX.Element {
  return (
    <Box
      aria-live="polite"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 3,
        mb: 3,
        px: 3,
        py: 2,
        border: "1px solid",
        borderColor: "border.default",
        borderRadius: 2,
        bg: "canvas.subtle",
      }}
    >
      {progress.map((stage) => (
        <Box key={stage.stage} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {stage.state === "done" && (
            <Box sx={{ color: "success.fg", display: "flex" }}>
              <CheckIcon size={12} />
            </Box>
          )}
          {stage.state === "active" && <Spinner size="small" />}
          <Text sx={{ fontSize: 0, color: stage.state === "pending" ? "fg.muted" : "fg.default" }}>
            {stage.label}
            {stage.state === "done" && stage.elapsedMs !== undefined && ` (${formatElapsed(stage.elapsedMs)})`}
            {stage.state === "active" && stage.detail !== undefined && ` — ${stage.detail}`}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
