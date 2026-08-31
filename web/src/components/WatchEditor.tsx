"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeWatchCrop,
  computeWrappedWatchGeometry,
  drawWatchShape,
  type Point,
  validateWatchGeometry,
} from "@/lib/watchGeometry";
import {
  drawRobloxShirtGuide,
  ROBLOX_SHIRT_HEIGHT,
  ROBLOX_SHIRT_WIDTH,
  type ShirtTextureSnapshot,
  validateShirtDimensions,
} from "@/lib/shirtTexture";

type Guide = { start: Point; end: Point };
type DragTarget = "start" | "end" | "new" | null;

interface WatchEditorProps {
  onTextureCommit?: (snapshot: ShirtTextureSnapshot) => void;
}

const MODEL_SIZE = 512;

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode canvas"))),
      "image/png",
    );
  });
}

function blobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode that image"));
    };
    image.src = url;
  });
}

export default function WatchEditor({ onTextureCommit }: WatchEditorProps) {
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const committedRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragTargetRef = useRef<DragTarget>(null);
  const undoRef = useRef<ImageData | null>(null);
  const revisionRef = useRef(0);
  const renderRef = useRef<(nextGuide: Guide | null) => void>(() => {});
  const [guide, setGuide] = useState<Guide | null>(null);
  const [fileName, setFileName] = useState("roblox-shirt.png");
  const [status, setStatus] = useState("Draw one line across an arm panel where the watch should sit.");
  const [generating, setGenerating] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [showTemplate, setShowTemplate] = useState(true);
  const [watchSize, setWatchSize] = useState(50);
  const [bandWidth, setBandWidth] = useState(22);
  const [bandWrap, setBandWrap] = useState(0);

  const commitTexture = useCallback(() => {
    const canvas = committedRef.current;
    if (!canvas || !onTextureCommit) return;
    revisionRef.current += 1;
    onTextureCommit({ canvas, revision: revisionRef.current });
  }, [onTextureCommit]);

  const geometryForGuide = useCallback(
    (nextGuide: Guide) =>
      computeWrappedWatchGeometry(nextGuide.start, nextGuide.end, {
        faceDiameter: watchSize,
        strapWidth: bandWidth,
        wrapOffset: bandWrap,
      }),
    [bandWidth, bandWrap, watchSize],
  );

  const render = useCallback(
    (nextGuide: Guide | null) => {
      const display = displayRef.current;
      const committed = committedRef.current;
      if (!display || !committed) return;
      display.width = committed.width;
      display.height = committed.height;
      const context = display.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, display.width, display.height);
      context.drawImage(committed, 0, 0);

      if (showTemplate) drawRobloxShirtGuide(context);
      if (!nextGuide) return;

      const geometry = geometryForGuide(nextGuide);
      if (geometry) drawWatchShape(context, geometry, "sketch");
      const validation = geometry
        ? validateWatchGeometry(geometry, display.width, display.height)
        : "Draw the guide inside the colored side row of either arm.";

      context.save();
      context.strokeStyle = validation ? "#dc2626" : "#2563eb";
      context.fillStyle = validation ? "#dc2626" : "#2563eb";
      context.lineWidth = 2;
      context.setLineDash([6, 5]);
      context.beginPath();
      context.moveTo(nextGuide.start.x, nextGuide.start.y);
      context.lineTo(nextGuide.end.x, nextGuide.end.y);
      context.stroke();
      context.setLineDash([]);
      for (const point of [nextGuide.start, nextGuide.end]) {
        context.beginPath();
        context.arc(point.x, point.y, 6, 0, Math.PI * 2);
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#ffffff";
        context.stroke();
      }
      context.restore();
    },
    [geometryForGuide, showTemplate],
  );
  renderRef.current = render;

  const initializeDefault = useCallback(() => {
    const committed = document.createElement("canvas");
    committed.width = ROBLOX_SHIRT_WIDTH;
    committed.height = ROBLOX_SHIRT_HEIGHT;
    const context = committed.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.fillStyle = "#e9e3d9";
    context.fillRect(0, 0, committed.width, committed.height);
    committedRef.current = committed;
    setFileName("roblox-shirt.png");
    setGuide(null);
    undoRef.current = null;
    setCanUndo(false);
    setStatus("Draw one line across an arm panel where the watch should sit.");
    commitTexture();
    requestAnimationFrame(() => renderRef.current(null));
  }, [commitTexture]);

  useEffect(() => initializeDefault(), [initializeDefault]);
  useEffect(() => render(guide), [guide, render]);

  const nativePoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * canvas.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * canvas.height),
    };
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (generating) return;
    const point = nativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const grabRadius = 14;
    if (guide && Math.hypot(point.x - guide.start.x, point.y - guide.start.y) <= grabRadius) {
      dragTargetRef.current = "start";
      return;
    }
    if (guide && Math.hypot(point.x - guide.end.x, point.y - guide.end.y) <= grabRadius) {
      dragTargetRef.current = "end";
      return;
    }
    dragTargetRef.current = "new";
    setGuide({ start: point, end: point });
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const target = dragTargetRef.current;
    if (!target) return;
    const point = nativePoint(event);
    setGuide((current) => {
      if (!current) return { start: point, end: point };
      if (target === "start") return { ...current, start: point };
      return { ...current, end: point };
    });
  };

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragTargetRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    if (!guide) return;
    const geometry = geometryForGuide(guide);
    setStatus(
      (geometry
        ? validateWatchGeometry(geometry, ROBLOX_SHIRT_WIDTH, ROBLOX_SHIRT_HEIGHT)
        : "Draw the guide inside the colored side row of either arm.") ||
        "Watch shape ready. Generate to finish it with AI.",
    );
  };

  const importTexture = async (file: File) => {
    try {
      const image = await blobImage(file);
      const validation = validateShirtDimensions(image.naturalWidth, image.naturalHeight);
      if (validation) throw new Error(validation);
      const committed = document.createElement("canvas");
      committed.width = ROBLOX_SHIRT_WIDTH;
      committed.height = ROBLOX_SHIRT_HEIGHT;
      const context = committed.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(image, 0, 0);
      committedRef.current = committed;
      setFileName(file.name);
      setGuide(null);
      undoRef.current = null;
      setCanUndo(false);
      setStatus("Texture loaded. Draw one line across an arm panel.");
      commitTexture();
      requestAnimationFrame(() => render(null));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load that texture.");
    }
  };

  const generate = async () => {
    const committed = committedRef.current;
    if (!committed || !guide) return;
    const geometry = geometryForGuide(guide);
    if (!geometry) {
      setStatus("Draw the guide inside the colored side row of either arm.");
      return;
    }
    const validation = validateWatchGeometry(geometry, committed.width, committed.height);
    if (validation) {
      setStatus(validation);
      return;
    }

    setGenerating(true);
    setStatus("Preparing the watch shape…");
    try {
      const crop = computeWatchCrop(geometry, committed.width, committed.height);
      const scale = MODEL_SIZE / crop.size;
      const prepared = document.createElement("canvas");
      prepared.width = MODEL_SIZE;
      prepared.height = MODEL_SIZE;
      const preparedContext = prepared.getContext("2d");
      if (!preparedContext) throw new Error("Canvas is unavailable");
      preparedContext.drawImage(committed, crop.x, crop.y, crop.size, crop.size, 0, 0, MODEL_SIZE, MODEL_SIZE);
      preparedContext.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
      drawWatchShape(preparedContext, geometry, "sketch");
      preparedContext.resetTransform();

      const mask = document.createElement("canvas");
      mask.width = MODEL_SIZE;
      mask.height = MODEL_SIZE;
      const maskContext = mask.getContext("2d");
      if (!maskContext) throw new Error("Canvas is unavailable");
      maskContext.fillStyle = "#000000";
      maskContext.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
      maskContext.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
      drawWatchShape(maskContext, geometry, "mask");
      maskContext.resetTransform();

      const form = new FormData();
      form.append("image", new File([await canvasBlob(prepared)], "watch-input.png", { type: "image/png" }));
      form.append("mask", new File([await canvasBlob(mask)], "watch-mask.png", { type: "image/png" }));

      setStatus("AI is finishing the watch…");
      const response = await fetch("/api/watch_render", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()).slice(0, 220));
      const generated = await blobImage(await response.blob());

      const committedContext = committed.getContext("2d", { willReadFrequently: true });
      if (!committedContext) throw new Error("Canvas is unavailable");
      undoRef.current = committedContext.getImageData(0, 0, committed.width, committed.height);

      const nativeMask = document.createElement("canvas");
      nativeMask.width = committed.width;
      nativeMask.height = committed.height;
      const nativeMaskContext = nativeMask.getContext("2d");
      if (!nativeMaskContext) throw new Error("Canvas is unavailable");
      drawWatchShape(nativeMaskContext, geometry, "mask");

      const patch = document.createElement("canvas");
      patch.width = committed.width;
      patch.height = committed.height;
      const patchContext = patch.getContext("2d");
      if (!patchContext) throw new Error("Canvas is unavailable");
      patchContext.drawImage(generated, crop.x, crop.y, crop.size, crop.size);
      patchContext.globalCompositeOperation = "destination-in";
      patchContext.drawImage(nativeMask, 0, 0);
      patchContext.globalCompositeOperation = "source-over";
      committedContext.drawImage(patch, 0, 0);

      setCanUndo(true);
      setGuide(null);
      setStatus("Watch applied to the shirt and the 3D preview.");
      commitTexture();
      render(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Watch generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const undo = () => {
    const committed = committedRef.current;
    const snapshot = undoRef.current;
    const context = committed?.getContext("2d");
    if (!committed || !context || !snapshot) return;
    context.putImageData(snapshot, 0, 0);
    undoRef.current = null;
    setCanUndo(false);
    setStatus("Last watch removed from both previews.");
    commitTexture();
    render(guide);
  };

  const exportTexture = async () => {
    const committed = committedRef.current;
    if (!committed) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await canvasBlob(committed));
    link.download = fileName.replace(/\.[^.]+$/, "") + "-with-watch.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const currentGeometry = guide ? geometryForGuide(guide) : null;
  const valid = currentGeometry
    ? !validateWatchGeometry(currentGeometry, ROBLOX_SHIRT_WIDTH, ROBLOX_SHIRT_HEIGHT)
    : false;

  const controlClass =
    "rounded-md border border-black/10 px-3 py-1.5 text-xs sm:text-sm bg-white/80 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 backdrop-blur";

  return (
    <section className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button className={controlClass} onClick={() => fileRef.current?.click()}>
          🧥 Apply Shirt
        </button>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importTexture(file);
            event.currentTarget.value = "";
          }}
        />
        <button className={controlClass} disabled={!valid || generating} onClick={() => void generate()}>
          {generating ? "Generating…" : "✨ Generate Watch"}
        </button>
        <button className={controlClass} disabled={!canUndo || generating} onClick={undo}>Undo</button>
        <button className={controlClass} onClick={() => void exportTexture()}>Export PNG</button>
        <button className={controlClass} onClick={() => { setGuide(null); setStatus("Draw one line across an arm panel where the watch should sit."); }}>Clear</button>
      </div>

      <div className="relative overflow-hidden rounded-md border border-black/10 bg-[#c3c3c3] p-2">
        <div className="flex min-h-[390px] items-center justify-center overflow-auto">
          <canvas
            ref={displayRef}
            aria-label="Roblox shirt texture editor"
            className="max-h-[62vh] max-w-full cursor-crosshair touch-none bg-white [image-rendering:pixelated]"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
          />
        </div>
        <span className="pointer-events-none absolute bottom-2 left-2 max-w-[80%] rounded-md bg-black/50 px-2 py-1 text-[10px] text-white sm:text-xs" role="status" aria-live="polite">
          {status}
        </span>
      </div>

      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        <label className="rounded-md border border-black/10 bg-white/70 px-2 py-1.5">
          <span className="flex justify-between"><span>Band wrap</span><span>{bandWrap > 0 ? "+" : ""}{bandWrap}px</span></span>
          <input className="w-full accent-black" type="range" min="-130" max="130" value={bandWrap} onChange={(event) => setBandWrap(Number(event.target.value))} />
        </label>
        <label className="rounded-md border border-black/10 bg-white/70 px-2 py-1.5">
          <span className="flex justify-between"><span>Band width</span><span>{bandWidth}px</span></span>
          <input className="w-full accent-black" type="range" min="8" max="36" value={bandWidth} onChange={(event) => setBandWidth(Number(event.target.value))} />
        </label>
        <label className="rounded-md border border-black/10 bg-white/70 px-2 py-1.5">
          <span className="flex justify-between"><span>Watch size</span><span>{watchSize}px</span></span>
          <input className="w-full accent-black" type="range" min="28" max="76" value={watchSize} onChange={(event) => setWatchSize(Number(event.target.value))} />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-black/60">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={showTemplate} onChange={(event) => setShowTemplate(event.target.checked)} />
          Show template guide
        </label>
        <button className="underline underline-offset-4" onClick={initializeDefault}>Reset shirt</button>
      </div>
    </section>
  );
}
