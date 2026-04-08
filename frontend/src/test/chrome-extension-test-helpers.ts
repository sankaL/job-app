type ImportCapture = {
  url: string;
  title: string;
  visibleText: string;
  meta: Record<string, string>;
  jsonLd: string[];
};

type ImportRequest = {
  job_url: string;
  source_url: string;
  page_title: string;
  source_text: string;
  meta: Record<string, string>;
  json_ld: string[];
  captured_at: string;
};

type PopupHelpers = {
  buildImportRequest(capture: ImportCapture): ImportRequest;
  normalizeAppOrigin(url: string | null | undefined): string | null;
  isTrustedAppUrl(url: string | null | undefined): boolean;
};

// @ts-ignore plain JS bundle used by Chrome extension tests
import * as popupModule from "../../public/chrome-extension/popup.js";

const popupHelpers = popupModule as PopupHelpers;

export const buildImportRequest = popupHelpers.buildImportRequest;
export const normalizeAppOrigin = popupHelpers.normalizeAppOrigin;
export const isTrustedAppUrl = popupHelpers.isTrustedAppUrl;

// @ts-ignore plain JS bundle used by Chrome extension tests
const loadRawContentScript = () => import("../../public/chrome-extension/content-script.js");

export async function loadContentScript(): Promise<void> {
  await loadRawContentScript();
}
