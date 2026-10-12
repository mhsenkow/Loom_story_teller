// =================================================================
// gpuDevice — shared WebGPU adapter/device ownership
// =================================================================
// Renderers borrow one ref-counted device lease. Renderers own their
// buffers/pipelines/contexts; this module owns adapter/device teardown.
// =================================================================

export interface SharedGpuDeviceLease {
  adapter: GPUAdapter;
  device: GPUDevice;
  release: () => void;
}

interface SharedGpuDeviceHandle {
  adapter: GPUAdapter;
  device: GPUDevice;
  refCount: number;
  lost: boolean;
}

const STORAGE_BUFFER_TARGET = 256 * 1024 * 1024;

let sharedHandle: SharedGpuDeviceHandle | null = null;
let pendingHandle: Promise<SharedGpuDeviceHandle | null> | null = null;

function deviceLimits(adapter: GPUAdapter): GPUDeviceDescriptor {
  const maxStorageBufferBindingSize = Math.min(
    STORAGE_BUFFER_TARGET,
    adapter.limits.maxStorageBufferBindingSize,
  );
  const maxBufferSize = Math.min(STORAGE_BUFFER_TARGET, adapter.limits.maxBufferSize);
  return {
    requiredLimits: {
      maxStorageBufferBindingSize,
      maxBufferSize,
    },
  };
}

async function createSharedHandle(): Promise<SharedGpuDeviceHandle | null> {
  if (typeof navigator === "undefined" || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return null;
  const device = await adapter.requestDevice(deviceLimits(adapter));
  const handle: SharedGpuDeviceHandle = {
    adapter,
    device,
    refCount: 0,
    lost: false,
  };
  void device.lost.then(() => {
    handle.lost = true;
    if (sharedHandle === handle) sharedHandle = null;
  });
  return handle;
}

export async function acquireSharedGpuDevice(): Promise<SharedGpuDeviceLease | null> {
  if (!sharedHandle || sharedHandle.lost) {
    if (!pendingHandle) {
      pendingHandle = createSharedHandle().finally(() => {
        pendingHandle = null;
      });
    }
    sharedHandle = await pendingHandle;
  }

  const handle = sharedHandle;
  if (!handle || handle.lost) return null;
  handle.refCount += 1;
  let released = false;

  return {
    adapter: handle.adapter,
    device: handle.device,
    release: () => {
      if (released) return;
      released = true;
      handle.refCount = Math.max(0, handle.refCount - 1);
      if (handle.refCount === 0 && sharedHandle === handle) {
        sharedHandle = null;
        handle.device.destroy();
      }
    },
  };
}
