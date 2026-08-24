import type { ReportSummary } from "@pr-lens/core";
import { MoonIcon, SunIcon, XIcon } from "@primer/octicons-react";
import {
  ActionList,
  ActionMenu,
  BaseStyles,
  Button,
  Flash,
  Heading,
  IconButton,
  Label,
  Spinner,
  Stack,
  Text,
} from "@primer/react";
// next/ThemeProvider is the CSS-variable-only one; the root export still ships
// JS theme values we no longer use.
import { ThemeProvider } from "@primer/react/next";
import { clsx } from "clsx";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { fetchRepos, fetchReport, triggerScan } from "./api";
import styles from "./App.module.css";
import { FilterBar } from "./components/FilterBar";
import { PrRow } from "./components/PrRow";
import { ScanProgressIndicator } from "./components/ScanProgressIndicator";
import { afterDismissRefreshError, afterLoadError, afterRefreshError, afterReportLoaded } from "./lib/appState";
import type { LoadState } from "./lib/appState";
import { applyScanEvent, initialScanProgress } from "./lib/scanProgress";
import type { ScanProgress } from "./lib/scanProgress";
import { DEFAULT_VIEW, affinityOf, agoLabel, authorCounts, componentCounts, selectView, unreviewedCount } from "./lib/selectors";
import type { ViewOptions } from "./lib/selectors";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function Shell({ colorMode, children }: { colorMode: "dark" | "light"; children: ReactNode }): JSX.Element {
  return (
    <ThemeProvider colorMode={colorMode}>
      <BaseStyles>
        <div className={clsx(styles.shell)}>{children}</div>
      </BaseStyles>
    </ThemeProvider>
  );
}

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
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
    setScanProgress(initialScanProgress());
    triggerScan(selectedRepo, (event) => {
      setScanProgress((prev) => (prev === null ? prev : applyScanEvent(prev, event)));
    })
      .then((report) => {
        setState(afterReportLoaded(report));
        // refresh the switcher's timestamps; a listing failure shouldn't flag the scan as failed
        return fetchRepos().then(setRepos).catch(() => undefined);
      })
      .catch((err: unknown) => {
        setState((prev) => afterRefreshError(prev, errorMessage(err)));
      })
      .finally(() => {
        setScanProgress(null);
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
        <div className={clsx(styles.centered)}>
          <Spinner size="large" srText="Loading report" />
        </div>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell colorMode={colorMode}>
        <div className={clsx(styles.errorPad)}>
          <Flash variant="danger">{state.message}</Flash>
        </div>
      </Shell>
    );
  }

  const { report, refreshError } = state;
  const rows = selectView(report, view);
  const unreviewed = unreviewedCount(report);

  return (
    <Shell colorMode={colorMode}>
      <div className={clsx(styles.page)}>
        <Stack
          direction="horizontal"
          align="center"
          justify="space-between"
          gap="normal"
          className={clsx(styles.header)}
        >
          <Stack direction="vertical" gap="condensed">
            {repos.length > 1 ? (
              <ActionMenu>
                <ActionMenu.Button variant="invisible" className={clsx(styles.repoButton)}>
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
              <Heading as="h1" className={clsx(styles.heading)}>
                {report.repo}
              </Heading>
            )}
            <Stack direction="horizontal" align="center" gap="condensed">
              <Text className={clsx(styles.meta)}>generated {agoLabel(report.generatedAt, Date.now())}</Text>
              {unreviewed > 0 && (
                <Label variant="attention">{`${String(unreviewed)} unreviewed`}</Label>
              )}
            </Stack>
          </Stack>
          <Stack direction="horizontal" align="center" gap="condensed">
            {colorModeToggle}
            <Button onClick={handleRefresh} disabled={scanProgress !== null}>
              {scanProgress !== null ? "Refreshing…" : "Refresh"}
            </Button>
          </Stack>
        </Stack>

        {scanProgress !== null && <ScanProgressIndicator progress={scanProgress} />}

        {refreshError !== null && (
          <Flash variant="danger" className={clsx(styles.refreshError)}>
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

        <div className={clsx(styles.list)}>
          {rows.map((pr) =>
            view.sort === "affinity" && view.components.length > 0 ? (
              <PrRow key={pr.number} pr={pr} affinity={affinityOf(pr, view.components)} />
            ) : (
              <PrRow key={pr.number} pr={pr} />
            ),
          )}
        </div>
      </div>
    </Shell>
  );
}
