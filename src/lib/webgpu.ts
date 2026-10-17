// =================================================================
// Loom — WebGPU Rendering Engine
// =================================================================
// Manages the GPU device, pipelines, and buffers for rendering
// high-density scatterplots. The compute shader transforms data
// points from data-space to screen-space; the render pass draws
// anti-aliased circle sprites.
//
// Designed for 1M+ points on Apple Silicon (Unified Memory).
//
// Pipeline:
//   CPU (Float32Array) → GPU Buffer → Compute Shader → Render Pass
// =================================================================

import scatterWgslRaw from "@/shaders/scatter.wgsl";
import { packGpuPalette } from "./gpuPalette";
import type { SharedGpuDeviceLease } from "./gpuDevice";
import { parseColorToRgb } from "./webgpuColor";

export { parseColorToRgb };

// raw-loader may export as default string or as { default: string }
const scatterWgsl: string =
  typeof scatterWgslRaw === "string"
    ? scatterWgslRaw
    : (scatterWgslRaw as unknown as { default: string }).default ?? String(scatterWgslRaw);

export interface GPUScatterPoint {
  x: number;
  y: number;
  category: number;
  /** Normalized 0–1 for per-point size (ignored if missing). */
  size?: number;
}

export interface ScatterConfig {
  pointSize: number;
  opacity: number;
  /** Scale for size encoding (0.5–2). Default 1. */
  sizeScale?: number;
  /** 8 colors (hex or rgb) for theme-aware scatter. Defaults to dark Loom palette. */
  palette?: string[];
  /** Background clear color (0–1 RGB) so light/dark theme matches. Defaults to dark. */
  clearColor?: [number, number, number];
}

const DEFAULT_CONFIG: ScatterConfig = {
  pointSize: 4.0,
  opacity: 0.7,
  sizeScale: 1,
};

export class LoomRenderer {
  /** Set when device.lost fires — ChartView should fall back to Canvas (LOOM-112). */
  deviceLost = false;
  private initGeneration = 0;
  private disposed = false;
  private deviceLease: SharedGpuDeviceLease | null = null;
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
  private paletteSize = 8;
  private pointCount = 0;
  private dataCapacityBytes = 0;
  private screenCapacityBytes = 0;
  private config: ScatterConfig = { ...DEFAULT_CONFIG };

  private static readonly DEFAULT_PALETTE = [
    [0.424, 0.361, 0.906], [0, 0.839, 0.561], [1, 0.42, 0.42], [1, 0.851, 0.239],
    [0, 0.706, 0.847], [0.906, 0.486, 0.361], [0.635, 0.608, 0.996], [0.455, 0.725, 1],
  ];

  async init(canvas: HTMLCanvasElement, deviceLease: SharedGpuDeviceLease): Promise<boolean> {
    const gen = ++this.initGeneration;
    this.disposed = false;
    this.deviceLost = false;
    try {
      if (!navigator.gpu) {
        console.warn("WebGPU not available");
        return false;
      }
      const { device } = deviceLease;

      if (gen !== this.initGeneration || this.disposed) {
        return false;
      }

      this.deviceLease = deviceLease;
      this.device = device;
      void device.lost.then(() => {
        if (gen !== this.initGeneration) return;
        this.deviceLost = true;
        this.device = null;
        this.context = null;
      });

      this.context = canvas.getContext("webgpu") as GPUCanvasContext;
      if (!this.context) {
        console.warn("Failed to get WebGPU canvas context");
        this.device = null;
        return false;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();

      this.context.configure({
        device: this.device,
        format,
        alphaMode: "premultiplied",
      });

      await this.createPipelines(format);
      if (gen !== this.initGeneration || this.disposed) {
        this.destroy();
        return false;
      }
      return true;
    } catch (e) {
      console.warn("WebGPU init failed:", e);
      return false;
    }
  }

  private async createPipelines(format: GPUTextureFormat) {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: scatterWgsl,
    });

    // Compute pipeline: data → screen positions
    this.computePipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "compute_positions",
      },
    });

    // Render pipeline: screen positions → pixels
    this.renderPipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertex_main",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragment_main",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64, // 16 floats — WGSL uniform alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.paletteBuffer = this.device.createBuffer({
      size: 32 * 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  uploadData(points: GPUScatterPoint[], config?: Partial<ScatterConfig>) {
    if (!this.device || !this.computePipeline || !this.renderPipeline || !this.uniformBuffer || !this.paletteBuffer) return;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    const packed = packGpuPalette(
      this.config.palette,
      LoomRenderer.DEFAULT_PALETTE as [number, number, number][],
    );
    this.paletteSize = packed.size;
    this.device.queue.writeBuffer(
      this.paletteBuffer,
      0,
      packed.floats as Float32Array<ArrayBuffer>,
    );

    this.pointCount = points.length;
    if (this.pointCount === 0) return;

    // Pack data: [x, y, category, size] per point → 16 bytes each (size 0–1 or 0 if unused)
    const dataArray = new Float32Array(this.pointCount * 4);
    const view = new DataView(dataArray.buffer);
    for (let i = 0; i < this.pointCount; i++) {
      const p = points[i];
      dataArray[i * 4 + 0] = p.x;
      dataArray[i * 4 + 1] = p.y;
      view.setUint32((i * 4 + 2) * 4, p.category, true);
      dataArray[i * 4 + 3] = typeof p.size === "number" ? p.size : 1; // 1 = use uniform size
    }

    const dataBytes = dataArray.byteLength;
    const screenBytes = this.pointCount * 32;
    if (!this.dataBuffer || this.dataCapacityBytes < dataBytes) {
      this.dataBuffer?.destroy();
      this.dataBuffer = this.device.createBuffer({
        size: dataBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      this.dataCapacityBytes = dataBytes;
      new Float32Array(this.dataBuffer.getMappedRange()).set(dataArray);
      this.dataBuffer.unmap();
    } else {
      this.device.queue.writeBuffer(this.dataBuffer, 0, dataArray);
    }

    if (!this.screenBuffer || this.screenCapacityBytes < screenBytes) {
      this.screenBuffer?.destroy();
      this.screenBuffer = this.device.createBuffer({
        size: screenBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.screenCapacityBytes = screenBytes;
    }

    // Recreate bind groups
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

  private getClearValue(): { r: number; g: number; b: number; a: number } {
    const c = this.config.clearColor;
    if (c && c.length >= 3) return { r: c[0], g: c[1], b: c[2], a: 1 };
    return { r: 0.039, g: 0.039, b: 0.047, a: 1.0 };
  }

  /** Clear the WebGPU canvas only (e.g. when switching to a non-scatter chart). */
  clearCanvas(): void {
    if (!this.device || !this.context) return;
    try {
      const clear = this.getClearValue();
      const textureView = this.context.getCurrentTexture().createView();
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: clear,
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    } catch {
      // Context may be lost or canvas not ready; ignore
    }
  }

  render(
    xMin: number, xMax: number,
    yMin: number, yMax: number,
    /** Plot inset in device pixels (same space as canvas.width/height). */
    padPx: number = 0,
    padYPx?: number,
  ): Promise<void> {
    if (
      !this.device || !this.context || !this.computePipeline ||
      !this.renderPipeline || !this.uniformBuffer ||
      !this.computeBindGroup || !this.renderBindGroup ||
      this.pointCount === 0
    ) {
      return Promise.resolve();
    }

    const canvas = this.context.canvas as HTMLCanvasElement | undefined;
    if (!canvas || typeof canvas.width !== "number" || typeof canvas.height !== "number") {
      return Promise.resolve();
    }

    const sizeScale = this.config.sizeScale ?? 1;
    const padX = Math.max(0, padPx);
    const padY = Math.max(0, padYPx ?? padPx);
    // Derive from the sized buffer so screen DPR caps and export pixelRatio stay aligned.
    const cssW = canvas.clientWidth || canvas.width;
    const dpr = cssW > 0 ? canvas.width / cssW : 1;
    const uniforms = new Float32Array([
      canvas.width,
      canvas.height,
      xMin,
      xMax,
      yMin,
      yMax,
      this.config.pointSize,
      this.config.opacity,
      sizeScale,
      padX,
      padY,
      dpr,
      this.paletteSize,
      0,
      0,
      0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const encoder = this.device.createCommandEncoder();

    // Compute pass: transform data → screen coordinates
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.pointCount / 256));
    computePass.end();

    // Render pass: draw point sprites (clear to theme bg for light/dark)
    const clear = this.getClearValue();
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: clear,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(6, this.pointCount); // 6 verts per quad, N instances
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  destroy() {
    this.disposed = true;
    this.initGeneration++;
    this.dataBuffer?.destroy();
    this.screenBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.paletteBuffer?.destroy();
    this.deviceLease?.release();
    this.deviceLease = null;
    this.device = null;
    this.context = null;
  }
}
