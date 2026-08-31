export const ROBLOX_SHIRT_WIDTH = 585;
export const ROBLOX_SHIRT_HEIGHT = 559;

export interface ShirtTextureSnapshot {
  canvas: HTMLCanvasElement;
  revision: number;
}

export function validateShirtDimensions(width: number, height: number): string | null {
  if (width !== ROBLOX_SHIRT_WIDTH || height !== ROBLOX_SHIRT_HEIGHT) {
    return `Roblox classic shirts must be ${ROBLOX_SHIRT_WIDTH} × ${ROBLOX_SHIRT_HEIGHT}px.`;
  }
  return null;
}

interface TemplateRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
}

const TEMPLATE_REGIONS: TemplateRegion[] = [
  { x: 231, y: 10, width: 128, height: 64, label: "UP", color: "#159fe8" },
  { x: 167, y: 74, width: 64, height: 128, label: "R", color: "#00a85a" },
  { x: 231, y: 74, width: 128, height: 128, label: "FRONT", color: "#ee2b2b" },
  { x: 359, y: 74, width: 64, height: 128, label: "L", color: "#f2b600" },
  { x: 423, y: 74, width: 128, height: 128, label: "BACK", color: "#0879b9" },
  { x: 231, y: 202, width: 128, height: 64, label: "DOWN", color: "#f27b12" },

  { x: 214, y: 291, width: 64, height: 64, label: "U", color: "#159fe8" },
  { x: 19, y: 355, width: 65, height: 128, label: "L", color: "#f2b600" },
  { x: 84, y: 355, width: 65, height: 128, label: "B", color: "#0879b9" },
  { x: 149, y: 355, width: 65, height: 128, label: "R", color: "#00a85a" },
  { x: 214, y: 355, width: 64, height: 128, label: "F", color: "#ee2b2b" },
  { x: 214, y: 483, width: 64, height: 64, label: "D", color: "#f27b12" },

  { x: 307, y: 291, width: 64, height: 64, label: "U", color: "#159fe8" },
  { x: 307, y: 355, width: 65, height: 128, label: "F", color: "#ee2b2b" },
  { x: 372, y: 355, width: 65, height: 128, label: "L", color: "#f2b600" },
  { x: 437, y: 355, width: 65, height: 128, label: "B", color: "#0879b9" },
  { x: 502, y: 355, width: 65, height: 128, label: "R", color: "#00a85a" },
  { x: 307, y: 483, width: 64, height: 64, label: "D", color: "#f27b12" },
];

export function drawRobloxShirtGuide(context: CanvasRenderingContext2D): void {
  context.save();
  context.globalAlpha = 0.4;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "600 22px Arial, sans-serif";
  context.lineWidth = 2;

  for (const region of TEMPLATE_REGIONS) {
    context.fillStyle = region.color;
    context.fillRect(region.x, region.y, region.width, region.height);
    context.strokeStyle = "#1f2937";
    context.setLineDash([6, 4]);
    context.strokeRect(region.x, region.y, region.width, region.height);
    context.setLineDash([]);
    context.fillStyle = "#ffffff";
    context.fillText(region.label, region.x + region.width / 2, region.y + region.height / 2);
  }

  context.globalAlpha = 0.72;
  context.fillStyle = "#262626";
  context.font = "600 20px Arial, sans-serif";
  context.fillText("TORSO", 458, 40);
  context.fillText("RIGHT ARM", 102, 320);
  context.fillText("LEFT ARM", 483, 320);
  context.restore();
}
