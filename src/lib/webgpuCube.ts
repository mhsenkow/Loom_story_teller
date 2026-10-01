// =================================================================
// Loom — WebGPU data cube renderer (instanced voxels)
// =================================================================
// Sibling to LoomSceneRenderer. Draws only the voxels — back walls
// and labels are Canvas layers under / over this canvas (see
// dataCube.ts) so the GPU frame and the capture-safe Canvas frame
// share one look. Clears transparent; instances are sorted far →
// near every frame so translucent voxels blend correctly.
// =================================================================

import cubeWgslRaw from "@/shaders/cube.wgsl";
import {
  cubeCellAlphaScale,
  cubeCellColor,
  cubeCellPosition,
  cubeVoxelHalf,
  sortCellsBackToFront,
  type CubeCellStyle,
  type CubeView,
  type DataCube,
} from "./dataCube";

const cubeWgsl: string =
  typeof cubeWgslRaw === "string"
    ? cubeWgslRaw
    : (cubeWgslRaw as unknown as { default: string }).default ?? String(cubeWgslRaw);

/** 36 vertices (pos.xyz, normal.xyz), CCW from outside. */
function unitCubeVertices(): Float32Array<ArrayBuffer> {
  const faces: { n: [number, number, number]; c: [number, number, number][] }[] = [
    { n: [1, 0, 0], c: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { n: [-1, 0, 0], c: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  ];
  const out: number[] = [];
  for (const f of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...f.c[i]!, ...f.n);
  }
  return new Float32Array(out);
}

export class LoomCubeRenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private instanceCapacity = 0;
  private bindGroup: GPUBindGroup | null = null;
  private depthTexture: GPUTexture | null = null;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      if (!navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!this.context) return false;
      this.canvas = canvas;
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format, alphaMode: "premultiplied" });

      const shaderModule = this.device.createShaderModule({ code: cubeWgsl });
      this.pipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shaderModule,
          entryPoint: "vertex_main",
          buffers: [
            {
              arrayStride: 24,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x3" },
              ],
            },
            {
              arrayStride: 32,
              stepMode: "instance",
              attributes: [
                { shaderLocation: 2, offset: 0, format: "float32x4" },
                { shaderLocation: 3, offset: 16, format: "float32x4" },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragment_main",
          targets: [
            {
              format,
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      });

      this.uniformBuffer = this.device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const verts = unitCubeVertices();
      this.vertexBuffer = this.device.createBuffer({
        size: verts.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.vertexBuffer, 0, verts);
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
      return true;
    } catch (e) {
      console.warn("WebGPU cube init failed:", e);
      return false;
    }
  }

  private ensureDepth(width: number, height: number) {
    if (!this.device) return;
    if (this.depthTexture && this.depthTexture.width === width && this.depthTexture.height === height) return;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: { width, height },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private ensureInstances(count: number) {
    if (!this.device) return;
    if (this.instanceBuffer && this.instanceCapacity >= count) return;
    this.instanceBuffer?.destroy();
    this.instanceCapacity = Math.max(64, Math.ceil(count * 1.5));
    this.instanceBuffer = this.device.createBuffer({
      size: this.instanceCapacity * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  /** Draw voxels for `view`; colors come from the same helper as the Canvas fallback. */
  render(cube: DataCube, view: CubeView, ramp: string[], opacity: number, style?: CubeCellStyle) {
    const { device, context, pipeline, uniformBuffer, vertexBuffer, bindGroup, canvas } = this;
    if (!device || !context || !pipeline || !uniformBuffer || !vertexBuffer || !bindGroup || !canvas) return;
    if (canvas.width <= 0 || canvas.height <= 0) return;

    const sorted = sortCellsBackToFront(cube, view, style);
    const inst = new Float32Array(sorted.length * 8);
    sorted.forEach(({ cell }, i) => {
      const [x, y, z] = cubeCellPosition(cube, cell, style);
      const { rgb, alpha: baseAlpha } = cubeCellColor(cell, ramp, opacity);
      const alpha = baseAlpha * cubeCellAlphaScale(cell, style);
      const o = i * 8;
      inst[o] = x;
      inst[o + 1] = y;
      inst[o + 2] = z;
      inst[o + 3] = cubeVoxelHalf(cube, cell);
      inst[o + 4] = rgb[0] / 255;
      inst[o + 5] = rgb[1] / 255;
      inst[o + 6] = rgb[2] / 255;
      inst[o + 7] = alpha;
    });
    this.ensureInstances(sorted.length);
    if (!this.instanceBuffer) return;
    if (inst.byteLength > 0) device.queue.writeBuffer(this.instanceBuffer, 0, inst);

    const u = new Float32Array(20);
    u.set(view.m, 0);
    u[16] = view.light[0];
    u[17] = view.light[1];
    u[18] = view.light[2];
    device.queue.writeBuffer(uniformBuffer, 0, u);

    const texture = context.getCurrentTexture();
    this.ensureDepth(texture.width, texture.height);
    if (!this.depthTexture) return;

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    if (sorted.length > 0) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setVertexBuffer(1, this.instanceBuffer);
      pass.draw(36, sorted.length);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** Clear to transparent (e.g. when switching away). */
  clear() {
    if (!this.device || !this.context) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this.instanceBuffer?.destroy();
    this.vertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.instanceBuffer = null;
    this.depthTexture = null;
    this.device = null;
    this.context = null;
    this.canvas = null;
  }
}
