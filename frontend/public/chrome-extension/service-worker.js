function respondToStorageOperation(operation, sendResponse) {
  operation
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
}

function storeExtensionToken(message, sendResponse) {
  const values = {
    extensionToken: message.payload.token,
    appUrl: message.payload.appUrl,
    connectedAt: message.payload.connectedAt ?? new Date().toISOString(),
  };
  return respondToStorageOperation(
    chrome.storage.local.set(values),
    sendResponse,
  );
}

function getExtensionStatus(_message, sendResponse) {
  chrome.storage.local
    .get(["extensionToken", "appUrl", "connectedAt"])
    .then((values) => {
      sendResponse({
        connected: Boolean(values.extensionToken && values.appUrl),
        appUrl: values.appUrl ?? null,
        connectedAt: values.connectedAt ?? null,
      });
    });
  return true;
}

function clearExtensionToken(_message, sendResponse) {
  return respondToStorageOperation(
    chrome.storage.local.remove(["extensionToken", "connectedAt"]),
    sendResponse,
  );
}

const MESSAGE_HANDLERS = {
  STORE_EXTENSION_TOKEN: storeExtensionToken,
  GET_EXTENSION_STATUS: getExtensionStatus,
  CLEAR_EXTENSION_TOKEN: clearExtensionToken,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message?.type];
  return handler ? handler(message, sendResponse) : false;
});
