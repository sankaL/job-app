import { afterEach, describe, expect, it, vi } from "vitest";

async function loadApi() {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => ({
    getAccessToken: vi.fn().mockResolvedValue("test-token"),
  }));
  vi.doMock("@/lib/env", () => ({
    env: { VITE_API_URL: "http://localhost:8000" },
  }));
  return import("@/lib/api");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("application event stream", () => {
  it("dispatches supported events and ignores unknown events", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'event: snapshot\ndata: {"sequence":1}',
              'event: progress\ndata: {"stage":"extracting"}',
              'event: detail\ndata: {"id":"app-1"}',
              'event: heartbeat\ndata: {"timestamp":"now"}',
              'event: unknown\ndata: {"ignored":true}',
            ].join("\n\n") + "\n\n",
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    const { openApplicationEventStream } = await loadApi();
    const onSnapshot = vi.fn();
    const onProgress = vi.fn();
    const onDetail = vi.fn();
    const onHeartbeat = vi.fn();

    await openApplicationEventStream("app-1", {
      signal: new AbortController().signal,
      onSnapshot,
      onProgress,
      onDetail,
      onHeartbeat,
    });

    expect(onSnapshot).toHaveBeenCalledWith({ sequence: 1 });
    expect(onProgress).toHaveBeenCalledWith({ stage: "extracting" });
    expect(onDetail).toHaveBeenCalledWith({ id: "app-1" });
    expect(onHeartbeat).toHaveBeenCalledWith({ timestamp: "now" });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onDetail).toHaveBeenCalledTimes(1);
    expect(onHeartbeat).toHaveBeenCalledTimes(1);
  });
});
