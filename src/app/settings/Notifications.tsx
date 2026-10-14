"use client";

import { useActionState, useEffect, useState } from "react";
import { removePushSubscription, saveCheckinTimes, savePushSubscription, sendTestPush } from "./actions";

const DEFAULT_TIMES = ["07:53", "11:53", "17:53"];
const LABELS = ["Morning (weight, breakfast)", "Midday (lunch)", "Evening (dinner)"];

function keyBytes(base64: string) {
  const b64 = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

type Status = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

export default function Notifications({ publicKey, times }: { publicKey: string | null; times: string[] }) {
  const [status, setStatus] = useState<Status>("loading");
  const [msg, setMsg] = useState("");
  const [state, action, pending] = useActionState(saveCheckinTimes, undefined);
  const shown = times.length ? times : DEFAULT_TIMES;

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) {
        setStatus(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      if (Notification.permission === "denied") return setStatus("denied");
      const sub = await reg.pushManager.getSubscription();
      if (sub) await savePushSubscription(sub.toJSON() as Parameters<typeof savePushSubscription>[0]);
      setStatus(sub ? "on" : "off");
    })().catch(() => setStatus("unsupported"));
  }, [publicKey]);

  async function enable() {
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
      const res = await savePushSubscription(sub.toJSON() as Parameters<typeof savePushSubscription>[0]);
      if ("error" in res) throw new Error(res.error);
      setStatus("on");
    } catch {
      setStatus(Notification.permission === "denied" ? "denied" : "off");
      setMsg("Couldn't turn on notifications on this device.");
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await removePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setStatus("off");
  }

  async function test() {
    const { sent } = await sendTestPush();
    setMsg(sent ? `Sent to ${sent} device${sent === 1 ? "" : "s"}.` : "No devices are subscribed yet.");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        {status === "loading" && <p className="muted">Checking this device…</p>}
        {status === "unsupported" && (
          <p className="muted">
            {publicKey ? "This browser can't receive notifications." : "Notifications aren't set up on the server yet."}
          </p>
        )}
        {status === "ios-install" && (
          <p className="muted">
            On iPhone, first add this app to your Home Screen: tap Share, then &ldquo;Add to Home Screen&rdquo;. Open it
            from there and come back to this page.
          </p>
        )}
        {status === "denied" && (
          <p className="muted">Notifications are blocked for this site. Allow them in your browser&rsquo;s site settings.</p>
        )}
        {status === "off" && (
          <>
            <p className="muted">Get a notification on this device when it&rsquo;s time to check in.</p>
            <button className="btn btn-primary" style={{ justifySelf: "start" }} onClick={enable}>
              Turn on notifications
            </button>
          </>
        )}
        {status === "on" && (
          <>
            <p className="ok">Notifications are on for this device.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={test}>
                Send a test
              </button>
              <button className="btn" onClick={disable}>
                Turn off here
              </button>
            </div>
          </>
        )}
        {msg && <p className="muted">{msg}</p>}
      </div>

      <form action={action} style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="enabled" defaultChecked={times.length > 0} />
          Send meal check-ins
        </label>
        {shown.map((t, i) => (
          <div key={i} className="field" style={{ gridTemplateColumns: "1fr auto", alignItems: "center", display: "grid", gap: 8 }}>
            <label htmlFor={`time${i}`}>{LABELS[i] ?? `Check-in ${i + 1}`}</label>
            <input id={`time${i}`} type="time" name="time" defaultValue={t} />
          </div>
        ))}
        <p className="muted" style={{ fontSize: 13 }}>
          Check-ins skip meals you&rsquo;ve already logged, and don&rsquo;t send at all if there&rsquo;s nothing to ask.
        </p>
        {state?.error && <p className="error">{state.error}</p>}
        {state?.ok && <p className="ok">{state.ok}</p>}
        <button className="btn" disabled={pending} style={{ justifySelf: "start" }}>
          Save check-ins
        </button>
      </form>
    </div>
  );
}
