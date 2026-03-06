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
}

const DEFAULT_CONFIG: ScatterConfig = {
  pointSize: 4.0,
  opacity: 0.7,
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
  private pointCount = 0;
  private config: ScatterConfig = { ...DEFAULT_CONFIG };

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
      size: 32, // 8 floats × 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  uploadData(points: GPUScatterPoint[], config?: Partial<ScatterConfig>) {
    if (!this.device || !this.computePipeline || !this.renderPipeline || !this.uniformBuffer) return;

    if (config) {
      this.config = { ...this.config, ...config };
    }

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

  /** Clear the WebGPU canvas only (e.g. when switching to a non-scatter chart). */
  clearCanvas(): void {
    if (!this.device || !this.context) return;
    try {
      const textureView = this.context.getCurrentTexture().createView();
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0.039, g: 0.039, b: 0.047, a: 1.0 },
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

    const canvas = this.context.canvas as HTMLCanvasElement;

    // Update uniforms
    const uniforms = new Float32Array([
      canvas.width,
      canvas.height,
      xMin,
      xMax,
      yMin,
      yMax,
      this.config.pointSize,
      this.config.opacity,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const encoder = this.device.createCommandEncoder();

    // Compute pass: transform data → screen coordinates
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.pointCount / 256));
    computePass.end();

    // Render pass: draw point sprites
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.039, g: 0.039, b: 0.047, a: 1.0 }, // matches --loom-bg
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
    this.device?.destroy();
    this.device = null;
    this.context = null;
  }
}
