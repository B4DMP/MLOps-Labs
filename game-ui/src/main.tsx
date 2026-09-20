import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./stylesheets/variables.css";
import App from "./App.tsx";
import "./stylesheets/app.css";
import "iconify-icon";

/**
 * Component harnesses, reachable at `?dev=<name>` in a dev build. They render one component
 * with its real stylesheet at several sizes, which is the only way to judge a layout that
 * depends on available width - a unit test cannot (jsdom has no layout engine) and a single
 * screenshot only covers one machine's font settings.
 */
const DEV_SCREENS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  "phase-rail": lazy(() => import("./components/dev/PhaseRailPreview")),
};

const devScreen = import.meta.env.DEV
  ? DEV_SCREENS[new URLSearchParams(window.location.search).get("dev") ?? ""]
  : undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {devScreen ? (
      <Suspense fallback={null}>{(() => { const Screen = devScreen; return <Screen />; })()}</Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
