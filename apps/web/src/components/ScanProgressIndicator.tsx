import { CheckIcon } from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import { clsx } from "clsx";
import type { JSX } from "react";
import type { ScanProgress } from "../lib/scanProgress";
import { formatElapsed } from "../lib/scanProgress";
import styles from "./ScanProgressIndicator.module.css";

export function ScanProgressIndicator({ progress }: { progress: ScanProgress }): JSX.Element {
  return (
    <div aria-live="polite" className={clsx(styles.bar)}>
      {progress.map((stage) => (
        <div key={stage.stage} className={clsx(styles.stage)}>
          {stage.state === "done" && (
            <span className={clsx(styles.doneIcon)}>
              <CheckIcon size={12} />
            </span>
          )}
          {stage.state === "active" && <Spinner size="small" />}
          <Text className={clsx(stage.state === "pending" ? styles.labelPending : styles.label)}>
            {stage.label}
            {stage.state === "done" && stage.elapsedMs !== undefined && ` (${formatElapsed(stage.elapsedMs)})`}
            {stage.state === "active" && stage.detail !== undefined && ` — ${stage.detail}`}
          </Text>
        </div>
      ))}
    </div>
  );
}
