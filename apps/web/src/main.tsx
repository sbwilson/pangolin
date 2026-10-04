import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppRouter } from "./router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

const queryClient = new QueryClient();
const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// vite-plugin-pwa runs with injectRegister: false, so the worker is registered here.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.error("Service worker registration failed", error);
    });
  });
}
