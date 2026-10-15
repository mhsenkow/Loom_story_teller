// Column picker placement within the visible viewport, including the mobile keyboard.

export function placeColumnPicker(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { left: number; top: number; width: number; height: number },
): {
  left: number;
  top: number;
  width: number;
  maxH: number;
  upwards: boolean;
} {
  const inset = 8;
  const gap = 4;
  const desiredHeight = 380;
  const minLeft = viewport.left + inset;
  const minTop = viewport.top + inset;
  const bottom = viewport.top + viewport.height - inset;
  const width = Math.min(
    Math.max(anchor.width, 220),
    Math.max(0, viewport.width - inset * 2),
  );
  const left = Math.max(
    minLeft,
    Math.min(anchor.left, viewport.left + viewport.width - inset - width),
  );
  const below = Math.max(0, bottom - Math.max(minTop, anchor.bottom + gap));
  const above = Math.max(0, Math.min(bottom, anchor.top - gap) - minTop);
  const upwards = below < desiredHeight && above > below;
  const maxH = Math.min(desiredHeight, upwards ? above : below);
  const top = upwards
    ? Math.min(bottom, anchor.top - gap) - maxH
    : Math.max(minTop, Math.min(anchor.bottom + gap, bottom));
  return { left, top, width, maxH, upwards };
}
