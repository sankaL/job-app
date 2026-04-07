import { beforeEach, describe, expect, it, vi } from "vitest";

type StorageState = {
  appUrl: string | null;
};

describe("chrome extension bridge", () => {
  const runtimeSendMessage = vi.fn();
  let storageState: StorageState;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storageState = { appUrl: null };

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener: vi.fn(),
          },
          sendMessage: runtimeSendMessage,
        },
        storage: {
          local: {
            get: vi.fn(async () => ({ appUrl: storageState.appUrl })),
          },
        },
      },
    });
  });

  it("ignores connect messages from untrusted origins", async () => {
    await import("../../public/chrome-extension/content-script.js");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        source: window,
        data: {
          source: "resume-builder-web",
          type: "CONNECT_EXTENSION_TOKEN",
          payload: {
            token: "malicious-token",
            appUrl: "https://evil.example",
          },
        },
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(runtimeSendMessage).not.toHaveBeenCalled();
  });

  it("accepts localhost connect messages for first-time setup", async () => {
    runtimeSendMessage.mockImplementation((_message, callback) => {
      callback?.({ ok: true });
    });

    await import("../../public/chrome-extension/content-script.js");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://localhost:5173",
        source: window,
        data: {
          source: "resume-builder-web",
          type: "CONNECT_EXTENSION_TOKEN",
          payload: {
            token: "real-token",
            appUrl: "http://localhost:5173",
            connectedAt: "2026-04-07T16:00:00Z",
          },
        },
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      {
        type: "STORE_EXTENSION_TOKEN",
        payload: {
          token: "real-token",
          appUrl: "http://localhost:5173",
          connectedAt: "2026-04-07T16:00:00Z",
        },
      },
      expect.any(Function),
    );
  });
});
