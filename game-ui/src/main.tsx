import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./stylesheets/variables.css";
import App from "./App.tsx";
import "./stylesheets/app.css";
import "iconify-icon";
import { tintFaviconOnLocalhost } from "./localFavicon";

tintFaviconOnLocalhost();

/**
 * Dev-only pages, reachable at `?dev=<name>` in a dev build. Mostly component harnesses that
 * render one component with its real stylesheet at several sizes, the only way to judge a
 * layout that depends on available width - a unit test cannot (jsdom has no layout engine)
 * and a single screenshot only covers one machine's font settings. `humor-memo` is a plain
 * standalone design-notes page, not a harness.
 */
const DEV_SCREENS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  "phase-rail": lazy(() => import("./components/dev/PhaseRailPreview")),
  results: lazy(() => import("./components/dev/ResultsPreview")),
  "admin-results": lazy(() => import("./components/dev/AdminResultsPreview")),
  "humor-memo": lazy(() => import("./components/dev/HumorMemoPreview")),
  "case-board": lazy(() => import("./components/dev/CaseBoardPreview")),
};

const devScreen = import.meta.env.DEV
  ? DEV_SCREENS[new URLSearchParams(window.location.search).get("dev") ?? ""]
  : undefined;

// app.css locks html/body to a fixed 100vh with overflow:hidden for the real game, which
// manages its own internal scroll regions. Dev previews are plain, often taller-than-viewport
// pages, so undo that lock here for every `?dev=` screen rather than in each preview.
if (devScreen) {
  document.documentElement.style.cssText = "height: auto; overflow: auto;";
  document.body.style.cssText = "height: auto; overflow: auto;";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {devScreen ? (
      <Suspense fallback={null}>{(() => { const Screen = devScreen; return <Screen />; })()}</Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
