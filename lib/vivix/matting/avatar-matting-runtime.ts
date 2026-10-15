import {
  AVATAR_MATTING_INPUT_SIZE,
  type AvatarMattingWorkerMessage,
  type AvatarMattingWorkerRequest,
  DEFAULT_AVATAR_MATTING_ASSET_ROOT,
  resolveAvatarMattingAssetUrls,
} from './avatar-matting';

const AVATAR_MATTING_IDLE_RELEASE_MS = 90_000;

export interface AvatarMattingRuntimeResult {
  requestId: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  inferenceMs: number;
}

export interface AvatarMattingRuntimeLease {
  delegate: 'GPU' | 'CPU';
  segment: (bitmap: ImageBitmap, timestampMs: number) => Promise<AvatarMattingRuntimeResult>;
  prewarmReference: (referenceImageUrl: string) => Promise<boolean>;
  release: () => void;
}

interface PendingSegment {
  requestId: number;
  resolve: (result: AvatarMattingRuntimeResult) => void;
  reject: (error: Error) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createNeutralPrewarmBitmap(): Promise<ImageBitmap> {
  const pixels = new Uint8ClampedArray(AVATAR_MATTING_INPUT_SIZE * AVATAR_MATTING_INPUT_SIZE * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 127;
    pixels[offset + 1] = 127;
    pixels[offset + 2] = 127;
    pixels[offset + 3] = 255;
  }
  return createImageBitmap(
    new ImageData(pixels, AVATAR_MATTING_INPUT_SIZE, AVATAR_MATTING_INPUT_SIZE),
  );
}

class AvatarMattingRuntime {
  private worker: Worker | null = null;
  private readyPromise: Promise<'GPU' | 'CPU'> | null = null;
  private resolveReady: ((delegate: 'GPU' | 'CPU') => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private pendingSegment: PendingSegment | null = null;
  private segmentTail: Promise<void> = Promise.resolve();
  private requestId = 0;
  private leases = 0;
  private idleTimer = 0;
  private prewarmComplete = false;
  private prewarmPromise: Promise<boolean> | null = null;

  constructor(
    private readonly wasmRoot: string,
    private readonly modelUrl: string,
  ) {}

  async acquire(): Promise<AvatarMattingRuntimeLease> {
    this.leases += 1;
    this.cancelIdleRelease();
    try {
      const delegate = await this.ensureReady();
      let released = false;
      return {
        delegate,
        segment: (bitmap, timestampMs) => this.segment(bitmap, timestampMs),
        prewarmReference: (referenceImageUrl) => this.prewarmReference(referenceImageUrl),
        release: () => {
          if (released) return;
          released = true;
          this.leases = Math.max(0, this.leases - 1);
          this.scheduleIdleRelease();
        },
      };
    } catch (error) {
      this.leases = Math.max(0, this.leases - 1);
      this.scheduleIdleRelease();
      throw error;
    }
  }

  dispose(): void {
    this.cancelIdleRelease();
    const error = new Error('Matting runtime was disposed.');
    this.pendingSegment?.reject(error);
    this.pendingSegment = null;
    this.rejectReady?.(error);
    try {
      this.worker?.postMessage({ type: 'dispose' } satisfies AvatarMattingWorkerRequest);
    } catch {
      // A crashed Worker can reject postMessage; termination still owns cleanup.
    }
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.segmentTail = Promise.resolve();
    this.prewarmComplete = false;
    this.prewarmPromise = null;
  }

  private ensureReady(): Promise<'GPU' | 'CPU'> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<'GPU' | 'CPU'>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const worker = new Worker(new URL('./avatar-matting-worker.ts', import.meta.url));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<AvatarMattingWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        this.resolveReady?.(message.delegate);
        this.resolveReady = null;
        this.rejectReady = null;
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.message);
        if (this.pendingSegment) {
          this.pendingSegment.reject(error);
          this.pendingSegment = null;
        } else {
          this.rejectReady?.(error);
          this.rejectReady = null;
          this.resolveReady = null;
          this.dispose();
        }
        return;
      }
      if (this.pendingSegment?.requestId !== message.requestId) return;
      const pending = this.pendingSegment;
      this.pendingSegment = null;
      pending.resolve(message);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Matting worker failed.');
      this.pendingSegment?.reject(error);
      this.pendingSegment = null;
      this.rejectReady?.(error);
      this.dispose();
    };
    const readyPromise = this.readyPromise;
    try {
      worker.postMessage({
        type: 'initialize',
        wasmRoot: this.wasmRoot,
        modelUrl: this.modelUrl,
      } satisfies AvatarMattingWorkerRequest);
    } catch {
      this.dispose();
      return readyPromise;
    }
    return readyPromise;
  }

  private segment(bitmap: ImageBitmap, timestampMs: number): Promise<AvatarMattingRuntimeResult> {
    const run = this.segmentTail.then(async () => {
      await this.ensureReady();
      const worker = this.worker;
      if (!worker) {
        bitmap.close();
        throw new Error('Matting runtime is not ready.');
      }
      this.requestId += 1;
      const requestId = this.requestId;
      return new Promise<AvatarMattingRuntimeResult>((resolve, reject) => {
        this.pendingSegment = { requestId, resolve, reject };
        const request: AvatarMattingWorkerRequest = {
          type: 'segment',
          requestId,
          bitmap,
          timestampMs,
        };
        try {
          worker.postMessage(request, [bitmap]);
        } catch (error) {
          this.pendingSegment = null;
          bitmap.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    this.segmentTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private prewarmReference(referenceImageUrl: string): Promise<boolean> {
    const url = referenceImageUrl.trim();
    if (this.prewarmComplete) return Promise.resolve(true);
    if (this.prewarmPromise) return this.prewarmPromise;

    const warming = (async () => {
      let bitmap: ImageBitmap | null = null;
      try {
        if (url) {
          try {
            const response = await fetch(url, { cache: 'force-cache', mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            bitmap = await createImageBitmap(blob, {
              resizeWidth: AVATAR_MATTING_INPUT_SIZE,
              resizeHeight: AVATAR_MATTING_INPUT_SIZE,
              resizeQuality: 'low',
            });
          } catch {
            bitmap = await createNeutralPrewarmBitmap();
          }
        } else {
          bitmap = await createNeutralPrewarmBitmap();
        }
        await this.segment(bitmap, performance.now());
        bitmap = null;
        this.prewarmComplete = true;
        return true;
      } catch (error) {
        bitmap?.close();
        console.warn(`[avatar-matting] Reference prewarm skipped: ${errorMessage(error)}`);
        return false;
      } finally {
        this.prewarmPromise = null;
      }
    })();
    this.prewarmPromise = warming;
    return warming;
  }

  private scheduleIdleRelease(): void {
    if (this.leases > 0 || this.idleTimer) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = 0;
      if (this.leases === 0) this.dispose();
    }, AVATAR_MATTING_IDLE_RELEASE_MS);
  }

  private cancelIdleRelease(): void {
    if (!this.idleTimer) return;
    window.clearTimeout(this.idleTimer);
    this.idleTimer = 0;
  }
}

const runtimes = new Map<string, AvatarMattingRuntime>();

function runtimeFor(assetRoot: string, origin: string): AvatarMattingRuntime {
  const urls = resolveAvatarMattingAssetUrls(assetRoot, origin);
  const key = `${urls.wasmRoot}\n${urls.modelUrl}`;
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = new AvatarMattingRuntime(urls.wasmRoot, urls.modelUrl);
    runtimes.set(key, runtime);
  }
  return runtime;
}

export function acquireAvatarMattingRuntime(
  assetRoot = DEFAULT_AVATAR_MATTING_ASSET_ROOT,
  origin = window.location.origin,
): Promise<AvatarMattingRuntimeLease> {
  return runtimeFor(assetRoot, origin).acquire();
}
