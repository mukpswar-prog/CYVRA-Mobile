import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ActivationScreen, type ActivationFields } from "./ActivationScreen";

/**
 * Exactly the shape `activation::commands::ActivationDecision` serializes to.
 *
 * The frontend never narrows or reinterprets this - `state` selects a view and
 * `message` is displayed as-is - because the six verdicts live in Rust and
 * having a second copy of them here is how wording starts to drift.
 */
export type ActivationDecision = {
  state: "enter" | "needsActivation" | "refused" | "localFault";
  offline: boolean;
  message: string | null;
  termsVersion: string;
};

/**
 * What the gate does when it cannot get a decision at all.
 *
 * No entry, no banner. This is the reason the gate renders nothing rather than
 * the application while `activation_launch` is in flight or has failed: opening
 * on an error would be guessing, and opening anyway would be a bypass.
 */
const NO_ENTRY: ActivationDecision = {
  state: "localFault",
  offline: false,
  message: null,
  termsVersion: "",
};

async function decide(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<ActivationDecision>(command, args);
  } catch (error) {
    // An internal cause, not a licence verdict: it may be logged, and it may
    // not be shown, because the screen has nowhere to put it that is not a lie.
    console.error(`${command} failed`, error);
    return NO_ENTRY;
  }
}

/**
 * The launch decision is a fact about the workstation, not about whichever
 * component asks for it, so it is resolved once and shared by every mount.
 *
 * `activation_launch` appends a `GRACE_ENTERED` ledger entry every time it
 * runs, and React StrictMode mounts, tears down and re-runs effects in
 * development. The `live` flag in the effect below stops the abandoned mount
 * from writing state, but it cannot un-send an `invoke` that has already been
 * dispatched: two mounts therefore meant two entries stamped in the same
 * second, recording one launch as two facts that never happened. Holding the
 * promise here makes the second mount await the first instead of asking Rust
 * to launch again.
 */
let launchDecision: Promise<ActivationDecision> | null = null;

function launchOnce(): Promise<ActivationDecision> {
  if (launchDecision === null) {
    launchDecision = decide("activation_launch");
  }
  return launchDecision;
}

/**
 * Holds the existing application hostage until the launch sequence says let in.
 *
 * Wraps `<App/>` rather than editing it, so the frozen inspection core stays
 * byte-for-byte what it was: activation is a *wrapper*, exactly as the state
 * machine describes it, and the workspace is unaware one exists.
 */
export function ActivationGate({ children }: { children: ReactNode }) {
  const [decision, setDecision] = useState<ActivationDecision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;

    void (async () => {
      const next = await launchOnce();
      if (live) setDecision(next);
    })();

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (decision === null) return;

    // Offline entry has to escape this component somehow, or the flag never
    // leaves Rust and cached data would have no way to be labelled as cached.
    // Published on the root element so the workspace and its CSS can read it
    // without this gate knowing anything about how they render.
    document.documentElement.dataset.cyvraEntry = decision.offline ? "offline" : "online";
  }, [decision]);

  // Still deciding. Nothing is rendered: the application is not reachable
  // without an explicit `enter`, so there is nothing to show but the door.
  if (decision === null) return null;

  if (decision.state === "enter") return <>{children}</>;

  function submit(fields: ActivationFields) {
    if (busy) return;

    setBusy(true);
    void (async () => {
      const next = await decide("activation_submit", {
        email: fields.email,
        licenceKey: fields.licenceKey,
      });
      setDecision(next);
      setBusy(false);
    })();
  }

  return (
    <ActivationScreen
      message={decision.message}
      termsVersion={decision.termsVersion}
      busy={busy}
      onSubmit={submit}
    />
  );
}
