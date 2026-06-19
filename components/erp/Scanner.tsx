"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Props = {
  onDetect: (code: string) => void;
  /** keep scanning after a hit (warehouse continuous mode) */
  continuous?: boolean;
  /** ignore the same code within this many ms (continuous mode) */
  cooldownMs?: number;
};

type CamState = "idle" | "starting" | "running" | "denied" | "error" | "unsupported";

export default function Scanner({ onDetect, continuous = false, cooldownMs = 2500 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastHit = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [state, setState] = useState<CamState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(false);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      const now = Date.now();
      const dup = code.data === lastHit.current.code && now - lastHit.current.at < cooldownMs;
      if (!dup) {
        lastHit.current = { code: code.data, at: now };
        setFlash(true);
        setTimeout(() => setFlash(false), 300);
        onDetect(code.data);
        if (!continuous) {
          stop();
          setState("idle");
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [continuous, cooldownMs, onDetect, stop]);

  const start = useCallback(async () => {
    setErrMsg("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      setErrMsg("Camera API not available. Use HTTPS or type the code below.");
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      setState("running");
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        setState("denied");
        setErrMsg("Camera permission denied. Allow access in your browser, then retry.");
      } else if (err.name === "NotFoundError") {
        setState("error");
        setErrMsg("No camera found on this device.");
      } else {
        setState("error");
        setErrMsg(err.message || "Could not start the camera.");
      }
    }
  }, [tick]);

  useEffect(() => () => stop(), [stop]);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-2xl border-2 bg-black ${
          flash ? "border-[var(--accent-2)]" : "border-[var(--border)]"
        }`}
      >
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />

        {/* reticle */}
        {state === "running" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-3/5 w-3/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_4000px_rgba(0,0,0,0.35)]" />
            <div className={`absolute h-3/5 w-3/5 rounded-xl ${flash ? "ring-4 ring-[var(--accent-2)]" : ""}`} />
          </div>
        )}

        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {state === "starting" ? (
              <p className="text-sm font-semibold">Starting camera…</p>
            ) : (
              <>
                <div className="text-4xl opacity-80">▣</div>
                <p className="max-w-xs text-sm font-medium text-white/80">
                  {errMsg || "Tap below to start scanning with your camera."}
                </p>
                <button
                  onClick={start}
                  className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[var(--accent-strong)]"
                >
                  {state === "denied" || state === "error" ? "Retry camera" : "Start camera"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {state === "running" && (
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 font-semibold text-[var(--accent-2)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-2)]" />
            Scanning{continuous ? " (continuous)" : ""}…
          </span>
          <button
            onClick={() => {
              stop();
              setState("idle");
            }}
            className="rounded-md border border-[var(--border)] px-3 py-1 font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            Stop
          </button>
        </div>
      )}

      {/* manual entry — works without a camera (desktop / non-HTTPS) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            onDetect(manual.trim());
            setManual("");
          }
        }}
        className="flex gap-2"
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or type / paste a QR token (e.g. SQR-…)"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">
          Enter
        </button>
      </form>
    </div>
  );
}
