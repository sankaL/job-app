chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "STORE_EXTENSION_TOKEN") {
    chrome.storage.local
      .set({
        extensionToken: message.payload.token,
        appUrl: message.payload.appUrl,
        connectedAt: message.payload.connectedAt ?? new Date().toISOString(),
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "GET_EXTENSION_STATUS") {
    chrome.storage.local
      .get(["extensionToken", "appUrl", "connectedAt"])
      .then((values) =>
        sendResponse({
          connected: Boolean(values.extensionToken && values.appUrl),
          appUrl: values.appUrl ?? null,
          connectedAt: values.connectedAt ?? null,
        }),
      );
    return true;
  }

  if (message?.type === "CLEAR_EXTENSION_TOKEN") {
    chrome.storage.local
      .remove(["extensionToken", "connectedAt"])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});
