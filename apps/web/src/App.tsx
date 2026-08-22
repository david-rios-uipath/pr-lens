import type { ReportSummary } from "@pr-lens/core";
import { MoonIcon, SunIcon, XIcon } from "@primer/octicons-react";
import {
  ActionList,
  ActionMenu,
  BaseStyles,
  Box,
  Button,
  Flash,
  Heading,
  IconButton,
  Label,
  Spinner,
  Text,
  ThemeProvider,
} from "@primer/react";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { fetchRepos, fetchReport, triggerScan } from "./api";
import { FilterBar } from "./components/FilterBar";
import { PrRow } from "./components/PrRow";
import { afterDismissRefreshError, afterLoadError, afterRefreshError, afterReportLoaded } from "./lib/appState";
import type { LoadState } from "./lib/appState";
import { DEFAULT_VIEW, affinityOf, agoLabel, authorCounts, componentCounts, selectView, unreviewedCount } from "./lib/selectors";
import type { ViewOptions } from "./lib/selectors";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ThemeProvider/BaseStyles don't paint a background; without this the body stays white in dark mode.
function Shell({ colorMode, children }: { colorMode: "dark" | "light"; children: ReactNode }): JSX.Element {
  return (
    <ThemeProvider colorMode={colorMode}>
      <BaseStyles>
        <Box sx={{ bg: "canvas.default", minHeight: "100vh" }}>{children}</Box>
      </BaseStyles>
    </ThemeProvider>
  );
}

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW);
  const [scanning, setScanning] = useState(false);
  const [colorMode, setColorMode] = useState<"dark" | "light">("dark");
  const [repos, setRepos] = useState<ReportSummary[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>(undefined);

  const toggleColorMode = useCallback(() => {
    setColorMode((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = colorMode;
  }, [colorMode]);

  const load = useCallback((repo?: string) => {
    setState({ status: "loading" });
    fetchReport(repo)
      .then((report) => {
        setState(afterReportLoaded(report));
      })
      .catch((err: unknown) => {
        setState(afterLoadError(errorMessage(err)));
      });
  }, []);

  useEffect(() => {
    fetchRepos()
      .then((list) => {
        setRepos(list);
        const newest = list[0]?.repo;
        setSelectedRepo(newest);
        load(newest);
      })
      .catch(() => {
        // repo listing failed — still try the server's default report
        load();
      });
  }, [load]);

  const selectRepo = useCallback(
    (repo: string) => {
      setSelectedRepo(repo);
      setView(DEFAULT_VIEW); // component filters don't carry over between repos
      load(repo);
    },
    [load],
  );

  const handleRefresh = useCallback(() => {
    setScanning(true);
    triggerScan(selectedRepo)
      .then((report) => {
        setState(afterReportLoaded(report));
        // refresh the switcher's timestamps; a listing failure shouldn't flag the scan as failed
        return fetchRepos().then(setRepos).catch(() => undefined);
      })
      .catch((err: unknown) => {
        setState((prev) => afterRefreshError(prev, errorMessage(err)));
      })
      .finally(() => {
        setScanning(false);
      });
  }, [selectedRepo]);

  const dismissRefreshError = useCallback(() => {
    setState(afterDismissRefreshError);
  }, []);

  const colorModeToggle = (
    <IconButton
      aria-label={colorMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      icon={colorMode === "dark" ? SunIcon : MoonIcon}
      variant="invisible"
      onClick={toggleColorMode}
    />
  );

  if (state.status === "loading") {
    return (
      <Shell colorMode={colorMode}>
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <Spinner size="large" srText="Loading report" />
        </Box>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell colorMode={colorMode}>
        <Box sx={{ p: 4 }}>
          <Flash variant="danger">{state.message}</Flash>
        </Box>
      </Shell>
    );
  }

  const { report, refreshError } = state;
  const rows = selectView(report, view);
  const unreviewed = unreviewedCount(report);

  return (
    <Shell colorMode={colorMode}>
      <Box sx={{ maxWidth: "1012px", mx: "auto", p: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {repos.length > 1 ? (
              <ActionMenu>
                <ActionMenu.Button
                  variant="invisible"
                  sx={{ color: "fg.default", fontSize: 3, fontWeight: "bold", px: 2, ml: -2 }}
                >
                  {report.repo}
                </ActionMenu.Button>
                <ActionMenu.Overlay width="medium">
                  <ActionList selectionVariant="single">
                    {repos.map((r) => (
                      <ActionList.Item
                        key={r.repo}
                        selected={r.repo === report.repo}
                        onSelect={() => {
                          selectRepo(r.repo);
                        }}
                      >
                        {r.repo}
                        <ActionList.Description variant="block">
                          generated {agoLabel(r.generatedAt, Date.now())}
                        </ActionList.Description>
                      </ActionList.Item>
                    ))}
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            ) : (
              <Heading as="h1" sx={{ fontSize: 3 }}>
                {report.repo}
              </Heading>
            )}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Text sx={{ color: "fg.muted", fontSize: 0 }}>
                generated {agoLabel(report.generatedAt, Date.now())}
              </Text>
              {unreviewed > 0 && (
                <Label variant="attention">{`${String(unreviewed)} unreviewed`}</Label>
              )}
            </Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            {colorModeToggle}
            <Button onClick={handleRefresh} disabled={scanning}>
              {scanning ? "Refreshing…" : "Refresh"}
            </Button>
          </Box>
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

        <FilterBar
          components={componentCounts(report, view)}
          authors={authorCounts(report, view)}
          value={view}
          onChange={setView}
        />

        <Box sx={{ border: "1px solid", borderColor: "border.default", borderRadius: 2 }}>
          {rows.map((pr) =>
            view.sort === "affinity" && view.components.length > 0 ? (
              <PrRow key={pr.number} pr={pr} affinity={affinityOf(pr, view.components)} />
            ) : (
              <PrRow key={pr.number} pr={pr} />
            ),
          )}
        </Box>
      </Box>
    </Shell>
  );
}
