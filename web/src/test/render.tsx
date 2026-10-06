import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes, ROUTER_FUTURE } from "../App";
import { ToastProvider } from "../components/Toast";

export function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
}

/** The whole app (shell + routes) at a URL, with a fresh query cache. */
export function renderApp(url: string) {
  window.history.replaceState({}, "", url);
  const client = testClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[url]} future={ROUTER_FUTURE}>
            <AppRoutes />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}

/** A component with the providers it may need (query client, toasts, router). */
export function renderWithProviders(ui: ReactElement, url = "/") {
  const client = testClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[url]} future={ROUTER_FUTURE}>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}
