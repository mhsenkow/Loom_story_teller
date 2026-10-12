// =================================================================
// LOOM-671 — GPU renderer buffer/device lifecycle with a fake GPUDevice
// =================================================================
// No WebGPU runtime: a recording fake device tracks createBuffer/destroy so we
// can assert repeated uploads don't leak buffers and destroy() releases the
// shared device lease (and the device itself once the last lease is gone).
// =================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shaders/scatter.wgsl", () => ({ default: "// scatter" }));
vi.mock("@/shaders/scenes.wgsl", () => ({ default: "// scenes" }));
vi.mock("@/shaders/globe.wgsl", () => ({ default: "// globe" }));
vi.mock("@/shaders/cube.wgsl", () => ({ default: "// cube" }));

import { LoomRenderer } from "../webgpu";
import { LoomSceneRenderer } from "../webgpuScenes";
import { LoomCubeRenderer } from "../webgpuCube";
import { acquireSharedGpuDevice, type SharedGpuDeviceLease } from "../gpuDevice";
import { buildDataCube, cubeView } from "../dataCube";
import type { GpuScenePoint } from "../gpuScenes";

// ---- Recording fake device ------------------------------------------

interface FakeBuffer {
  size: number;
  usage: number;
  destroyed: boolean;
  destroy(): void;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

interface FakeTexture {
  width: number;
  height: number;
  destroyed: boolean;
  destroy(): void;
  createView(): object;
}

function createFakeDevice() {
  const buffers: FakeBuffer[] = [];
  const textures: FakeTexture[] = [];
  const writes: { buffer: FakeBuffer; bytes: number }[] = [];
  let submits = 0;
  const device = {
    destroyed: false,
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    destroy() {
      device.destroyed = true;
    },
    createBuffer(desc: { size: number; usage: number; mappedAtCreation?: boolean }): FakeBuffer {
      const b: FakeBuffer = {
        size: desc.size,
        usage: desc.usage,
        destroyed: false,
        destroy() {
          b.destroyed = true;
        },
        getMappedRange: () => new ArrayBuffer(desc.size),
        unmap: () => {},
      };
      buffers.push(b);
      return b;
    },
    createTexture(desc: { size: { width: number; height: number } }): FakeTexture {
      const t: FakeTexture = {
        width: desc.size.width,
        height: desc.size.height,
        destroyed: false,
        destroy() {
          t.destroyed = true;
        },
        createView: () => ({}),
      };
      textures.push(t);
      return t;
    },
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {},
      }),
      beginRenderPass: () => ({
        setPipeline() {},
        setBindGroup() {},
        setVertexBuffer() {},
        draw() {},
        end() {},
      }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer: FakeBuffer, _offset: number, data: ArrayBufferView) {
        writes.push({ buffer, bytes: data.byteLength });
      },
      submit() {
        submits += 1;
      },
      onSubmittedWorkDone: () => Promise.resolve(),
    },
  };
  return {
    device,
    buffers,
    textures,
    writes,
    get submits() {
      return submits;
    },
    live: () => buffers.filter((b) => !b.destroyed),
  };
}

type Fake = ReturnType<typeof createFakeDevice>;

function createLease(fake: Fake) {
  const release = vi.fn();
  const lease = {
    adapter: {} as GPUAdapter,
    device: fake.device as unknown as GPUDevice,
    release,
  } satisfies SharedGpuDeviceLease;
  return { lease, release };
}

function createCanvas() {
  const texture = { width: 320, height: 200, createView: () => ({}) };
  const context = {
    configure: vi.fn(),
    getCurrentTexture: () => texture,
    canvas: { width: 320, height: 200 },
  };
  const canvas = { width: 320, height: 200, getContext: () => context };
  return { canvas: canvas as unknown as HTMLCanvasElement, context };
}

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, STORAGE: 2, COPY_DST: 4, VERTEX: 8 });
  vi.stubGlobal("GPUTextureUsage", { RENDER_ATTACHMENT: 16 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubNavigatorGpu(extra: Record<string, unknown> = {}) {
  vi.stubGlobal("navigator", {
    gpu: { getPreferredCanvasFormat: () => "bgra8unorm", ...extra },
  });
}

const scatterPts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, category: i % 3 }));

const scenePts = (n: number): GpuScenePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i, z: i, category: 0, size: 1, trail: i, t: i / n }));

const sceneBounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10, zMin: 0, zMax: 10 };

// ---- LoomRenderer (2D scatter) --------------------------------------

describe("LoomRenderer buffer lifecycle", () => {
  it("allocates uniform + palette on init and one data/screen buffer per upload", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { lease } = createLease(fake);
    const { canvas } = createCanvas();
    const r = new LoomRenderer();
    expect(await r.init(canvas, lease)).toBe(true);
    expect(fake.live()).toHaveLength(2);

    r.uploadData(scatterPts(10));
    expect(fake.live()).toHaveLength(4);
    r.uploadData(scatterPts(10));
    expect(fake.live()).toHaveLength(4);
  });

  it("reuses buffers via writeBuffer when the point count is unchanged", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { canvas } = createCanvas();
    const r = new LoomRenderer();
    await r.init(canvas, createLease(fake).lease);
    r.uploadData(scatterPts(50));
    const created = fake.buffers.length;
    r.uploadData(scatterPts(50));
    r.uploadData(scatterPts(20));
    expect(fake.buffers.length).toBe(created);
    expect(fake.buffers.some((b) => b.destroyed)).toBe(false);
  });

  it("destroys the old data/screen buffers when growing, leaving one live pair", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { canvas } = createCanvas();
    const r = new LoomRenderer();
    await r.init(canvas, createLease(fake).lease);
    r.uploadData(scatterPts(10));
    const [firstData, firstScreen] = fake.buffers.slice(2, 4);
    r.uploadData(scatterPts(500));
    expect(firstData!.destroyed).toBe(true);
    expect(firstScreen!.destroyed).toBe(true);
    expect(fake.live()).toHaveLength(4);
  });

  it("destroy() frees every buffer, releases the lease once, and later uploads are no-ops", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { lease, release } = createLease(fake);
    const { canvas } = createCanvas();
    const r = new LoomRenderer();
    await r.init(canvas, lease);
    r.uploadData(scatterPts(10));
    r.destroy();
    r.destroy();
    expect(fake.live()).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(1);
    const before = fake.buffers.length;
    r.uploadData(scatterPts(10));
    expect(fake.buffers.length).toBe(before);
    await expect(r.render(0, 1, 0, 1)).resolves.toBeUndefined();
  });

  it("renders by submitting one command buffer after an upload", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { canvas } = createCanvas();
    const r = new LoomRenderer();
    await r.init(canvas, createLease(fake).lease);
    await r.render(0, 1, 0, 1);
    expect(fake.submits).toBe(0);
    r.uploadData(scatterPts(10));
    await r.render(0, 10, 0, 10, 8);
    expect(fake.submits).toBe(1);
  });

  it("aborts init (and frees its lease) when destroyed mid-init", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { lease, release } = createLease(fake);
    const { canvas } = createCanvas();
    const r = new LoomRenderer();
    const pending = r.init(canvas, lease);
    r.destroy();
    expect(await pending).toBe(false);
    expect(fake.live()).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails init cleanly without navigator.gpu", async () => {
    vi.stubGlobal("navigator", {});
    const fake = createFakeDevice();
    const { canvas } = createCanvas();
    expect(await new LoomRenderer().init(canvas, createLease(fake).lease)).toBe(false);
    expect(fake.buffers).toHaveLength(0);
  });
});

// ---- LoomSceneRenderer ----------------------------------------------

describe("LoomSceneRenderer buffer lifecycle", () => {
  it("replaces (never accumulates) the data/screen buffers on every upload", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { canvas } = createCanvas();
    const r = new LoomSceneRenderer();
    expect(await r.init(canvas, createLease(fake).lease)).toBe(true);
    expect(fake.live()).toHaveLength(2);

    r.uploadData(scenePts(10), sceneBounds);
    expect(fake.live()).toHaveLength(4);
    const firstData = fake.buffers[2]!;
    r.uploadData(scenePts(10), sceneBounds);
    expect(firstData.destroyed).toBe(true);
    expect(fake.live()).toHaveLength(4);
  });

  it("renders via a single submit and destroy() frees everything and releases the lease", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { lease, release } = createLease(fake);
    const { canvas } = createCanvas();
    const r = new LoomSceneRenderer();
    await r.init(canvas, lease);
    r.uploadData(scenePts(5), sceneBounds, { mode: "firefly" });
    r.render(320, 200);
    expect(fake.submits).toBe(1);
    r.destroy();
    expect(fake.live()).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(1);
    r.render(320, 200);
    expect(fake.submits).toBe(1);
  });

  it("skips upload when init never succeeded", () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const r = new LoomSceneRenderer();
    r.uploadData(scenePts(3), sceneBounds);
    expect(fake.buffers).toHaveLength(0);
  });
});

// ---- LoomCubeRenderer -----------------------------------------------

describe("LoomCubeRenderer buffer lifecycle", () => {
  const columns = ["region", "product", "year", "sales"];
  const rows: unknown[][] = [
    ["East", "Apples", 2022, 10],
    ["East", "Pears", 2023, 6],
    ["West", "Apples", 2022, 8],
    ["West", "Pears", 2023, 20],
  ];
  const cube = buildDataCube(rows, columns, {
    xField: "region",
    yField: "product",
    zField: "year",
    valueField: "sales",
    aggregate: "sum",
  })!;
  const view = cubeView({ yaw: 0.5, pitch: 0.3, zoom: 1 }, 320, 200);
  const ramp = ["#000000", "#ffffff"];

  it("allocates uniform + vertex buffers on init and grows the instance buffer once", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { canvas } = createCanvas();
    const r = new LoomCubeRenderer();
    expect(await r.init(canvas, createLease(fake).lease)).toBe(true);
    expect(fake.live()).toHaveLength(2);

    r.render(cube, view, ramp, 0.9);
    expect(fake.live()).toHaveLength(3);
    const created = fake.buffers.length;
    r.render(cube, view, ramp, 0.9);
    expect(fake.buffers.length).toBe(created);
    expect(fake.submits).toBe(2);
  });

  it("recreates the depth texture only when the canvas size changes", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { canvas, context } = createCanvas();
    const r = new LoomCubeRenderer();
    await r.init(canvas, createLease(fake).lease);
    r.render(cube, view, ramp, 0.9);
    r.render(cube, view, ramp, 0.9);
    expect(fake.textures).toHaveLength(1);
    const next = { width: 640, height: 400, createView: () => ({}) };
    context.getCurrentTexture = () => next;
    r.render(cube, view, ramp, 0.9);
    expect(fake.textures).toHaveLength(2);
    expect(fake.textures[0]!.destroyed).toBe(true);
    expect(fake.textures[1]!.destroyed).toBe(false);
  });

  it("destroy() frees buffers + depth texture, releases the lease, and render becomes a no-op", async () => {
    stubNavigatorGpu();
    const fake = createFakeDevice();
    const { lease, release } = createLease(fake);
    const { canvas } = createCanvas();
    const r = new LoomCubeRenderer();
    await r.init(canvas, lease);
    r.render(cube, view, ramp, 0.9);
    r.destroy();
    expect(fake.live()).toHaveLength(0);
    expect(fake.textures.every((t) => t.destroyed)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    const submits = fake.submits;
    r.render(cube, view, ramp, 0.9);
    expect(fake.submits).toBe(submits);
  });
});

// ---- Shared device ownership ----------------------------------------

describe("shared GPU device leases", () => {
  it("destroys the device only after the last renderer releases it", async () => {
    const fake = createFakeDevice();
    const adapter = {
      limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
      requestDevice: vi.fn(async () => fake.device),
    };
    stubNavigatorGpu({ requestAdapter: vi.fn(async () => adapter) });

    const a = (await acquireSharedGpuDevice())!;
    const b = (await acquireSharedGpuDevice())!;
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(a.device).toBe(b.device);

    const scatter = new LoomRenderer();
    const cubeR = new LoomCubeRenderer();
    await scatter.init(createCanvas().canvas, a);
    await cubeR.init(createCanvas().canvas, b);

    scatter.destroy();
    expect(fake.device.destroyed).toBe(false);
    cubeR.destroy();
    expect(fake.device.destroyed).toBe(true);
    expect(fake.live()).toHaveLength(0);
  });

  it("release() is idempotent and a fresh acquire after full release creates a new device", async () => {
    const first = createFakeDevice();
    const second = createFakeDevice();
    const devices = [first.device, second.device];
    const adapter = {
      limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
      requestDevice: vi.fn(async () => devices.shift()!),
    };
    stubNavigatorGpu({ requestAdapter: vi.fn(async () => adapter) });

    const lease = (await acquireSharedGpuDevice())!;
    lease.release();
    lease.release();
    expect(first.device.destroyed).toBe(true);

    const again = (await acquireSharedGpuDevice())!;
    expect(again.device).toBe(second.device);
    expect(second.device.destroyed).toBe(false);
    again.release();
    expect(second.device.destroyed).toBe(true);
  });

  it("returns null when WebGPU is unavailable or no adapter is found", async () => {
    vi.stubGlobal("navigator", {});
    expect(await acquireSharedGpuDevice()).toBeNull();
    stubNavigatorGpu({ requestAdapter: async () => null });
    expect(await acquireSharedGpuDevice()).toBeNull();
  });
});
