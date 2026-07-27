import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./stylesheets/variables.css";
import App from "./App.tsx";
import "./stylesheets/app.css";
import "iconify-icon";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
