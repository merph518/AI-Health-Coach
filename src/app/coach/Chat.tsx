"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./chat.module.css";

export type Bubble = {
  id: number | string;
  role: "user" | "assistant";
  text: string;
  photos: string[];
  /** Local preview URL for a photo that is still uploading. */
  preview?: string;
  tools: string[];
  checkin?: boolean;
  error?: boolean;
};

const SUGGESTIONS = ["I had 2 eggs and toast for breakfast", "I weighed 180.4 this morning", "How am I doing this week?"];

/** Shrinks a photo to at most 1568 px on the long side (what the model uses) as JPEG. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail()), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

/** Minimal, safe formatting: paragraphs, bullet and numbered lists, **bold**. */
function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}
function Formatted({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  text
    .trim()
    .split(/\n{2,}/)
    .forEach((para, i) => {
      const lines = para.split("\n");
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l)))
        blocks.push(
          <ul key={i}>
            {lines.map((l, j) => (
              <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
            ))}
          </ul>,
        );
      else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
        blocks.push(
          <ol key={i}>
            {lines.map((l, j) => (
              <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>
            ))}
          </ol>,
        );
      else
        blocks.push(
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>,
        );
    });
  return <>{blocks}</>;
}

export default function Chat({ initial, enabled, name }: { initial: Bubble[]; enabled: boolean; name: string }) {
  const [bubbles, setBubbles] = useState(initial);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [bubbles]);

  const patchLast = (fn: (b: Bubble) => Bubble) =>
    setBubbles((bs) => [...bs.slice(0, -1), fn(bs[bs.length - 1])]);

  async function send(message = text) {
    const msg = message.trim();
    if ((!msg && !photo) || busy) return;
    setBusy(true);
    const form = new FormData();
    form.set("text", msg);
    if (photo) form.set("photo", photo.blob, "photo.jpg");
    const stamp = Date.now();
    setBubbles((bs) => [
      ...bs,
      { id: `u${stamp}`, role: "user", text: msg, photos: [], preview: photo?.url, tools: [] },
      { id: `a${stamp}`, role: "assistant", text: "", photos: [], tools: [] },
    ]);
    setText("");
    setPhoto(null);

    try {
      const res = await fetch("/api/chat", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const { error } = await res.json().catch(() => ({ error: "Something went wrong." }));
        patchLast((b) => ({ ...b, text: error, error: true }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.t === "text") patchLast((b) => ({ ...b, text: b.text + e.d }));
          else if (e.t === "tool") patchLast((b) => ({ ...b, tools: [...b.tools, e.label] }));
          else if (e.t === "error") patchLast((b) => ({ ...b, text: `${b.text}\n\n${e.m}`.trim(), error: true }));
        }
      }
    } catch {
      patchLast((b) => ({ ...b, text: `${b.text}\n\nConnection lost. Your message was saved; reload to see the reply.`.trim(), error: true }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    const blob = await shrink(file);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.list} aria-live="polite">
        {bubbles.length === 0 && (
          <div className={styles.empty}>
            <p>
              Hi {name}. Tell me what you ate, send a photo of your plate or a label, log your weight, or ask how
              things are going.
            </p>
            <div className={styles.suggest}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn" onClick={() => setText(s)} disabled={!enabled}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {bubbles.map((b, i) => (
          <div key={b.id} className={b.role === "user" ? styles.user : styles.bot} data-error={b.error || undefined}>
            {b.checkin && <span className={styles.tag}>Check-in</span>}
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            {b.preview && <img src={b.preview} alt="Your photo" className={styles.photo} />}
            {b.photos.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f} src={`/api/photos/${f}`} alt="Your photo" className={styles.photo} loading="lazy" />
            ))}
            {b.tools.length > 0 && (
              <div className={styles.tools}>
                {b.tools.map((t, j) => (
                  <span key={j}>✓ {t}</span>
                ))}
              </div>
            )}
            {b.text ? (
              b.role === "assistant" ? <Formatted text={b.text} /> : <p>{b.text}</p>
            ) : (
              busy && i === bubbles.length - 1 && <span className={styles.dots} aria-label="Coach is typing" />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {!enabled && <p className="muted" style={{ fontSize: 13 }}>The coach isn&rsquo;t connected yet (no API key on the server).</p>}
        {photo && (
          <div className={styles.attached}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Attached photo" />
            <button type="button" className="btn" onClick={() => setPhoto(null)}>
              Remove
            </button>
          </div>
        )}
        <div className={styles.row}>
          <button
            type="button"
            className="btn"
            aria-label="Attach a photo"
            title="Attach a photo"
            onClick={() => fileRef.current?.click()}
            disabled={!enabled || busy}
          >
            📷
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pickPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder="What did you eat?"
            aria-label="Message to your coach"
            disabled={!enabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(hover: hover)").matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn btn-primary" disabled={!enabled || busy || (!text.trim() && !photo)}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
