import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { TrayEngine } from "./tray/tray-engine";
import "./index.css";

// TrayEngine is headless: it feeds the native tray menu/icon from Convex
// subscriptions and keeps running while the (only) window is hidden.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TrayEngine />
    <App />
  </React.StrictMode>
);
