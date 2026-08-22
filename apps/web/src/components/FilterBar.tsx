import { SearchIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, Box, TextInput, UnderlineNav } from "@primer/react";
import type { JSX } from "react";
import { normalizeView } from "../lib/selectors.js";
import type { SortKey, ViewOptions } from "../lib/selectors.js";

const SORT_LABELS: Record<SortKey, string> = {
  reviewability: "Reviewability",
  newest: "Newest",
  smallest: "Smallest",
  affinity: "Component affinity",
};

interface FilterBarProps {
  components: { name: string; prCount: number }[];
  value: ViewOptions;
  onChange: (next: ViewOptions) => void;
}

export function FilterBar({ components, value, onChange }: FilterBarProps): JSX.Element {
  const emit = (next: ViewOptions): void => {
    onChange(normalizeView(next));
  };

  const sortOptions: SortKey[] = ["reviewability", "newest", "smallest"];
  if (value.component !== null) {
    sortOptions.push("affinity");
  }

  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3, mb: 3 }}>
      <UnderlineNav aria-label="Component filter">
        <UnderlineNav.Item
          aria-current={value.component === null ? "page" : "false"}
          onSelect={(e) => {
            e.preventDefault();
            emit({ ...value, component: null });
          }}
        >
          All
        </UnderlineNav.Item>
        {components.map((component) => (
          <UnderlineNav.Item
            key={component.name}
            aria-current={value.component === component.name ? "page" : "false"}
            counter={component.prCount}
            onSelect={(e) => {
              e.preventDefault();
              emit({ ...value, component: component.name });
            }}
          >
            {component.name}
          </UnderlineNav.Item>
        ))}
      </UnderlineNav>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
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
      </Box>
    </Box>
  );
}
