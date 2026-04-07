import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

export function ExtensionPage() {
  const navigate = useNavigate();
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
      .catch((requestError: Error) => setError(requestError.message));

    function handleMessage(event: MessageEvent<BridgeStatusMessage | BridgeStoredMessage>) {
      if (event.data?.source !== "resume-builder-extension") {
        return;
      }
      if (event.data.type === "EXTENSION_STATUS") {
        setBridgeDetected(true);
        setMessage(
          event.data.connected
            ? `Chrome extension detected and connected to ${event.data.appUrl ?? "this app"}.`
            : "Chrome extension detected. Connect it from this page.",
        );
      }
      if (event.data.type === "EXTENSION_TOKEN_STORED") {
        setBridgeDetected(true);
        setMessage("Chrome extension connected. You can now create applications from the current tab.");
        void fetchExtensionStatus().then(setStatus);
      }
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: "resume-builder-web",
        type: "REQUEST_EXTENSION_STATUS",
      },
      window.location.origin,
    );

    return () => window.removeEventListener("message", handleMessage);
  }, []);

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
      setMessage("Connection token issued. If the extension is installed, it should connect immediately.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to connect extension.");
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
          payload: {
            appUrl: window.location.origin,
          },
        },
        window.location.origin,
      );
      setMessage("Chrome extension access revoked.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to revoke extension access.");
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button variant="secondary" className="w-fit" onClick={() => navigate("/app")}>
        Back to dashboard
      </Button>

      <Card className="bg-white/80">
        <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Chrome extension</p>
        <h2 className="mt-2 font-display text-3xl text-ink">Current-tab capture</h2>
        <p className="mt-3 max-w-3xl text-ink/65">
          Connect the Chrome extension once, then create a new application from the page you already
          have open. The extension stores only its scoped import token and never uses your Supabase
          session directly.
        </p>
      </Card>

      {error ? (
        <Card className="border-ember/20 bg-ember/5 text-ember">
          <p className="font-semibold">Extension request failed</p>
          <p className="mt-2 text-base">{error}</p>
        </Card>
      ) : null}

      {message ? (
        <Card className="border-spruce/20 bg-spruce/5 text-spruce">
          <p className="font-semibold">Extension status</p>
          <p className="mt-2 text-base">{message}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Connection</p>
          <div className="mt-5 space-y-4 text-ink/70">
            <p>{bridgeDetected ? "Extension bridge detected in Chrome." : "Extension bridge not detected yet."}</p>
            <p>
              {status?.connected
                ? `Scoped import token issued ${status.token_created_at ? new Date(status.token_created_at).toLocaleString() : "recently"}.`
                : "No active extension token is connected."}
            </p>
            <p>
              {status?.token_last_used_at
                ? `Last extension import ${new Date(status.token_last_used_at).toLocaleString()}.`
                : "No extension import has been recorded yet."}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => void handleConnect()} disabled={isConnecting}>
              {isConnecting ? "Connecting…" : status?.connected ? "Rotate Connection" : "Connect Extension"}
            </Button>
            <Button variant="secondary" onClick={() => void handleRevoke()} disabled={isRevoking}>
              {isRevoking ? "Revoking…" : "Revoke Access"}
            </Button>
          </div>
        </Card>

        <Card>
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">How it works</p>
          <ol className="mt-5 space-y-4 text-sm text-ink/70">
            <li>
              1. Load the unpacked Chrome extension from the repo folder
              {" "}
              <code>frontend/public/chrome-extension</code>.
            </li>
            <li>2. Keep this app open in Chrome and connect the extension from this page.</li>
            <li>3. Open a job posting tab, use the extension popup, and create a new application from the current page.</li>
            <li>4. The extension opens the application detail page so you can follow extraction, blocked-site recovery, or manual entry.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
