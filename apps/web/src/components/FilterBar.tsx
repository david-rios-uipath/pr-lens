import { FilterIcon, SearchIcon, SortAscIcon, SortDescIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, Avatar, IconButton, Stack, TextInput } from "@primer/react";
import { clsx } from "clsx";
import type { JSX } from "react";
import { normalizeView } from "../lib/selectors";
import type { SortKey, ViewOptions } from "../lib/selectors";
import styles from "./FilterBar.module.css";
import { FacetSelect } from "./FacetSelect";
import type { FacetOption } from "./FacetSelect";

const SORT_LABELS: Record<SortKey, string> = {
  reviewability: "Reviewability",
  updated: "Last updated",
  size: "Size",
  affinity: "Component affinity",
};

/** GitHub redirects `/<login>.png` to the user's avatar — no API call, no user id needed. */
function avatarUrl(login: string): string {
  return `https://github.com/${login}.png?size=40`;
}

interface FilterBarProps {
  components: { name: string; prCount: number }[];
  authors: { login: string; prCount: number }[];
  value: ViewOptions;
  onChange: (next: ViewOptions) => void;
}

export function FilterBar({ components, authors, value, onChange }: FilterBarProps): JSX.Element {
  const emit = (next: ViewOptions): void => {
    onChange(normalizeView(next));
  };

  const componentOptions: FacetOption[] = components.map((c) => ({ value: c.name, count: c.prCount }));
  const authorOptions: FacetOption[] = authors.map((a) => ({
    value: a.login,
    count: a.prCount,
    // alt="" — the login sits right beside it, so the avatar is decorative.
    leadingVisual: () => <Avatar src={avatarUrl(a.login)} alt="" size={16} />,
  }));

  const sortOptions: SortKey[] = ["reviewability", "updated", "size"];
  if (value.components.length > 0) {
    sortOptions.push("affinity");
  }

  const toggles = [
    { key: "hideApproved", label: "Hide approved" },
    { key: "hideDrafts", label: "Hide drafts" },
  ] as const;
  const activeToggles = toggles.filter((t) => value[t.key]).length;

  return (
    <Stack direction="horizontal" align="center" justify="space-between" gap="normal" className={clsx(styles.bar)}>
      <Stack direction="horizontal" align="center" gap="condensed" className={clsx(styles.facets)}>
        <FacetSelect
          title="Filter by component"
          emptyLabel="All components"
          pluralNoun="components"
          placeholderText="Filter components"
          options={componentOptions}
          selected={value.components}
          onSelectedChange={(components) => {
            emit({ ...value, components });
          }}
        />
        <FacetSelect
          title="Filter by author"
          emptyLabel="All authors"
          pluralNoun="authors"
          placeholderText="Filter authors"
          options={authorOptions}
          selected={value.authors}
          onSelectedChange={(authors) => {
            emit({ ...value, authors });
          }}
        />
      </Stack>

      <Stack direction="horizontal" align="center" gap="condensed" className={clsx(styles.controls)}>
        <ActionMenu>
          <ActionMenu.Anchor>
            <IconButton
              icon={FilterIcon}
              aria-label={`Filters${activeToggles > 0 ? ` (${String(activeToggles)} active)` : ""}`}
              className={clsx(activeToggles > 0 ? styles.filterButtonActive : styles.filterButton)}
            />
          </ActionMenu.Anchor>
          <ActionMenu.Overlay>
            {/* selectionVariant="multiple" renders checkboxes and keeps the menu open on select */}
            <ActionList selectionVariant="multiple">
              {toggles.map((toggle) => (
                <ActionList.Item
                  key={toggle.key}
                  selected={value[toggle.key]}
                  onSelect={(e) => {
                    e.preventDefault();
                    emit({ ...value, [toggle.key]: !value[toggle.key] });
                  }}
                >
                  <span className={clsx(styles.toggleLabel)}>{toggle.label}</span>
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Search title…"
          aria-label="Search title"
          value={value.query}
          onChange={(e) => {
            emit({ ...value, query: e.target.value });
          }}
        />
        <ActionMenu>
          <ActionMenu.Button>{SORT_LABELS[value.sort]}</ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList selectionVariant="single">
              {sortOptions.map((sort) => (
                <ActionList.Item
                  key={sort}
                  selected={value.sort === sort}
                  onSelect={() => {
                    emit({ ...value, sort });
                  }}
                >
                  {SORT_LABELS[sort]}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
        <IconButton
          icon={value.sortDir === "desc" ? SortDescIcon : SortAscIcon}
          aria-label={value.sortDir === "desc" ? "Highest first" : "Lowest first"}
          onClick={() => {
            emit({ ...value, sortDir: value.sortDir === "desc" ? "asc" : "desc" });
          }}
        />
      </Stack>
    </Stack>
  );
}
