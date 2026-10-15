"use client";

// Explicit layout editing keeps chart navigation and mark selection independent of handles.
import { useEffect, useRef, useState } from "react";
import type { ChartChromeLayout, ChartChromeRect } from "@/lib/chartChromeLink";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";
import {
  clamp,
  annotationRect,
  arrangedFrameSize,
  manipulateRect,
  constrainRect,
  type CanvasAnnotation,
  type ResizeHandle,
} from "@/lib/canvasArrangement";

export type ArrangeChange =
  | { visual: ChartVisualOverrides }
  | {
      annotation: {
        id: string;
        x: number;
        y: number;
        width: number;
        fontSize: number;
      };
    };
type Target = {
  id: string;
  label: string;
  rect: ChartChromeRect;
  bounds: ChartChromeRect;
  minW: number;
  minH: number;
};

type Props = {
  width: number;
  height: number;
  contentHeight: number;
  frameInset?: number;
  frameMax: { width: number; height: number; aspectLocked: boolean };
  layout: ChartChromeLayout;
  visual: ChartVisualOverrides;
  annotations: CanvasAnnotation[];
  allowPlot: boolean;
  onPreview: (change: ArrangeChange | null) => void;
  onCommit: (change: ArrangeChange, group?: string) => void;
  onDone: () => void;
};

export function CanvasArrangeOverlay(p: Props) {
  const [selected, setSelected] = useState("title");
  const [draft, setDraft] = useState<{
    id: string;
    rect: ChartChromeRect;
  } | null>(null);
  const gesture = useRef<{
    target: Target;
    handle: ResizeHandle;
    x: number;
    y: number;
    rect: ChartChromeRect;
    pointer: number;
    element: HTMLElement;
    changed: boolean;
    result?: ChartChromeRect;
    change?: ArrangeChange;
    toChange: (r: ChartChromeRect) => ArrangeChange;
  } | null>(null);
  const raf = useRef<number | null>(null);
  const callbacks = useRef(p);
  callbacks.current = p;
  const canvas = {
    x: 4,
    y: 4,
    w: Math.max(40, p.width - 8),
    h: Math.max(24, p.height - 8),
  };
  const targets: Target[] = [
    {
      id: "frame",
      label: "Canvas",
      rect: { x: 0, y: 0, w: p.width, h: p.height },
      bounds: {
        x: 0,
        y: 0,
        w: p.frameMax.width - (p.frameInset ?? 0),
        h: p.frameMax.height - (p.frameInset ?? 0),
      },
      minW: Math.min(240, p.frameMax.width),
      minH: Math.min(200, p.frameMax.height),
    },
    ...(p.allowPlot
      ? [
          {
            id: "plot",
            label: "Plot",
            rect: p.layout.plotEdit ?? p.layout.plot,
            bounds: {
              x: Math.min(52, p.width * 0.16),
              y: 32,
              w: p.width - Math.min(52, p.width * 0.16) - 16,
              h: Math.max(40, p.contentHeight - 80),
            },
            minW: Math.min(120, p.width * 0.4),
            minH: Math.min(100, p.contentHeight * 0.4),
          },
        ]
      : []),
    ...(p.layout.title
      ? [
          {
            id: "title",
            label: "Title & subtitle",
            rect: p.layout.title,
            bounds: canvas,
            minW: Math.min(100, p.width * 0.4),
            minH: 40,
          },
        ]
      : []),
    ...(p.layout.legend
      ? [
          {
            id: "legend",
            label: "Legend",
            rect: p.layout.legend,
            bounds: p.layout.plot,
            minW: 76,
            minH: 64,
          },
        ]
      : []),
    ...p.annotations.map((a) => ({
      id: `note:${a.id}`,
      label: `Note: ${a.text.slice(0, 24)}`,
      rect: annotationRect(a, p.width, p.height),
      bounds: canvas,
      minW: 64,
      minH: 24,
    })),
  ];

  const changeFor = (
    t: Target,
    r: ChartChromeRect,
    handle: ResizeHandle = "move",
  ): ArrangeChange => {
    if (t.id.startsWith("note:")) {
      const a = p.annotations.find((a) => `note:${a.id}` === t.id)!;
      const note = {
        ...a,
        x: (r.x + r.w / 2) / p.width,
        y: (r.y + r.h / 2) / p.height,
        width: clamp(r.w / p.width, 0.1, 0.9),
        fontSize:
          handle === "s" || handle === "se"
            ? clamp(((a.fontSize ?? 11) * r.h) / t.rect.h, 10, 32)
            : (a.fontSize ?? 11),
      };
      let actual = annotationRect(note, p.width, p.height);
      while (actual.h > canvas.h && note.fontSize > 10) {
        note.fontSize = Math.max(10, note.fontSize - 0.5);
        actual = annotationRect(note, p.width, p.height);
      }
      const fitted = constrainRect(actual, canvas, 64, 24);
      return {
        annotation: {
          id: note.id,
          x: (fitted.x + actual.w / 2) / p.width,
          y: (fitted.y + actual.h / 2) / p.height,
          width: note.width,
          fontSize: note.fontSize,
        },
      };
    }
    if (t.id === "frame") {
      let x = (r.w + (p.frameInset ?? 0)) / p.frameMax.width,
        y = (r.h + (p.frameInset ?? 0)) / p.frameMax.height;
      if (p.frameMax.aspectLocked)
        x = y =
          Math.abs(x - (p.width + (p.frameInset ?? 0)) / p.frameMax.width) >
          Math.abs(y - (p.height + (p.frameInset ?? 0)) / p.frameMax.height)
            ? x
            : y;
      return {
        visual: {
          canvasWidth: clamp(x, 0.35, 1),
          canvasHeight: clamp(y, 0.35, 1),
        },
      };
    }
    if (t.id === "plot")
      return {
        visual: {
          plotX: r.x / p.width,
          plotY: r.y / p.contentHeight,
          plotWidth: r.w / p.width,
          plotHeight: r.h / p.contentHeight,
        },
      };
    if (t.id === "title")
      return {
        visual: {
          titleX: r.x / p.width,
          titleY: r.y / p.contentHeight,
          titleWidth: r.w / p.width,
          titleScale: clamp(
            ((p.visual.titleScale ?? 1) * r.h) / t.rect.h,
            0.7,
            2.5,
          ),
        },
      };
    const plot = p.layout.plot;
    return {
      visual: {
        legendPosition: "custom",
        legendOffsetX: clamp((r.x - plot.x) / Math.max(1, plot.w - r.w), 0, 1),
        legendOffsetY: clamp((r.y - plot.y) / Math.max(1, plot.h - r.h), 0, 1),
        legendWidth: r.w / p.width,
        legendHeight: r.h / p.contentHeight,
      },
    };
  };
  const cancel = () => {
    const g = gesture.current;
    gesture.current = null;
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (g?.element.hasPointerCapture?.(g.pointer))
      g.element.releasePointerCapture(g.pointer);
    setDraft(null);
    callbacks.current.onPreview(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        !gesture.current &&
        e.target instanceof Element &&
        e.target.closest(
          'input,textarea,[contenteditable="true"],[role="dialog"],[aria-modal="true"]',
        )
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      if (gesture.current) cancel();
      else callbacks.current.onDone();
    };
    const blur = () => {
      if (gesture.current) cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
      if (raf.current != null) cancelAnimationFrame(raf.current);
      callbacks.current.onPreview(null);
    };
  }, []);

  const start = (
    e: React.PointerEvent<HTMLElement>,
    t: Target,
    handle: ResizeHandle,
  ) => {
    if (e.button !== 0 || e.isPrimary === false || gesture.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(t.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      target: t,
      handle,
      x: e.clientX,
      y: e.clientY,
      rect: t.rect,
      pointer: e.pointerId,
      element: e.currentTarget,
      changed: false,
      toChange: (r) => changeFor(t, r, handle),
    };
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (!g.changed && Math.hypot(dx, dy) < 3) return;
    g.changed = true;
    const r = manipulateRect(
      g.rect,
      g.handle,
      dx,
      dy,
      g.target.bounds,
      !e.altKey,
      g.target.minW,
      g.target.minH,
    );
    // Build against the original geometry, so scaling does not compound during a drag.
    g.result = r;
    g.change = g.toChange(r);
    const change = g.change;
    const nextRect =
      "annotation" in change
        ? annotationRect(
            {
              ...p.annotations.find((a) => a.id === change.annotation.id)!,
              ...change.annotation,
            },
            p.width,
            p.height,
          )
        : r;
    let visibleRect = nextRect;
    if ("visual" in change && g.target.id === "title")
      visibleRect = {
        ...r,
        h: Math.min(p.height - 8, 58 * (change.visual.titleScale ?? 1)),
      };
    if ("visual" in change && g.target.id === "frame") {
      const size = arrangedFrameSize(p.frameMax, change.visual);
      visibleRect = {
        x: 0,
        y: 0,
        w: size.width - (p.frameInset ?? 0),
        h: size.height - (p.frameInset ?? 0),
      };
    }
    setDraft({ id: g.target.id, rect: visibleRect });
    if (raf.current == null)
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        if (gesture.current?.change)
          callbacks.current.onPreview(gesture.current.change);
      });
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    e.stopPropagation();
    move(e);
    const change = g.change;
    const changed =
      g.result &&
      (["x", "y", "w", "h"] as const).some(
        (k) => Math.abs(g.result![k] - g.rect[k]) > 0.1,
      );
    cancel();
    if (g.changed && changed && change) p.onCommit(change);
  };
  const keyboard = (e: React.KeyboardEvent<HTMLElement>, t: Target) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
    const dx =
      e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    const handle = e.ctrlKey || e.metaKey || t.id === "frame" ? "se" : "move";
    const r = manipulateRect(
      t.rect,
      handle,
      dx,
      dy,
      t.bounds,
      false,
      t.minW,
      t.minH,
    );
    if (
      (["x", "y", "w", "h"] as const).every(
        (k) => Math.abs(r[k] - t.rect[k]) < 0.1,
      )
    )
      return;
    p.onCommit(changeFor(t, r, handle), `arrange:${t.id}`);
  };
  return (
    <div
      className="absolute inset-0 z-30 pointer-events-none"
      aria-label="Canvas arrangement"
    >
      {targets.map((t) => {
        const r = draft?.id === t.id ? draft.rect : t.rect;
        const active = selected === t.id;
        return (
          <div
            key={t.id}
            className="absolute"
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              zIndex: t.id === "frame" ? 0 : t.id === "plot" ? 1 : 2,
            }}
          >
            {t.id !== "frame" && (
              <button
                type="button"
                aria-label={`Move ${t.label}`}
                aria-pressed={active}
                title={`Drag ${t.label} · arrows move · Ctrl/⌘ arrows resize`}
                className={`absolute inset-0 w-full h-full touch-none pointer-events-auto border bg-transparent text-loom-accent focus-visible:ring-2 focus-visible:ring-loom-accent outline-none ${active ? "border-loom-accent" : "border-dashed border-loom-accent/40 hover:border-loom-accent"}`}
                style={{ cursor: "move" }}
                onFocus={() => setSelected(t.id)}
                onPointerDown={(e) => start(e, t, "move")}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={cancel}
                onLostPointerCapture={() => {
                  if (gesture.current) cancel();
                }}
                onKeyDown={(e) => keyboard(e, t)}
              >
                <span className="sr-only">{t.label}</span>
              </button>
            )}
            {(active || t.id === "frame") &&
              (["e", "s", "se"] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-label={`Resize ${t.label} ${h === "e" ? "width" : h === "s" ? "height" : "size"}`}
                  title="Drag to resize · arrows to adjust · Shift for larger steps"
                  className="absolute pointer-events-auto touch-none min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-loom-accent"
                  style={{
                    width: 28,
                    height: 28,
                    right: h === "s" ? "calc(50% - 14px)" : -2,
                    bottom: h === "e" ? "calc(50% - 14px)" : -2,
                    cursor:
                      h === "e"
                        ? "ew-resize"
                        : h === "s"
                          ? "ns-resize"
                          : "nwse-resize",
                  }}
                  onPointerDown={(e) => start(e, t, h)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={cancel}
                  onLostPointerCapture={() => {
                    if (gesture.current) cancel();
                  }}
                  onKeyDown={(e) => {
                    if (
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    )
                      return;
                    e.preventDefault();
                    e.stopPropagation();
                    const step = e.shiftKey ? 10 : 1;
                    const dx =
                      e.key === "ArrowLeft"
                        ? -step
                        : e.key === "ArrowRight"
                          ? step
                          : 0;
                    const dy =
                      e.key === "ArrowUp"
                        ? -step
                        : e.key === "ArrowDown"
                          ? step
                          : 0;
                    const r = manipulateRect(
                      t.rect,
                      h,
                      dx,
                      dy,
                      t.bounds,
                      false,
                      t.minW,
                      t.minH,
                    );
                    if (
                      (["x", "y", "w", "h"] as const).every(
                        (k) => Math.abs(r[k] - t.rect[k]) < 0.1,
                      )
                    )
                      return;
                    p.onCommit(changeFor(t, r, h), `arrange:${t.id}`);
                  }}
                >
                  <span className="h-2.5 w-2.5 rounded-sm border-2 border-loom-accent bg-loom-surface shadow-sm" />
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
