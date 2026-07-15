import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  fetchExtensionStatus,
  issueExtensionToken,
  revokeExtensionToken,
  type ExtensionConnectionStatus,
} from "@/lib/api";

type BridgeStatusMessage = {
  source: "resume-builder-extension";
  type: "EXTENSION_STATUS";
  connected: boolean;
  appUrl: string | null;
};

type BridgeStoredMessage = {
  source: "resume-builder-extension";
  type: "EXTENSION_TOKEN_STORED";
  connectedAt: string;
  appUrl: string;
};

const SETUP_STEPS = [
  {
    num: 1,
    text: "Load the unpacked Chrome extension from the repo folder",
    detail: "frontend/public/chrome-extension",
  },
  {
    num: 2,
    text: "Keep this app open in Chrome and connect the extension from this page",
  },
  {
    num: 3,
    text: "Open a job posting tab and use the extension popup to create a new application",
  },
  {
    num: 4,
    text: "The extension opens the application detail page for extraction, recovery, or manual entry",
  },
];

function useExtensionBridge(
  setStatus: (status: ExtensionConnectionStatus) => void,
  setBridgeDetected: (detected: boolean) => void,
  setMessage: (message: string) => void,
) {
  useEffect(() => {
    function handleMessage(
      event: MessageEvent<BridgeStatusMessage | BridgeStoredMessage>,
    ) {
      if (event.data?.source !== "resume-builder-extension") return;
      if (event.data.type === "EXTENSION_TOKEN_STORED") {
        setBridgeDetected(true);
        setMessage(
          "Chrome extension connected. You can now create applications from the current tab.",
        );
        void fetchExtensionStatus().then(setStatus);
        return;
      }
      if (event.data.type !== "EXTENSION_STATUS") return;
      setBridgeDetected(true);
      setMessage(
        event.data.connected
          ? `Chrome extension detected and connected to ${event.data.appUrl ?? "this app"}.`
          : "Chrome extension detected. Connect it from this page.",
      );
    }
    window.addEventListener("message", handleMessage);
    window.postMessage(
      { source: "resume-builder-web", type: "REQUEST_EXTENSION_STATUS" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", handleMessage);
  }, [setBridgeDetected, setMessage, setStatus]);
}

function ConnectionRow({
  connected,
  connectedLabel,
  disconnectedLabel,
}: {
  connected: boolean;
  connectedLabel: string;
  disconnectedLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-2 w-2 rounded-full"
        style={{
          background: connected ? "var(--color-spruce)" : "var(--color-ink-25)",
        }}
      />
      <span className="text-sm text-[var(--color-ink)]">
        {connected ? connectedLabel : disconnectedLabel}
      </span>
    </div>
  );
}

function getTokenLabel(status: ExtensionConnectionStatus | null) {
  if (!status?.connected) return "No active token";
  if (!status.token_created_at) return "Token issued recently";
  return `Token issued ${new Date(status.token_created_at).toLocaleString()}`;
}

function LastImport({ timestamp }: { timestamp: string | null | undefined }) {
  if (!timestamp) return null;
  return (
    <div className="text-xs text-[var(--color-ink-40)]">
      Last import: {new Date(timestamp).toLocaleString()}
    </div>
  );
}

function ExtensionStatusCard({
  status,
  bridgeDetected,
  isConnecting,
  isRevoking,
  onConnect,
  onRevoke,
}: {
  status: ExtensionConnectionStatus | null;
  bridgeDetected: boolean;
  isConnecting: boolean;
  isRevoking: boolean;
  onConnect: () => void;
  onRevoke: () => void;
}) {
  const tokenLabel = getTokenLabel(status);
  return (
    <Card density="compact" className="flex h-full flex-col">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-40)]">
        Connection Status
      </h3>
      <div className="mt-3 space-y-2.5">
        <ConnectionRow
          connected={bridgeDetected}
          connectedLabel="Extension bridge detected"
          disconnectedLabel="Extension bridge not detected"
        />
        <ConnectionRow
          connected={Boolean(status?.connected)}
          connectedLabel={tokenLabel}
          disconnectedLabel="No active token"
        />
        <LastImport timestamp={status?.token_last_used_at} />
      </div>
      <div className="mt-auto flex justify-end gap-2 pt-4">
        <Button size="sm" loading={isConnecting} onClick={onConnect}>
          {status?.connected ? "Rotate Connection" : "Connect Extension"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={isRevoking}
          onClick={onRevoke}
        >
          Revoke Access
        </Button>
      </div>
    </Card>
  );
}

function ExtensionSetupGuide() {
  return (
    <Card density="compact">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-40)]">
        Setup Guide
      </h3>
      <div className="mt-3 space-y-3">
        {SETUP_STEPS.map((step) => (
          <div key={step.num} className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-spruce-10)] text-xs font-bold text-[var(--color-spruce)]">
              {step.num}
            </span>
            <div>
              <p className="text-sm text-[var(--color-ink)]">{step.text}</p>
              {step.detail ? (
                <code className="mt-1 inline-block rounded bg-[var(--color-ink-05)] px-2 py-0.5 text-xs text-[var(--color-ink-65)]">
                  {step.detail}
                </code>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ExtensionPage() {
  const [status, setStatus] = useState<ExtensionConnectionStatus | null>(null);
  const [bridgeDetected, setBridgeDetected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    fetchExtensionStatus()
      .then((response) => {
        setStatus(response);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  useExtensionBridge(setStatus, setBridgeDetected, setMessage);

  async function handleConnect() {
    setIsConnecting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await issueExtensionToken();
      setStatus(response.status);
      window.postMessage(
        {
          source: "resume-builder-web",
          type: "CONNECT_EXTENSION_TOKEN",
          payload: {
            token: response.token,
            appUrl: window.location.origin,
            connectedAt: response.status.token_created_at,
          },
        },
        window.location.origin,
      );
      setMessage(
        "Connection token issued. If the extension is installed, it should connect immediately.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to connect extension.",
      );
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleRevoke() {
    setIsRevoking(true);
    setError(null);
    try {
      const nextStatus = await revokeExtensionToken();
      setStatus(nextStatus);
      window.postMessage(
        {
          source: "resume-builder-web",
          type: "REVOKE_EXTENSION_TOKEN",
          payload: { appUrl: window.location.origin },
        },
        window.location.origin,
      );
      setMessage("Chrome extension access revoked.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to revoke extension access.",
      );
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Chrome Extension"
        subtitle="Capture job postings directly from your browser"
      />

      {error && (
        <Card variant="danger" density="compact">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-ember)" }}
          >
            Error
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {error}
          </p>
        </Card>
      )}

      {message && (
        <Card variant="success" density="compact">
          <p className="text-sm" style={{ color: "var(--color-spruce)" }}>
            {message}
          </p>
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <ExtensionStatusCard
          status={status}
          bridgeDetected={bridgeDetected}
          isConnecting={isConnecting}
          isRevoking={isRevoking}
          onConnect={() => void handleConnect()}
          onRevoke={() => void handleRevoke()}
        />
        <ExtensionSetupGuide />
      </div>
    </div>
  );
}
