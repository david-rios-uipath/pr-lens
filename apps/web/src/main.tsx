import "@primer/primitives/dist/css/primitives.css";
// Both themes are always loaded; each is scoped to a data-color-mode selector
// that Primer's ThemeProvider sets, so the toggle needs no CSS swapping.
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root element");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
