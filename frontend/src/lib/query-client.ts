import { QueryClient } from "@tanstack/react-query";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        gcTime: TEN_MINUTES_MS,
      },
    },
  });
}

export const appQueryClient = createAppQueryClient();
