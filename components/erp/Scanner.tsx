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

// Grayscale conversion for the ZXing 1D decoder — RGBLuminanceSource expects
// one luminance byte per pixel, not raw RGBA, when given a Uint8ClampedArray.
function toGrayscale(img: ImageData): Uint8ClampedArray {
  const { data, width, height } = img;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}

export default function Scanner({ onDetect, continuous = false, cooldownMs = 2500 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastHit = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  // Lazily loaded — keeps @zxing/library out of the initial bundle. Decodes
  // Code128 (the barcode-label format); QR keeps going through jsQR above,
  // which is faster for that format.
  const decodeBarcodeRef = useRef<((img: ImageData) => string | null) | null>(null);
  const frameCount = useRef(0);
  // Native BarcodeDetector (Android Chrome / newer browsers) — uses the OS
  // decoder, as robust as the phone's own camera app. Preferred over jsQR.
  const detectorRef = useRef<{ detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> } | null>(null);
  const detectingRef = useRef(false);
  const lastRawRef = useRef<string>("");

  const [state, setState] = useState<CamState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [camInfo, setCamInfo] = useState("");
  const [dbg, setDbg] = useState("");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  const applyZoom = useCallback(async (z: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    setZoom(z);
    try { await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }); } catch { /* ignore */ }
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch { /* torch not controllable */ }
  }, [torchOn]);

  // Prefer the native BarcodeDetector — but only if it actually supports QR.
  useEffect(() => {
    const BD = typeof window !== "undefined"
      ? (window as unknown as { BarcodeDetector?: (new (o: object) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }) & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
      : undefined;
    if (!BD) return;
    (async () => {
      try {
        const formats = await BD.getSupportedFormats?.();
        if (formats && !formats.includes("qr_code")) return;
        detectorRef.current = new BD({ formats: ["qr_code", "code_128"] });
      } catch { /* unsupported */ }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("@zxing/library").then((Z) => {
      if (cancelled) return;
      const reader = new Z.MultiFormatReader();
      const hints = new Map();
      // QR + Code128 as the JS fallback where BarcodeDetector isn't available.
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_128]);
      reader.setHints(hints);
      decodeBarcodeRef.current = (img) => {
        try {
          const source = new Z.RGBLuminanceSource(toGrayscale(img), img.width, img.height);
          const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
          return reader.decodeWithState(bitmap).getText();
        } catch {
          return null;
        }
      };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Shared hit handler (dedup + fire onDetect), used by both decoders.
  const handleDetected = useCallback((detected: string | null | undefined) => {
    if (!detected) return;
    const now = Date.now();
    if (detected === lastHit.current.code && now - lastHit.current.at < cooldownMs) return;
    lastHit.current = { code: detected, at: now };
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
    onDetect(detected);
    if (!continuous) { stop(); setState("idle"); }
  }, [continuous, cooldownMs, onDetect, stop]);

  // Grab a FULL-RESOLUTION still (like pressing the camera shutter) and decode it.
  // The live video feed is soft/low-res; a proper photo is what makes small QR
  // codes readable — this is the reliable "it works like the camera app" path.
  const [capturing, setCapturing] = useState(false);
  const captureAndScan = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    const video = videoRef.current;
    if (!track || !video) return;
    setCapturing(true);
    try {
      let bmp: ImageBitmap | null = null;
      const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob>; grabFrame: () => Promise<ImageBitmap> } }).ImageCapture;
      if (IC) {
        const ic = new IC(track);
        try { bmp = await createImageBitmap(await ic.takePhoto()); }
        catch { try { bmp = await ic.grabFrame(); } catch { /* fall through */ } }
      }
      if (!bmp) {
        const c = document.createElement("canvas");
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext("2d")!.drawImage(video, 0, 0);
        bmp = await createImageBitmap(c);
      }
      // show what we actually captured (to diagnose sharpness / QR presence)
      try {
        const pc = document.createElement("canvas");
        const pw = Math.min(bmp.width, 480); const ph = Math.round(bmp.height * pw / bmp.width);
        pc.width = pw; pc.height = ph;
        pc.getContext("2d")!.drawImage(bmp, 0, 0, pw, ph);
        setCapturedUrl(pc.toDataURL("image/jpeg", 0.85));
      } catch { /* ignore */ }
      // native decode on the still
      if (detectorRef.current) {
        try {
          const codes = await detectorRef.current.detect(bmp as unknown as CanvasImageSource);
          if (codes?.length) { handleDetected(codes[0].rawValue); return; }
        } catch { /* fall through to jsQR */ }
      }
      // jsQR on the still
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const cx = c.getContext("2d", { willReadFrequently: true })!;
      cx.drawImage(bmp, 0, 0);
      const id = cx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(id.data, c.width, c.height, { inversionAttempts: "attemptBoth" });
      if (code?.data) { handleDetected(code.data); return; }
      setDbg(`captured ${bmp.width}×${bmp.height} · no code — hold steadier / closer`);
    } catch (e) {
      setDbg("capture failed: " + String(e).slice(0, 40));
    } finally { setCapturing(false); }
  }, [handleDetected]);

  // MOST RELIABLE on mobile: let the phone's NATIVE camera app take the photo
  // (<input capture> launches it), then decode that full-res, properly-focused
  // JPEG. This is the same camera pipeline that already reads these QRs, so it
  // sidesteps the soft/low-res getUserMedia live feed entirely.
  const scanFromFile = useCallback(async (file: File) => {
    setCapturing(true);
    setDbg("");
    try {
      const bmp = await createImageBitmap(file);
      // show what was captured
      try {
        const pc = document.createElement("canvas");
        const pw = Math.min(bmp.width, 480); const ph = Math.round(bmp.height * pw / bmp.width);
        pc.width = pw; pc.height = ph;
        pc.getContext("2d")!.drawImage(bmp, 0, 0, pw, ph);
        setCapturedUrl(pc.toDataURL("image/jpeg", 0.85));
      } catch { /* ignore */ }
      // 1) native OS decoder on the full-res photo (best odds)
      if (detectorRef.current) {
        try {
          const codes = await detectorRef.current.detect(bmp as unknown as CanvasImageSource);
          if (codes?.length) { handleDetected(codes[0].rawValue); return; }
        } catch { /* fall through */ }
      }
      // 2) jsQR / ZXing on a canvas (cap the long side so it stays fast)
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const cw = Math.max(1, Math.round(bmp.width * scale)), ch = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const cx = c.getContext("2d", { willReadFrequently: true })!;
      cx.drawImage(bmp, 0, 0, cw, ch);
      const id = cx.getImageData(0, 0, cw, ch);
      let code = jsQR(id.data, cw, ch, { inversionAttempts: "attemptBoth" })?.data || null;
      if (!code && decodeBarcodeRef.current) code = decodeBarcodeRef.current(id);
      if (code) { handleDetected(code); return; }
      setDbg(`photo ${bmp.width}×${bmp.height} · no code — retake so the QR fills most of the frame`);
    } catch (e) {
      setDbg("photo read failed: " + String(e).slice(0, 40));
    } finally { setCapturing(false); }
  }, [handleDetected]);

  const tick = useCallback(() => {
    if (!streamRef.current) return; // stopped
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const vw = video.videoWidth, vh = video.videoHeight;
    // Crop to a centred square (the reticle) and process it at good resolution —
    // this focuses the decoders on the QR and drops background clutter/glare.
    const side = Math.floor(Math.min(vw, vh) * 0.9);
    const sx = Math.floor((vw - side) / 2), sy = Math.floor((vh - side) / 2);
    const out = Math.min(side, 1000);
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { rafRef.current = requestAnimationFrame(tick); return; }
    ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    frameCount.current++;

    // Run BOTH decoders every frame for the best odds:
    // 1) native BarcodeDetector (async, OS decoder) on the cropped canvas
    if (detectorRef.current && !detectingRef.current) {
      detectingRef.current = true;
      // detect on the full video frame (native OS decoder handles full res best)
      detectorRef.current.detect(video)
        .then((codes) => { detectingRef.current = false; if (codes?.length) { lastRawRef.current = codes[0].rawValue; handleDetected(codes[0].rawValue); } })
        .catch(() => { detectingRef.current = false; });
    }
    // 2) jsQR (+ ZXing every other frame) on the same crop
    const img = ctx.getImageData(0, 0, out, out);
    let detected = jsQR(img.data, out, out, { inversionAttempts: "attemptBoth" })?.data || null;
    if (!detected && decodeBarcodeRef.current && frameCount.current % 2 === 0) {
      detected = decodeBarcodeRef.current(img);
    }
    if (detected) { lastRawRef.current = detected; handleDetected(detected); }

    // live diagnostic (throttled): decoder · frames · has anything been read yet
    if (frameCount.current % 15 === 0) {
      setDbg(`${detectorRef.current ? "native" : "jsQR"} · f${frameCount.current} · ${lastRawRef.current ? "seen ✓" : "no code seen"}`);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [handleDetected]);

  const start = useCallback(async () => {
    setErrMsg("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      setErrMsg("Camera API not available. Use HTTPS or type the code below.");
      return;
    }
    setState("starting");
    try {
      // Back camera + request a high resolution so small QR codes carry enough
      // detail for jsQR to lock on (default 640×480 is often too coarse).
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setTorchOn(false);
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
        if (caps?.focusMode?.includes("continuous")) {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
        }
        setHasTorch(!!caps?.torch);
        const zc = (caps as { zoom?: { min: number; max: number; step: number } })?.zoom;
        if (zc && typeof zc.max === "number" && zc.max > (zc.min ?? 1)) {
          setZoomCaps({ min: zc.min, max: zc.max, step: zc.step || 0.1 });
          const target = Math.min(zc.max, 2.5); // start zoomed in so the QR is bigger
          try { await track.applyConstraints({ advanced: [{ zoom: target } as MediaTrackConstraintSet] }); setZoom(target); } catch { /* ignore */ }
        } else { setZoomCaps(null); setZoom(1); }
        const s = track.getSettings?.();
        setCamInfo(`${s?.width ?? "?"}×${s?.height ?? "?"}`);
      } catch { /* capability control not supported */ }
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
        {/* live preview of exactly what the decoder is processing (for diagnosing focus) */}
        <canvas ref={canvasRef} className={`pointer-events-none absolute bottom-2 right-2 h-24 w-24 rounded-lg border-2 border-white/80 shadow-lg ${state === "running" ? "" : "hidden"}`} />

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

      {/* NATIVE-camera photo scan — the reliable mobile path. Always available,
          works even without starting the live camera. */}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) scanFromFile(f); e.target.value = ""; }} />
      <button onClick={() => fileInputRef.current?.click()} disabled={capturing}
        className="rounded-lg bg-[var(--accent-2)] px-4 py-3 text-sm font-extrabold text-white shadow-sm hover:brightness-95 disabled:opacity-60">
        {capturing ? "Reading photo…" : "📸 Take a photo of the QR — most reliable"}
      </button>

      {state === "running" && (
        <button onClick={captureAndScan} disabled={capturing}
          className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-extrabold text-white shadow-sm hover:bg-[var(--accent-strong)] disabled:opacity-60">
          {capturing ? "Capturing…" : "📷 Capture & scan (if live scan won't catch it)"}
        </button>
      )}

      {state === "running" && zoomCaps && (
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          🔍 Zoom
          <input type="range" min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step || 0.1}
            value={zoom} onChange={(e) => applyZoom(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
          <span className="tabular-nums">{zoom.toFixed(1)}×</span>
        </label>
      )}

      {state === "running" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2 font-semibold text-[var(--accent-2)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-2)]" />
            Scanning{continuous ? " (continuous)" : ""}…
            {(dbg || camInfo) && <span className="font-normal text-[var(--muted-2)]">· {camInfo}{dbg ? ` · ${dbg}` : ""}</span>}
          </span>
          <span className="flex gap-2">
            {hasTorch && (
              <button onClick={toggleTorch}
                className={`rounded-md border px-3 py-1 font-semibold ${torchOn ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-strong)]" : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]"}`}>
                🔦 {torchOn ? "On" : "Flash"}
              </button>
            )}
            <button
              onClick={() => { stop(); setState("idle"); }}
              className="rounded-md border border-[var(--border)] px-3 py-1 font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)]"
            >
              Stop
            </button>
          </span>
        </div>
      )}

      {capturedUrl && (
        <div className="rounded-lg border border-[var(--border)] p-2">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-[var(--muted)]">
            <span>Captured photo (what the decoder saw){dbg ? ` — ${dbg}` : ""}</span>
            <button onClick={() => setCapturedUrl(null)} className="text-[var(--accent)]">clear</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedUrl} alt="captured" className="w-full rounded" />
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
          placeholder="Or type / paste a code (QR SQR-… or barcode HH74007-S)"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">
          Enter
        </button>
      </form>
    </div>
  );
}
