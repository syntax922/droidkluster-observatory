import { DMD_H, DMD_W, type Frame } from "./frame.js";
import { levelAlpha } from "./palette.js";

const PITCH = 3;
const RADIUS = 1.15;

export function paintFrame(canvas: HTMLCanvasElement, frame: Frame, accent: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / unsupported
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < DMD_H; y++) {
    for (let x = 0; x < DMD_W; x++) {
      const v = frame[y * DMD_W + x] ?? 0;
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
