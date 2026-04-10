import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildImportRequest,
  isTrustedAppUrl,
  normalizeAppOrigin,
} from "./chrome-extension-test-helpers";

describe("chrome extension popup helpers", () => {
  it("builds the extension import payload from a captured page", () => {
    const payload = buildImportRequest({
      url: "https://example.com/jobs/1",
      title: "Backend Engineer",
      visibleText: "Backend Engineer at Acme",
      meta: { "og:title": "Backend Engineer" },
      jsonLd: [],
    });

    expect(payload.job_url).toBe("https://example.com/jobs/1");
    expect(payload.page_title).toBe("Backend Engineer");
    expect(payload.source_text).toContain("Acme");
    expect(typeof payload.captured_at).toBe("string");
  });

  it("accepts only trusted local app origins", () => {
    expect(normalizeAppOrigin("http://localhost:5173/app/extension")).toBe("http://localhost:5173");
    expect(isTrustedAppUrl("http://localhost:5173/app/extension")).toBe(true);
    expect(isTrustedAppUrl("https://evil.example")).toBe(false);
  });

  it("keeps the branded popup logo inside the unpacked extension root", () => {
    const popupHtml = readFileSync("public/chrome-extension/popup.html", "utf8");

    expect(popupHtml).toContain('src="./applix-logo.svg"');
    expect(existsSync("public/chrome-extension/applix-logo.svg")).toBe(true);
  });
});
