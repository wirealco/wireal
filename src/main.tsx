import React from "react";
import ReactDOM from "react-dom/client";
import { Toast } from "@heroui/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { App } from "./App";
import { heartbeat, trace } from "./boot-trace";
import "./i18n";
import "./styles.css";
trace("entry");
heartbeat();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {[
          "/",
          "/app",
          "/auth",
          "/login",
          "/invitations",
          "/oauth/consent",
          "/verify-email",
          "/docs",
          "/docs/runner",
          "/changelog",
          "/privacy",
          "/terms",
        ].map((path) => (
          <Route key={path} path={path} element={<App />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    {/* One queue for the whole app. Mounted beside App rather than inside it so
        a toast raised while the workspace is still loading still has somewhere
        to land. */}
    <Toast.Provider placement="bottom end" />
  </React.StrictMode>,
);
