import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, useRouteError } from "react-router-dom";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";

import { Shell } from "./components/Shell";
import { ConverseProvider } from "./components/ConverseProvider";
const Overview = lazy(() => import("./screens/Overview").then((module) => ({ default: module.Overview })));
const Usage = lazy(() => import("./screens/Usage").then((module) => ({ default: module.Usage })));
const Sessions = lazy(() => import("./screens/Sessions").then((module) => ({ default: module.Sessions })));
const SessionDetail = lazy(() => import("./screens/SessionDetail").then((module) => ({ default: module.SessionDetail })));
const Mcp = lazy(() => import("./screens/Mcp").then((module) => ({ default: module.Mcp })));
const Projects = lazy(() => import("./screens/Projects").then((module) => ({ default: module.Projects })));
const Converse = lazy(() => import("./screens/Converse").then((module) => ({ default: module.Converse })));
const Fleet = lazy(() => import("./screens/Fleet").then((module) => ({ default: module.Fleet })));
const Brain = lazy(() => import("./screens/Brain").then((module) => ({ default: module.Brain })));
const Skills = lazy(() => import("./screens/Skills").then((module) => ({ default: module.Skills })));

function screen(element: React.ReactNode) {
  return <Suspense fallback={<div className="panel h-48 animate-pulse" />}>{element}</Suspense>;
}

function RouteError() {
  const error = useRouteError();
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <section className="panel max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">Odin could not load this screen.</h1>
        <p className="mt-2 text-sm text-ink-dim">
          {error instanceof Error ? error.message : "The application bundle may have changed."}
        </p>
        <button type="button" onClick={() => location.reload()} className="mt-4 rounded-lg bg-clay px-4 py-2 text-sm text-canvas">
          Reload Odin
        </button>
      </section>
    </main>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: screen(<Overview />) },
      { path: "converse", element: screen(<Converse />) },
      { path: "fleet", element: screen(<Fleet />) },
      { path: "brain", element: screen(<Brain />) },
      { path: "skills", element: screen(<Skills />) },
      { path: "usage", element: screen(<Usage />) },
      { path: "sessions", element: screen(<Sessions />) },
      { path: "sessions/:id", element: screen(<SessionDetail />) },
      { path: "mcp", element: screen(<Mcp />) },
      { path: "projects", element: screen(<Projects />) },
      {
        path: "*",
        element: (
          <section className="panel p-8 text-center">
            <h1 className="text-xl font-semibold text-ink">That Odin route does not exist.</h1>
            <a href="/" className="mt-3 inline-block text-sm text-clay hover:text-clay-bright">Return home</a>
          </section>
        ),
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConverseProvider>
        <RouterProvider router={router} />
      </ConverseProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
