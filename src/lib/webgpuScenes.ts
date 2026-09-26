// =================================================================
// Loom — WebGPU scene renderer (3D / particles / live globe)
// =================================================================
// Sibling to LoomRenderer (2D scatter). Handles scatter3d + firefly
// via scenes.wgsl, and live `globe` via globe.wgsl. Terrain, weave,
// trail ribbons, and capture always use Canvas.
// =================================================================

import scenesWgslRaw from "@/shaders/scenes.wgsl";
import globeWgslRaw from "@/shaders/globe.wgsl";
import type { GpuSceneKind, GpuScenePoint } from "./gpuScenes";
export { isWebGpuDrawableScene } from "./gpuScenes";

const scenesWgsl: string =
  typeof scenesWgslRaw === "string"
    ? scenesWgslRaw
    : (scenesWgslRaw as unknown as { default: string }).default ?? String(scenesWgslRaw);

const globeWgsl: string =
  typeof globeWgslRaw === "string"
    ? globeWgslRaw
    : (globeWgslRaw as unknown as { default: string }).default ?? String(globeWgslRaw);

function parseColorToRgb(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith("#") && s.length >= 7) {
    return [
      parseInt(s.slice(1, 3), 16) / 255,
      parseInt(s.slice(3, 5), 16) / 255,
      parseInt(s.slice(5, 7), 16) / 255,
    ];
  }
  const rgb = s.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return [0.424, 0.361, 0.906];
}

export type SceneMode = GpuSceneKind | "globe";

export interface SceneConfig {
  pointSize: number;
  opacity: number;
  sizeScale?: number;
  palette?: string[];
  clearColor?: [number, number, number];
  yaw?: number;
  pitch?: number;
  zoom?: number;
  mode?: SceneMode;
  time?: number;
}

const MODE_INDEX: Record<string, number> = {
  scatter3d: 0,
  firefly: 1,
  trailRibbon: 2,
  globe: 3,
};

const DEFAULT_PALETTE = [
  [0.424, 0.361, 0.906], [0, 0.839, 0.561], [1, 0.42, 0.42], [1, 0.851, 0.239],
  [0, 0.706, 0.847], [0.906, 0.486, 0.361], [0.635, 0.608, 0.996], [0.455, 0.725, 1],
];

export class LoomSceneRenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private dataBuffer: GPUBuffer | null = null;
  private screenBuffer: GPUBuffer | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private renderBindGroup: GPUBindGroup | null = null;
  private paletteBuffer: GPUBuffer | null = null;
  private pointCount = 0;
  private config: SceneConfig = {
    pointSize: 5,
    opacity: 0.75,
    sizeScale: 1,
    yaw: 0.55,
    pitch: 0.35,
    zoom: 1,
    mode: "scatter3d",
    time: 0,
  };
  private bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1 };

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      if (!navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return false;
      this.device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxBufferSize: 256 * 1024 * 1024,
        },
      });
      this.context = canvas.getContext("webgpu") as GPUCanvasContext;
      if (!this.context) return false;
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format, alphaMode: "premultiplied" });
      await this.createPipelines(format);
      return true;
    } catch (e) {
      console.warn("WebGPU scene init failed:", e);
      return false;
    }
  }

  private async createPipelines(format: GPUTextureFormat) {
    if (!this.device) return;
    this.ensurePipelinesForMode(this.config.mode ?? "scatter3d", format);
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paletteBuffer = this.device.createBuffer({
      size: 8 * 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private ensurePipelinesForMode(mode: SceneMode, format: GPUTextureFormat) {
    if (!this.device) return;
    const code = mode === "globe" ? globeWgsl : scenesWgsl;
    const shaderModule = this.device.createShaderModule({ code });
    this.computePipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "compute_positions" },
    });
    this.buildRenderPipeline(format, shaderModule);
  }

  private buildRenderPipeline(format: GPUTextureFormat, shaderModule?: GPUShaderModule) {
    if (!this.device) return;
    const mode = this.config.mode ?? "scatter3d";
    const wgsl =
      shaderModule ??
      this.device.createShaderModule({ code: mode === "globe" ? globeWgsl : scenesWgsl });
    const additive = mode === "firefly" || mode === "globe";
    const blend = additive
      ? {
          color: { srcFactor: "src-alpha" as const, dstFactor: "one" as const, operation: "add" as const },
          alpha: { srcFactor: "one" as const, dstFactor: "one" as const, operation: "add" as const },
        }
      : {
          color: { srcFactor: "src-alpha" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
          alpha: { srcFactor: "one" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
        };
    this.renderPipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: wgsl, entryPoint: "vertex_main" },
      fragment: {
        module: wgsl,
        entryPoint: "fragment_main",
        targets: [{ format, blend }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  uploadData(
    points: GpuScenePoint[],
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number },
    config?: Partial<SceneConfig>,
  ) {
    if (!this.device || !this.uniformBuffer || !this.paletteBuffer) return;
    const prevMode = this.config.mode;
    if (config) this.config = { ...this.config, ...config };
    this.bounds = bounds;

    if (prevMode !== this.config.mode) {
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.ensurePipelinesForMode(this.config.mode ?? "scatter3d", format);
    }
    if (!this.computePipeline || !this.renderPipeline) return;

    const palette = this.config.palette && this.config.palette.length >= 8
      ? this.config.palette.map((c) => parseColorToRgb(c))
      : DEFAULT_PALETTE;
    const paletteF32 = new Float32Array(24);
    for (let i = 0; i < 8; i++) {
      const [r, g, b] = palette[i] ?? DEFAULT_PALETTE[0]!;
      paletteF32[i * 3] = r;
      paletteF32[i * 3 + 1] = g;
      paletteF32[i * 3 + 2] = b;
    }
    this.device.queue.writeBuffer(this.paletteBuffer, 0, paletteF32);

    this.pointCount = points.length;
    if (this.pointCount === 0) return;

    const dataArray = new Float32Array(this.pointCount * 8);
    const view = new DataView(dataArray.buffer);
    for (let i = 0; i < this.pointCount; i++) {
      const p = points[i]!;
      const o = i * 8;
      dataArray[o] = p.x;
      dataArray[o + 1] = p.y;
      dataArray[o + 2] = p.z;
      view.setUint32((o + 3) * 4, p.category, true);
      dataArray[o + 4] = p.size;
      view.setUint32((o + 5) * 4, p.trail >>> 0, true);
      dataArray[o + 6] = p.t;
      dataArray[o + 7] = 0;
    }

    this.dataBuffer?.destroy();
    this.screenBuffer?.destroy();

    this.dataBuffer = this.device.createBuffer({
      size: dataArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.dataBuffer.getMappedRange()).set(dataArray);
    this.dataBuffer.unmap();

    this.screenBuffer = this.device.createBuffer({
      size: this.pointCount * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.dataBuffer } },
        { binding: 2, resource: { buffer: this.screenBuffer } },
        { binding: 3, resource: { buffer: this.paletteBuffer } },
      ],
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.screenBuffer } },
      ],
    });
  }

  setCamera(yaw: number, pitch: number, zoom?: number) {
    this.config.yaw = yaw;
    this.config.pitch = pitch;
    if (zoom != null) this.config.zoom = zoom;
  }

  setTime(t: number) {
    this.config.time = t;
  }

  render(width: number, height: number) {
    if (
      !this.device ||
      !this.context ||
      !this.computePipeline ||
      !this.renderPipeline ||
      !this.uniformBuffer ||
      !this.computeBindGroup ||
      !this.renderBindGroup ||
      this.pointCount === 0
    ) {
      return;
    }

    const u = new Float32Array(16);
    u[0] = width;
    u[1] = height;
    u[2] = this.bounds.xMin;
    u[3] = this.bounds.xMax;
    u[4] = this.bounds.yMin;
    u[5] = this.bounds.yMax;
    u[6] = this.bounds.zMin;
    u[7] = this.bounds.zMax;
    u[8] = this.config.pointSize;
    u[9] = this.config.opacity;
    u[10] = this.config.sizeScale ?? 1;
    u[11] = this.config.yaw ?? 0.55;
    u[12] = this.config.pitch ?? 0.35;
    u[13] = this.config.zoom ?? 1;
    u[14] = MODE_INDEX[this.config.mode ?? "scatter3d"] ?? 0;
    u[15] = this.config.time ?? 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.pointCount / 256));
    computePass.end();

    const clear = this.config.clearColor ?? [0.04, 0.04, 0.05];
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(6, this.pointCount);
    renderPass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this.dataBuffer?.destroy();
    this.screenBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.paletteBuffer?.destroy();
    this.device = null;
  }
}
