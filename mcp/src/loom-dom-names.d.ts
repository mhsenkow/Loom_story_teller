// Names shared Loom modules use while drawing. This Worker program does not
// include the DOM lib (it clashes with the Workers Request type), and these
// declarations exist only so imported chart modules typecheck here.

interface CanvasRenderingContext2D {
  [prop: string]: any;
  measureText(text: string): { width: number };
}

type CanvasLineCap = "butt" | "round" | "square";
type CanvasLineJoin = "miter" | "round" | "bevel";

interface Document {
  documentElement: { getAttribute(name: string): string | null };
  createElement(tag: string): any;
  fonts: { load(spec: string): Promise<unknown> };
  head: { appendChild(node: unknown): void };
}

declare const document: Document;
declare const window: {
  matchMedia(query: string): { matches: boolean };
};
