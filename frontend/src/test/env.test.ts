import { describe, expect, it } from "vitest";
import { normalizeRuntimeConfig } from "@/lib/runtime-config";

describe("frontend runtime env config", () => {
  it("drops empty runtime values so build-time envs are not overwritten", () => {
    expect(
      normalizeRuntimeConfig({
        VITE_APP_ENV: "production",
        VITE_APP_DEV_MODE: "false",
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "anon-key",
        VITE_API_URL: "   ",
      }),
    ).toEqual({
      VITE_APP_ENV: "production",
      VITE_APP_DEV_MODE: "false",
      VITE_SUPABASE_ANON_KEY: "anon-key",
    });
  });
});
