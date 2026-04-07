function collectMeta() {
  const entries = [];
  for (const node of document.querySelectorAll("meta")) {
    const key = node.getAttribute("property") || node.getAttribute("name");
    const value = node.getAttribute("content");
    if (key && value) {
      entries.push([key, value]);
    }
    if (entries.length >= 50) {
      break;
    }
  }
  return Object.fromEntries(entries);
}

function collectJsonLd() {
  return Array.from(document.querySelectorAll("script[type='application/ld+json']"))
    .map((node) => node.textContent || "")
    .filter(Boolean)
    .slice(0, 10);
}

const LOCAL_APP_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function toOrigin(url) {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function isTrustedBridgeMessage(event) {
  if (event.source !== window || event.data?.source !== "resume-builder-web") {
    return false;
  }

  const values = await chrome.storage.local.get(["appUrl"]);
  const storedOrigin = toOrigin(values.appUrl);
  const payloadOrigin = toOrigin(event.data?.payload?.appUrl);

  if (payloadOrigin && payloadOrigin !== event.origin) {
    return false;
  }

  if (storedOrigin) {
    return storedOrigin === event.origin;
  }

  return LOCAL_APP_ORIGINS.has(event.origin);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_CURRENT_PAGE") {
    sendResponse({
      capture: {
        url: window.location.href,
        title: document.title,
        visibleText: document.body?.innerText || "",
        meta: collectMeta(),
        jsonLd: collectJsonLd(),
      },
    });
    return true;
  }
  return false;
});

window.addEventListener("message", (event) => {
  void (async () => {
    if (!(await isTrustedBridgeMessage(event))) {
      return;
    }

    if (event.data.type === "REQUEST_EXTENSION_STATUS") {
      chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATUS" }, (response) => {
        window.postMessage(
          {
            source: "resume-builder-extension",
            type: "EXTENSION_STATUS",
            connected: Boolean(response?.connected),
            appUrl: response?.appUrl ?? null,
          },
          window.location.origin,
        );
      });
    }

    if (event.data.type === "CONNECT_EXTENSION_TOKEN") {
      chrome.runtime.sendMessage({ type: "STORE_EXTENSION_TOKEN", payload: event.data.payload }, (response) => {
        if (!response?.ok) {
          return;
        }
        window.postMessage(
          {
            source: "resume-builder-extension",
            type: "EXTENSION_TOKEN_STORED",
            connectedAt: event.data.payload.connectedAt ?? new Date().toISOString(),
            appUrl: event.data.payload.appUrl,
          },
          window.location.origin,
        );
      });
    }

    if (event.data.type === "REVOKE_EXTENSION_TOKEN") {
      chrome.runtime.sendMessage({ type: "CLEAR_EXTENSION_TOKEN" });
    }
  })();
});
