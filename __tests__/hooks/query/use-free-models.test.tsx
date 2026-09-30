import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { callCloudProxy } from "#/api/cloud/proxy";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  useDefaultModel,
  useDefaultModelReady,
  useFreeModels,
  useHydrateFreeModels,
} from "#/hooks/query/use-free-models";
import { useFreeModelsStore } from "#/stores/free-models-store";

vi.mock("#/api/cloud/proxy", () => ({
  callCloudProxy: vi.fn(),
}));

const cloudBackend: Backend = {
  id: "cloud-ohe",
  name: "OpenHands Cloud",
  host: "https://app.all-hands.dev",
  apiKey: "cloud-key",
  kind: "cloud",
};

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
};

function useHydratedFreeModelState() {
  useHydrateFreeModels();
  const queryClient = useQueryClient();
  return {
    queryClient,
    freeModels: useFreeModels(),
    defaultModel: useDefaultModel(),
    defaultModelReady: useDefaultModelReady(),
  };
}

describe("useHydrateFreeModels", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id, orgId: null });
    useFreeModelsStore.getState().setFlags({
      freeModels: new Set(),
      defaultModel: null,
    });
    vi.mocked(callCloudProxy).mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    useFreeModelsStore.getState().setFlags({
      freeModels: new Set(),
      defaultModel: null,
    });
    vi.mocked(callCloudProxy).mockReset();
  });

  it("fetches OpenHands model flags with the backend-compatible page limit", async () => {
    vi.mocked(callCloudProxy).mockImplementation((async (req: {
      path: string;
      method: string;
    }) => {
      expect(req.method).toBe("GET");
      expect(req.path).toMatch(/^\/api\/v1\/config\/models\/search/);
      const url = new URL(`http://x.example.com${req.path}`);
      expect(url.searchParams.get("provider__eq")).toBe("openhands");
      expect(url.searchParams.get("limit")).toBe("100");
      return {
        items: [
          {
            provider: "openhands",
            name: "glm-5.2",
            verified: true,
            free: true,
            default: true,
          },
        ],
        next_page_id: null,
      };
    }) as never);

    const { result } = renderHook(() => useHydratedFreeModelState(), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.freeModels.has("openhands/glm-5.2")).toBe(true),
    );
    expect(result.current.defaultModel).toBe("openhands/glm-5.2");
  });

  it("does not query model metadata before a backend is configured", async () => {
    setRegisteredBackends([]);
    setActiveSelection(null);

    const { result } = renderHook(() => useHydratedFreeModelState(), {
      wrapper,
    });

    const modelQueryCache = result.current.queryClient.getQueryCache();
    await waitFor(() => {
      expect(modelQueryCache.getAll()).toHaveLength(1);
      expect(modelQueryCache.getAll()[0].state.fetchStatus).toBe("idle");
    });

    const modelFlagsQuery = modelQueryCache.getAll()[0];
    expect(modelFlagsQuery?.state.status).toBe("pending");
    expect(result.current.defaultModelReady).toBe(false);
    expect(result.current.freeModels.size).toBe(0);
  });
});
