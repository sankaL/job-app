declare module "../../public/chrome-extension/popup.js" {
  export function buildImportRequest(capture: {
    url: string;
    title: string;
    visibleText: string;
    meta: Record<string, string>;
    jsonLd: string[];
  }): {
    job_url: string;
    source_url: string;
    page_title: string;
    source_text: string;
    meta: Record<string, string>;
    json_ld: string[];
    captured_at: string;
  };
  export function normalizeAppOrigin(url: string | null | undefined): string | null;
  export function isTrustedAppUrl(url: string | null | undefined): boolean;
}
