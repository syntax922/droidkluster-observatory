export const DMD_W = 64;
export const DMD_H = 32;
export type Frame = Uint8Array;

export function blank(): Frame {
  return new Uint8Array(DMD_W * DMD_H);
}

export function px(f: Frame, x: number, y: number, v: number): void {
  if (x < 0 || x >= DMD_W || y < 0 || y >= DMD_H) return;
  const i = y * DMD_W + x;
  if (v > (f[i] ?? 0)) f[i] = v;
}

export function hline(f: Frame, x0: number, x1: number, y: number, v: number): void {
  for (let x = x0; x <= x1; x++) px(f, x, y, v);
}

export function vline(f: Frame, x: number, y0: number, y1: number, v: number): void {
  for (let y = y0; y <= y1; y++) px(f, x, y, v);
}

export function rect(f: Frame, x: number, y: number, w: number, h: number, v: number): void {
  hline(f, x, x + w - 1, y, v);
  hline(f, x, x + w - 1, y + h - 1, v);
  vline(f, x, y, y + h - 1, v);
  vline(f, x + w - 1, y, y + h - 1, v);
}

export function fillRect(f: Frame, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++) hline(f, x, x + w - 1, yy, v);
}
