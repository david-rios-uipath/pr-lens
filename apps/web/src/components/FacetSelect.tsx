import { TriangleDownIcon } from "@primer/octicons-react";
import { Button, SelectPanel } from "@primer/react";
import type { SelectPanelProps } from "@primer/react";
import { clsx } from "clsx";
import type { ElementType, JSX } from "react";
import { useState } from "react";
import styles from "./FacetSelect.module.css";

type PanelItem = SelectPanelProps["items"][number];

export interface FacetOption {
  /** Stored in ViewOptions and shown as the item label; also what the filter input matches. */
  value: string;
  count: number;
  leadingVisual?: ElementType;
}

interface FacetSelectProps {
  title: string;
  /** Anchor text when nothing is selected, e.g. "All authors". */
  emptyLabel: string;
  /** Pluralised in the anchor for 2+ selections, e.g. "authors" -> "3 authors". */
  pluralNoun: string;
  placeholderText: string;
  options: FacetOption[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
}

/**
 * Searchable multi-select over one facet of the PR list (components, authors).
 * Owns only its open/filter-text state — the selection itself is controlled,
 * so it stays a pure function of ViewOptions.
 */
export function FacetSelect({
  title,
  emptyLabel,
  pluralNoun,
  placeholderText,
  options,
  selected,
  onSelectedChange,
}: FacetSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const items: PanelItem[] = options.map((option) => ({
    id: option.value,
    text: option.value,
    trailingVisual: String(option.count),
    ...(option.leadingVisual === undefined ? {} : { leadingVisual: option.leadingVisual }),
  }));
  const visibleItems = items.filter((item) => (item.text ?? "").toLowerCase().includes(filter.trim().toLowerCase()));
  const selectedItems = items.filter((item) => selected.includes(item.text ?? ""));

  const [firstSelected] = selected;
  const label =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? (firstSelected ?? emptyLabel)
        : `${String(selected.length)} ${pluralNoun}`;

  return (
    <SelectPanel
      title={title}
      renderAnchor={({ children, ...anchorProps }) => (
        <Button {...anchorProps} trailingAction={TriangleDownIcon}>
          {label || children}
        </Button>
      )}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setFilter("");
      }}
      items={visibleItems}
      selected={selectedItems}
      onSelectedChange={(next: PanelItem[]) => {
        onSelectedChange(next.map((item) => item.text ?? "").filter((text) => text !== ""));
      }}
      filterValue={filter}
      onFilterChange={setFilter}
      placeholderText={placeholderText}
      // No footer at all when there's nothing to clear. exactOptionalPropertyTypes
      // rejects an explicit undefined here, so the prop has to be omitted instead.
      {...(selected.length === 0
        ? {}
        : {
            footer: (
              <Button
                size="small"
                variant="invisible"
                onClick={() => {
                  onSelectedChange([]);
                }}
                className={clsx(styles.clearButton)}
              >
                {`Clear selected ${pluralNoun}`}
              </Button>
            ),
          })}
      overlayProps={{ width: "small", height: "medium" }}
    />
  );
}
