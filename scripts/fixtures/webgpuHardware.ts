// Real-device checks: production renderers/shaders, with synchronous Canvas readback.
import { LoomRenderer } from "../../src/lib/webgpu";
import { LoomSceneRenderer } from "../../src/lib/webgpuScenes";
import { LoomCubeRenderer } from "../../src/lib/webgpuCube";
import { acquireSharedGpuDevice } from "../../src/lib/gpuDevice";
import { orbitSceneLayout } from "../../src/lib/gpuScenes";
import type { GpuScenePoint } from "../../src/lib/gpuScenesRec";
import { buildDataCube, cubeView } from "../../src/lib/dataCube";

async function runHardwareChecks() {
  const lease = await acquireSharedGpuDevice();
  if (!lease) throw new Error("No WebGPU device; hardware validation cannot pass via Canvas fallback.");
  const { adapter, device } = lease;
  const info = adapter.info;
  if (info.isFallbackAdapter || /swiftshader|software|llvmpipe/i.test(`${info.vendor} ${info.description}`)) {
    lease.release();
    throw new Error("Software adapter: physical GPU required.");
  }
  const errors: string[] = [];
  device.addEventListener("uncapturederror", e => errors.push(e.error.message));
  const checks: { name: string; pass: boolean; detail?: unknown }[] = [];
  const check = (name: string, pass: boolean, detail?: unknown) => checks.push({ name, pass, detail });
  const makeCanvas = () => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 600;
    c.style.width = "800px"; c.style.height = "600px"; document.body.append(c); return c;
  };
  const snapshots = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  const capture = (canvas: HTMLCanvasElement, draw: () => unknown) => {
    const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true })!;
    draw(); // Copy in the submission task, before the presentation texture is discarded.
    ctx.drawImage(canvas, 0, 0);
    snapshots.set(canvas, copy);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  const pixel = (img: ImageData, x: number, y: number) => Array.from(img.data.slice((Math.round(y) * img.width + Math.round(x)) * 4, (Math.round(y) * img.width + Math.round(x)) * 4 + 4));
  const ink = (img: ImageData) => {
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0 && Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) > 30) n++;
    return n;
  };
  const borrow = () => ({ adapter, device, release() {} });
  const scatter = new LoomRenderer(), scene = new LoomSceneRenderer(), cubeRenderer = new LoomCubeRenderer();
  const a = makeCanvas(), b = makeCanvas(), c = makeCanvas();
  const bounds = { xMin: -1, xMax: 1, yMin: -1, yMax: 1, zMin: -1, zMax: 1 };
  const point = (x: number, y: number, z: number, category = 0): GpuScenePoint => ({ x, y, z, category, size: 1, trail: 0, t: 0, row: category });
  try {
    device.pushErrorScope("validation");
    check("2D renderer initializes", await scatter.init(a, borrow()));
    check("scene renderer initializes", await scene.init(b, borrow()));
    check("cube renderer initializes", await cubeRenderer.init(c, borrow()));
    scatter.uploadData([{ x: .25, y: .75, category: 0 }], { pointSize: 12, opacity: 1, palette: ["#ff0000"], clearColor: [0, 0, 0] });
    const small = capture(a, () => scatter.render(0, 1, 0, 1, 40));
    const center = pixel(small, 220, 170);
    check("2D point matches axis coordinates", center[0] > 200 && center[1] < 20, center);
    scatter.uploadData([{ x: .25, y: .75, category: 0 }], { pointSize: 24 });
    const large = capture(a, () => scatter.render(0, 1, 0, 1, 40));
    check("2D size changes actual pixels", ink(large) > ink(small) * 2, { small: ink(small), large: ink(large) });
    scatter.uploadData([{ x: .25, y: .75, category: 0 }], { opacity: .25 });
    const faint = capture(a, () => scatter.render(0, 1, 0, 1, 40));
    check("2D opacity changes actual pixels", pixel(faint, 220, 170)[0] < center[0] / 2);
    scatter.uploadData([]);
    check("2D empty upload clears old points", ink(capture(a, () => scatter.render(0, 1, 0, 1))) === 0);

    const points = [point(-.6, -.4, .2), point(.6, .3, -.3, 1), point(.1, .7, .7, 2)];
    for (const camera of [{ yaw: 0, pitch: 0, zoom: 1 }, { yaw: .9, pitch: -.3, zoom: 1.4 }]) {
      const layout = orbitSceneLayout({ points, ...bounds }, 800, 600, 40, camera);
      scene.uploadData(layout.projected.map(p => p.p), bounds, { ...camera, mode: "scatter3d", pointSize: 16, opacity: 1, palette: ["#ff0000", "#00ff00", "#0000ff"], clearColor: [0, 0, 0], orbitFrame: layout.frame });
      const img = capture(b, () => scene.render(800, 600));
      check(`Orbit GPU matches CPU axes/hit projection at yaw ${camera.yaw}`, layout.projected.every(p => pixel(img, p.sx, p.sy)[p.p.category] > 100), layout.projected.map(p => ({ x: p.sx, y: p.sy, pixel: pixel(img, p.sx, p.sy) })));
    }
    const overlap = [point(0, 0, .5, 0), point(0, 0, -.5, 1)];
    const layout = orbitSceneLayout({ points: overlap, ...bounds }, 800, 600, 40, { yaw: 0, pitch: 0 });
    scene.uploadData(layout.projected.map(p => p.p), bounds, { yaw: 0, pitch: 0, zoom: 1, orbitFrame: layout.frame, opacity: .7 });
    const overlapPixel = pixel(capture(b, () => scene.render(800, 600)), layout.frame.cx, layout.frame.cy);
    check("Near orbit point blends over far point", overlapPixel[1] > overlapPixel[0], overlapPixel);
    b.width = 1600; b.height = 1200;
    const retinaPixel = pixel(capture(b, () => scene.render(800, 600)), layout.frame.cx * 2, layout.frame.cy * 2);
    check("Orbit resize to Retina preserves projected positions", retinaPixel[1] > retinaPixel[0], retinaPixel);
    b.width = 800; b.height = 600;
    scene.uploadData([], bounds);
    check("Orbit empty upload clears old points", ink(capture(b, () => scene.render(800, 600))) === 0);
    for (const mode of ["scatter3d", "firefly"] as const) {
      scene.uploadData([point(0, 0, 0)], bounds, { mode, pointSize: 8, opacity: 1, plotRect: { left: 0, top: 0, right: 800, bottom: 600 }, orbitFrame: { cx: 400, cy: 300, scale: 100 } });
      const small = capture(b, () => scene.render(800, 600));
      scene.uploadData([point(0, 0, 0)], bounds, { pointSize: 24 });
      const big = capture(b, () => scene.render(800, 600));
      check(`${mode} size changes GPU pixels`, ink(big) > ink(small) * 2);
      scene.uploadData([point(0, 0, 0)], bounds, { opacity: .2 });
      const faint = capture(b, () => scene.render(800, 600));
      check(`${mode} opacity changes GPU pixels`, pixel(faint, 400, 300)[0] < pixel(big, 400, 300)[0] / 2);
    }
    scene.uploadData([], bounds);
    check("Firefly empty upload clears old points", ink(capture(b, () => scene.render(800, 600))) === 0);
    scene.uploadData([point(-.5, .5, 0)], bounds, { mode: "firefly", pointSize: 12, opacity: 1, plotRect: { left: 40, right: 760, top: 40, bottom: 560 } });
    check("Firefly shader matches plot coordinates", pixel(capture(b, () => scene.render(800, 600)), 220, 170)[0] > 100);

    const cube = buildDataCube([["A", "A", "A", 10], ["B", "B", "B", 20]], ["x", "y", "z", "value"], { xField: "x", yField: "y", zField: "z", valueField: "value", aggregate: "sum" })!;
    const view = cubeView({ yaw: .5, pitch: .3, zoom: 1 }, 800, 600);
    const cubePixels = ink(capture(c, () => cubeRenderer.render(cube, view, ["#ff0000", "#00ff00"], .9)));
    check("Cube shader paints visible voxels", cubePixels > 100, cubePixels);

    // End-to-end CPU submission + GPU completion latency, not isolated shader timestamps.
    const dense = Array.from({ length: 50_000 }, (_, i) => ({ x: (i * 73 % 50000) / 50000, y: (i * 139 % 50000) / 50000, category: i % 3 }));
    scatter.uploadData(dense, { pointSize: 4, opacity: .7 });
    const completed: number[] = [], frames: number[] = [];
    let previous = 0;
    for (let i = 0; i < 130; i++) {
      const frame = await new Promise<number>(resolve => requestAnimationFrame(resolve));
      const start = performance.now();
      await scatter.render(0, 1, 0, 1, 40);
      if (i >= 10) { completed.push(performance.now() - start); frames.push(frame - previous); }
      previous = frame;
    }
    const percentile = (values: number[], p: number) => [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * p)];
    const timing = { points: dense.length, samples: completed.length, submissionToCompletionP50ms: percentile(completed, .5), submissionToCompletionP95ms: percentile(completed, .95), frameIntervalP50ms: percentile(frames, .5), frameIntervalP95ms: percentile(frames, .95) };
    capture(a, () => scatter.render(0, 1, 0, 1, 40));
    await device.queue.onSubmittedWorkDone();
    const validation = await device.popErrorScope();
    if (validation) errors.push(validation.message);
    check("No GPU validation errors", errors.length === 0, errors);
    return { adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter }, checks, timing };
  } finally {
    for (const [canvas, copy] of snapshots) canvas.replaceWith(copy);
    scatter.destroy(); scene.destroy(); cubeRenderer.destroy(); lease.release();
  }
}
Object.assign(window, { runHardwareChecks });
