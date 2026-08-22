import { Box, Button, Flash, Heading, Spinner, Text } from "@primer/react";
import type { Report } from "@pr-lens/core";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { fetchReport, triggerScan } from "./api.js";
import { PrRow } from "./components/PrRow.js";
import { agoLabel, selectView } from "./lib/selectors.js";
import type { ViewOptions } from "./lib/selectors.js";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; report: Report };

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Filter/sort controls land in Task 12; the setter will be wired up there.
  const [view] = useState<ViewOptions>({ component: null, query: "", sort: "reviewability" });
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetchReport()
      .then((report) => {
        setState({ status: "loaded", report });
      })
      .catch((err: unknown) => {
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setScanning(true);
    triggerScan()
      .then((report) => {
        setState({ status: "loaded", report });
      })
      .catch((err: unknown) => {
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        setScanning(false);
      });
  }, []);

  if (state.status === "loading") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <Spinner size="large" srText="Loading report" />
      </Box>
    );
  }

  if (state.status === "error") {
    return (
      <Box sx={{ p: 4 }}>
        <Flash variant="danger">{state.message}</Flash>
      </Box>
    );
  }

  const { report } = state;
  const rows = selectView(report, view);

  return (
    <Box sx={{ maxWidth: "1012px", mx: "auto", p: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Heading as="h1" sx={{ fontSize: 3 }}>
            {report.repo}
          </Heading>
          <Text sx={{ color: "fg.muted", fontSize: 0 }}>
            generated {agoLabel(report.generatedAt, Date.now())}
          </Text>
        </Box>
        <Button onClick={handleRefresh} disabled={scanning}>
          {scanning ? "Refreshing…" : "Refresh"}
        </Button>
      </Box>

      <Box sx={{ border: "1px solid", borderColor: "border.default", borderRadius: 2 }}>
        {rows.map((pr, index) => (
          <Box key={pr.number} sx={{ display: "flex", alignItems: "stretch" }}>
            <Text sx={{ color: "fg.muted", fontSize: 0, width: "32px", textAlign: "right", pt: 2 }}>
              {index + 1}
            </Text>
            <Box sx={{ flex: 1 }}>
              <PrRow pr={pr} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
