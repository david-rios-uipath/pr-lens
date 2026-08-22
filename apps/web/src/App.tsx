import { XIcon } from "@primer/octicons-react";
import { Box, Button, Flash, Heading, IconButton, Spinner, Text } from "@primer/react";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { fetchReport, triggerScan } from "./api.js";
import { PrRow } from "./components/PrRow.js";
import { afterDismissRefreshError, afterLoadError, afterRefreshError, afterReportLoaded } from "./lib/appState.js";
import type { LoadState } from "./lib/appState.js";
import { agoLabel, selectView } from "./lib/selectors.js";
import type { ViewOptions } from "./lib/selectors.js";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Filter/sort controls land in Task 12; the setter will be wired up there.
  const [view] = useState<ViewOptions>({ component: null, query: "", sort: "reviewability" });
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetchReport()
      .then((report) => {
        setState(afterReportLoaded(report));
      })
      .catch((err: unknown) => {
        setState(afterLoadError(errorMessage(err)));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setScanning(true);
    triggerScan()
      .then((report) => {
        setState(afterReportLoaded(report));
      })
      .catch((err: unknown) => {
        setState((prev) => afterRefreshError(prev, errorMessage(err)));
      })
      .finally(() => {
        setScanning(false);
      });
  }, []);

  const dismissRefreshError = useCallback(() => {
    setState(afterDismissRefreshError);
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

  const { report, refreshError } = state;
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

      {refreshError !== null && (
        <Flash variant="danger" sx={{ mb: 3, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Text>Refresh failed: {refreshError}</Text>
          <IconButton
            aria-label="Dismiss refresh error"
            icon={XIcon}
            variant="invisible"
            size="small"
            onClick={dismissRefreshError}
          />
        </Flash>
      )}

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
