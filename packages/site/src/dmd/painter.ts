import { DMD_H, DMD_W, type Frame } from "./frame.js";
import { levelAlpha } from "./palette.js";

const PITCH = 3;
const RADIUS = 1.15;

// Width-independent paint loop: any Frame of `width * height` intensity
// bytes at PITCH-px dot spacing. paintFrame (below) is the 64x32 DMD
// station-glyph specialization; the journey map reuses this same primitive
// at JOURNEY_W x JOURNEY_H instead of duplicating the pixel loop.
export function paintGrid(
  canvas: HTMLCanvasElement,
  frame: Frame,
  width: number,
  height: number,
  accent: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / unsupported
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = frame[y * width + x] ?? 0;
      if (v === 0) continue;
      ctx.globalAlpha = levelAlpha[v] ?? 1;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x * PITCH + PITCH / 2, y * PITCH + PITCH / 2, RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function paintFrame(canvas: HTMLCanvasElement, frame: Frame, accent: string): void {
  paintGrid(canvas, frame, DMD_W, DMD_H, accent);
}
