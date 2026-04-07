export function buildImportRequest(capture) {
  return {
    job_url: capture.url,
    source_url: capture.url,
    page_title: capture.title,
    source_text: capture.visibleText,
    meta: capture.meta,
    json_ld: capture.jsonLd,
    captured_at: new Date().toISOString(),
  };
}

const LOCAL_APP_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export function normalizeAppOrigin(url) {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isTrustedAppUrl(url) {
  const origin = normalizeAppOrigin(url);
  return origin !== null && LOCAL_APP_ORIGINS.has(origin);
}

async function getConnectionState() {
  const values = await chrome.storage.local.get(["extensionToken", "appUrl", "connectedAt"]);
  return {
    token: values.extensionToken ?? null,
    appUrl: values.appUrl ?? null,
    connectedAt: values.connectedAt ?? null,
  };
}

async function getActiveTabCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_CURRENT_PAGE" });
  if (!response?.capture) {
    throw new Error("Unable to capture the current page.");
  }
  return response.capture;
}

function setStatus(text) {
  const node = document.getElementById("status-text");
  if (node) {
    node.textContent = text;
  }
}

async function refreshView() {
  const captureButton = document.getElementById("capture-button");
  const openAppButton = document.getElementById("open-app-button");
  const state = await getConnectionState();

  if (state.token && state.appUrl && isTrustedAppUrl(state.appUrl)) {
    setStatus(
      state.connectedAt
        ? `Connected. Last token issued ${new Date(state.connectedAt).toLocaleString()}.`
        : "Connected. Ready to import this page.",
    );
    captureButton.disabled = false;
    openAppButton.disabled = false;
    openAppButton.textContent = "Open App Setup";
    return state;
  }

  if (state.token && state.appUrl && !isTrustedAppUrl(state.appUrl)) {
    setStatus("Stored app connection is not trusted. Reconnect from the local web app.");
    captureButton.disabled = true;
    openAppButton.disabled = true;
    return state;
  }

  setStatus("Open the web app Extension page in Chrome and connect this extension first.");
  captureButton.disabled = true;
  openAppButton.disabled = false;
  openAppButton.textContent = "How to Connect";
  return state;
}

async function handleCapture() {
  const button = document.getElementById("capture-button");
  const state = await getConnectionState();
  if (!state.token || !state.appUrl || !isTrustedAppUrl(state.appUrl)) {
    setStatus("Connect the extension from the web app first.");
    return;
  }

  button.disabled = true;
  setStatus("Capturing current tab…");

  try {
    const capture = await getActiveTabCapture();
    const payload = buildImportRequest(capture);
    const response = await fetch(`${state.appUrl}/api/extension/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Extension-Token": state.token,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      await chrome.storage.local.remove(["extensionToken", "connectedAt"]);
      throw new Error("Extension access expired. Reconnect it from the web app.");
    }

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ detail: "Import failed." }));
      throw new Error(errorPayload.detail ?? "Import failed.");
    }

    const detail = await response.json();
    await chrome.tabs.create({ url: `${state.appUrl}/app/applications/${detail.id}` });
    setStatus("Application created. Opening detail page…");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to import the current page.");
  } finally {
    await refreshView();
  }
}

async function handleOpenApp() {
  const state = await getConnectionState();
  if (!state.appUrl || !isTrustedAppUrl(state.appUrl)) {
    setStatus("Open the web app in Chrome, then go to its Extension page to connect.");
    return;
  }
  await chrome.tabs.create({ url: `${state.appUrl}/app/extension` });
}

document.addEventListener("DOMContentLoaded", async () => {
  await refreshView();
  document.getElementById("capture-button")?.addEventListener("click", () => {
    void handleCapture();
  });
  document.getElementById("open-app-button")?.addEventListener("click", () => {
    void handleOpenApp();
  });
});
