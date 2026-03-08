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

function parseColorToRgb(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith("#") && s.length >= 7) {
    const r = parseInt(s.slice(1, 3), 16) / 255;
    const g = parseInt(s.slice(3, 5), 16) / 255;
    const b = parseInt(s.slice(5, 7), 16) / 255;
    return [r, g, b];
  }
  const rgb = s.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return [0.424, 0.361, 0.906];
}

const DEFAULT_CONFIG: ScatterConfig = {
  pointSize: 4.0,
  opacity: 0.7,
  sizeScale: 1,
};

export class LoomRenderer {
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
  private config: ScatterConfig = { ...DEFAULT_CONFIG };

  private static readonly DEFAULT_PALETTE = [
    [0.424, 0.361, 0.906], [0, 0.839, 0.561], [1, 0.42, 0.42], [1, 0.851, 0.239],
    [0, 0.706, 0.847], [0.906, 0.486, 0.361], [0.635, 0.608, 0.996], [0.455, 0.725, 1],
  ];

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      if (!navigator.gpu) {
        console.warn("WebGPU not available");
        return false;
      }

      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) return false;

      this.device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxBufferSize: 256 * 1024 * 1024,
        },
      });

      this.context = canvas.getContext("webgpu") as GPUCanvasContext;
      if (!this.context) {
        console.warn("Failed to get WebGPU canvas context");
        return false;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();

      this.context.configure({
        device: this.device,
        format,
        alphaMode: "premultiplied",
      });

      await this.createPipelines(format);
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
      size: 36, // 9 floats × 4 bytes (incl. size_scale)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.paletteBuffer = this.device.createBuffer({
      size: 8 * 3 * 4, // 8 colors × RGB × 4 bytes
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  uploadData(points: GPUScatterPoint[], config?: Partial<ScatterConfig>) {
    if (!this.device || !this.computePipeline || !this.renderPipeline || !this.uniformBuffer || !this.paletteBuffer) return;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    const palette = this.config.palette && this.config.palette.length >= 8
      ? this.config.palette.map((c) => parseColorToRgb(c))
      : LoomRenderer.DEFAULT_PALETTE;
    const paletteF32 = new Float32Array(24);
    for (let i = 0; i < 8; i++) {
      const [r, g, b] = palette[i] ?? LoomRenderer.DEFAULT_PALETTE[0]!;
      paletteF32[i * 3 + 0] = r;
      paletteF32[i * 3 + 1] = g;
      paletteF32[i * 3 + 2] = b;
    }
    this.device.queue.writeBuffer(this.paletteBuffer, 0, paletteF32);

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

    this.dataBuffer = this.device.createBuffer({
      size: dataArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.dataBuffer.getMappedRange()).set(dataArray);
    this.dataBuffer.unmap();

    // Screen buffer: 8 floats per point (pos, color, alpha, size, pad)
    this.screenBuffer = this.device.createBuffer({
      size: this.pointCount * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

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
  ) {
    if (
      !this.device || !this.context || !this.computePipeline ||
      !this.renderPipeline || !this.uniformBuffer ||
      !this.computeBindGroup || !this.renderBindGroup ||
      this.pointCount === 0
    ) {
      return;
    }

    const canvas = this.context.canvas as HTMLCanvasElement | undefined;
    if (!canvas || typeof canvas.width !== "number" || typeof canvas.height !== "number") {
      return;
    }

    const sizeScale = this.config.sizeScale ?? 1;
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
  }

  destroy() {
    this.dataBuffer?.destroy();
    this.screenBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.paletteBuffer?.destroy();
    this.device?.destroy();
    this.device = null;
    this.context = null;
  }
}
