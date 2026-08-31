export interface Point {
  x: number;
  y: number;
}

export interface WatchGeometry {
  start: Point;
  end: Point;
  center: Point;
  angle: number;
  length: number;
  faceDiameter: number;
  strapWidth: number;
  guideLength?: number;
  faceCenters?: Point[];
  clipRect?: { x: number; y: number; width: number; height: number };
  bounds: { left: number; top: number; right: number; bottom: number };
}

export interface CropRect {
  x: number;
  y: number;
  size: number;
}

export const WATCH_FACE_DIAMETER = 50;
export const WATCH_STRAP_WIDTH = 22;
export const MIN_GUIDE_LENGTH = 70;
export const WATCH_CROP_PADDING = 25;

export interface WrappedWatchOptions {
  faceDiameter: number;
  strapWidth: number;
  wrapOffset: number;
}

export interface ArmStrip {
  arm: "right" | "left";
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ARM_STRIPS: ArmStrip[] = [
  { arm: "right", x: 19, y: 355, width: 259, height: 128 },
  { arm: "left", x: 307, y: 355, width: 260, height: 128 },
];

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function armStripAt(point: Point): ArmStrip | null {
  return (
    ARM_STRIPS.find(
      (strip) =>
        point.x >= strip.x &&
        point.x <= strip.x + strip.width &&
        point.y >= strip.y &&
        point.y <= strip.y + strip.height,
    ) || null
  );
}

export function computeWrappedWatchGeometry(
  start: Point,
  end: Point,
  options: WrappedWatchOptions,
): WatchGeometry | null {
  const anchor = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const strip = armStripAt(anchor);
  if (!strip) return null;

  const guideLength = Math.hypot(end.x - start.x, end.y - start.y);
  const radius = options.faceDiameter / 2;
  const localFaceX = modulo(anchor.x - strip.x + options.wrapOffset, strip.width);
  const center = { x: strip.x + localFaceX, y: anchor.y };
  const faceCenters = [center];

  if (center.x - radius < strip.x) {
    faceCenters.push({ x: center.x + strip.width, y: center.y });
  }
  if (center.x + radius > strip.x + strip.width) {
    faceCenters.push({ x: center.x - strip.width, y: center.y });
  }

  return {
    start: { x: strip.x, y: anchor.y },
    end: { x: strip.x + strip.width, y: anchor.y },
    center,
    angle: 0,
    length: strip.width,
    guideLength,
    faceDiameter: options.faceDiameter,
    strapWidth: options.strapWidth,
    faceCenters,
    clipRect: strip,
    bounds: {
      left: strip.x,
      top: anchor.y - Math.max(radius, options.strapWidth / 2),
      right: strip.x + strip.width,
      bottom: anchor.y + Math.max(radius, options.strapWidth / 2),
    },
  };
}

export function computeWatchGeometry(start: Point, end: Point): WatchGeometry {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const radius = WATCH_FACE_DIAMETER / 2;
  const strapRadius = WATCH_STRAP_WIDTH / 2;

  return {
    start,
    end,
    center,
    angle: Math.atan2(dy, dx),
    length,
    faceDiameter: WATCH_FACE_DIAMETER,
    strapWidth: WATCH_STRAP_WIDTH,
    bounds: {
      left: Math.min(start.x - strapRadius, end.x - strapRadius, center.x - radius),
      top: Math.min(start.y - strapRadius, end.y - strapRadius, center.y - radius),
      right: Math.max(start.x + strapRadius, end.x + strapRadius, center.x + radius),
      bottom: Math.max(start.y + strapRadius, end.y + strapRadius, center.y + radius),
    },
  };
}

export function validateWatchGeometry(
  geometry: WatchGeometry,
  textureWidth: number,
  textureHeight: number,
): string | null {
  if ((geometry.guideLength ?? geometry.length) < MIN_GUIDE_LENGTH) {
    return `Draw a guide at least ${MIN_GUIDE_LENGTH} pixels long.`;
  }
  if (
    geometry.clipRect &&
    (geometry.bounds.top < geometry.clipRect.y ||
      geometry.bounds.bottom > geometry.clipRect.y + geometry.clipRect.height)
  ) {
    return "Move the guide vertically so the watch fits inside the arm panels.";
  }
  if (
    geometry.bounds.left < 0 ||
    geometry.bounds.top < 0 ||
    geometry.bounds.right > textureWidth ||
    geometry.bounds.bottom > textureHeight
  ) {
    return "Move the guide inward so the entire watch fits on the texture.";
  }
  return null;
}

export function computeWatchCrop(
  geometry: WatchGeometry,
  textureWidth: number,
  textureHeight: number,
): CropRect {
  const contentWidth = geometry.bounds.right - geometry.bounds.left;
  const contentHeight = geometry.bounds.bottom - geometry.bounds.top;
  const requestedSize = Math.ceil(Math.max(contentWidth, contentHeight) + WATCH_CROP_PADDING * 2);
  const size = Math.min(Math.max(requestedSize, 64), textureWidth, textureHeight);
  const boundsCenterX = (geometry.bounds.left + geometry.bounds.right) / 2;
  const boundsCenterY = (geometry.bounds.top + geometry.bounds.bottom) / 2;
  const desiredX = Math.round(boundsCenterX - size / 2);
  const desiredY = Math.round(boundsCenterY - size / 2);
  return {
    x: Math.max(0, Math.min(desiredX, textureWidth - size)),
    y: Math.max(0, Math.min(desiredY, textureHeight - size)),
    size,
  };
}

export function drawWatchShape(
  context: CanvasRenderingContext2D,
  geometry: WatchGeometry,
  mode: "sketch" | "mask",
): void {
  context.save();
  if (geometry.clipRect) {
    context.beginPath();
    context.rect(
      geometry.clipRect.x,
      geometry.clipRect.y,
      geometry.clipRect.width,
      geometry.clipRect.height,
    );
    context.clip();
  }
  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();
  context.moveTo(geometry.start.x, geometry.start.y);
  context.lineTo(geometry.end.x, geometry.end.y);
  context.lineWidth = geometry.strapWidth;
  context.strokeStyle = mode === "mask" ? "#ffffff" : "#777d86";
  context.stroke();

  for (const center of geometry.faceCenters || [geometry.center]) {
    context.beginPath();
    context.arc(center.x, center.y, geometry.faceDiameter / 2, 0, Math.PI * 2);
    context.fillStyle = mode === "mask" ? "#ffffff" : "#c7cbd1";
    context.fill();
    if (mode === "sketch") {
      context.lineWidth = Math.max(2, geometry.faceDiameter * 0.08);
      context.strokeStyle = "#50545b";
      context.stroke();
    }
  }
  context.restore();
}
