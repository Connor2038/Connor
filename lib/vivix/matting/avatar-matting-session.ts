import {
  adaptAvatarMattingPerformance,
  advanceAvatarMattingDeadline,
  AVATAR_MATTING_INITIAL_TARGET_FPS,
  AVATAR_MATTING_INPUT_SIZE,
  AVATAR_MATTING_LOW_OUTPUT_DIMENSION,
  AVATAR_MATTING_MAX_OUTPUT_DIMENSION,
  type AvatarMattingRegion,
  type AvatarMattingStatus,
  type AvatarMattingTargetFps,
} from './avatar-matting';
import { drawMatteFrame } from './avatar-matting-draw';
import {
  acquireAvatarMattingRuntime,
  type AvatarMattingRuntimeLease,
  type AvatarMattingRuntimeResult,
} from './avatar-matting-runtime';

type FrameVideo = HTMLVideoElement & {
  cancelVideoFrameCallback?: (handle: number) => void;
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
};

export interface AvatarMattingSessionOptions {
  host: HTMLElement;
  assetRoot: string;
  getOutput: () => HTMLCanvasElement | null;
  getMattingRegion: () => AvatarMattingRegion;
  onStatusChange: (status: AvatarMattingStatus) => void;
  setMatteReady: (ready: boolean) => void;
  acquireRuntime?: (assetRoot: string) => Promise<AvatarMattingRuntimeLease>;
}

export function createAvatarMattingSession({
  host,
  assetRoot,
  getOutput,
  getMattingRegion,
  onStatusChange,
  setMatteReady,
  acquireRuntime = acquireAvatarMattingRuntime,
}: AvatarMattingSessionOptions): { dispose: () => void } {
  let disposed = false;
  let runtimeReady = false;
  let runtimeLease: AvatarMattingRuntimeLease | null = null;
  let delegate: 'GPU' | 'CPU' | undefined;
  let targetFps: AvatarMattingTargetFps = AVATAR_MATTING_INITIAL_TARGET_FPS;
  let outputMaxDimension = AVATAR_MATTING_MAX_OUTPUT_DIMENSION;
  let stableWindows = 0;
  let poorWindows = 0;
  let criticalWindows = 0;
  let inferenceBusy = false;
  let currentVideo: FrameVideo | null = null;
  let frameHandle = 0;
  let fallbackFrameHandle = 0;
  let lastInferenceAt = 0;
  let lastTimestampMs = 0;
  let completedFrames = 0;
  let statsStartedAt = 0;
  let captureMsTotal = 0;
  let inferenceMsTotal = 0;
  let inferenceMsSamples: number[] = [];
  let transportMsTotal = 0;
  let uploadMsTotal = 0;
  let endToEndMsTotal = 0;
  let compositeMsTotal = 0;
  let compositeSamples = 0;
  let sourceFrameMsTotal = 0;
  let sourceFrameSamples = 0;
  let previousSourceFrameAt = 0;
  const runtimeStartedAt = performance.now();
  let modelLoadMs = 0;
  let firstMaskMs = 0;
  let firstMaskAt = 0;
  let pendingRequest: { startedAt: number; postedAt: number; captureMs: number } | null = null;
  let maskReady = false;
  let outputReady = false;
  const foreground = document.createElement('canvas');
  const mask = document.createElement('canvas');
  const regionMask = document.createElement('canvas');
  const maskContext = mask.getContext('2d', { alpha: true });
  queueMicrotask(() => {
    if (!disposed) setMatteReady(false);
  });

  const fail = (message: string) => {
    if (disposed) return;
    maskReady = false;
    outputReady = false;
    setMatteReady(false);
    onStatusChange({ phase: 'error', message });
  };

  const cancelFrameLoop = () => {
    if (frameHandle && currentVideo?.cancelVideoFrameCallback)
      currentVideo.cancelVideoFrameCallback(frameHandle);
    if (fallbackFrameHandle) cancelAnimationFrame(fallbackFrameHandle);
    frameHandle = 0;
    fallbackFrameHandle = 0;
  };

  const captureForInference = async (video: HTMLVideoElement, now: number) => {
    inferenceBusy = true;
    const startedAt = performance.now();
    try {
      const bitmap = await createImageBitmap(video, {
        resizeWidth: AVATAR_MATTING_INPUT_SIZE,
        resizeHeight: AVATAR_MATTING_INPUT_SIZE,
        resizeQuality: 'low',
      });
      if (disposed || currentVideo !== video) {
        bitmap.close();
        inferenceBusy = false;
        return;
      }
      const captureMs = performance.now() - startedAt;
      lastTimestampMs = Math.max(lastTimestampMs + 1, now);
      const lease = runtimeLease;
      if (!lease) {
        bitmap.close();
        inferenceBusy = false;
        return;
      }
      pendingRequest = { startedAt, postedAt: performance.now(), captureMs };
      const result = await lease.segment(bitmap, lastTimestampMs);
      handleSegmentResult(result);
    } catch (error) {
      inferenceBusy = false;
      pendingRequest = null;
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  const tick = (now: number) => {
    const video = currentVideo;
    if (disposed || !video) return;
    if (previousSourceFrameAt > 0) {
      sourceFrameMsTotal += now - previousSourceFrameAt;
      sourceFrameSamples += 1;
    }
    previousSourceFrameAt = now;
    if (video.requestVideoFrameCallback) frameHandle = video.requestVideoFrameCallback(tick);
    else fallbackFrameHandle = requestAnimationFrame(tick);

    if (document.visibilityState !== 'visible') return;
    const output = getOutput();
    if (maskReady && output) {
      const compositeStartedAt = performance.now();
      const drawn = drawMatteFrame(
        output,
        foreground,
        mask,
        regionMask,
        video,
        outputMaxDimension,
        getMattingRegion(),
      );
      if (drawn && !outputReady) {
        outputReady = true;
        setMatteReady(true);
      }
      if (drawn) {
        compositeMsTotal += performance.now() - compositeStartedAt;
        compositeSamples += 1;
      }
    }
    const inferenceIntervalMs = 1000 / targetFps;
    if (
      runtimeReady &&
      !inferenceBusy &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      now - lastInferenceAt >= inferenceIntervalMs
    ) {
      lastInferenceAt = advanceAvatarMattingDeadline(lastInferenceAt, now, inferenceIntervalMs);
      void captureForInference(video, now);
    }
  };

  const startFrameLoop = () => {
    if (disposed || !runtimeReady || !currentVideo || frameHandle || fallbackFrameHandle) return;
    onStatusChange({ phase: 'loading', delegate, message: 'Waiting for the first mask' });
    tick(performance.now());
  };

  const bindVideo = () => {
    const video = host.querySelector('video') as FrameVideo | null;
    if (!video || video === currentVideo) return;
    cancelFrameLoop();
    currentVideo?.removeEventListener('loadeddata', startFrameLoop);
    currentVideo = video;
    maskReady = false;
    outputReady = false;
    setMatteReady(false);
    previousSourceFrameAt = 0;
    video.addEventListener('loadeddata', startFrameLoop);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) startFrameLoop();
  };

  const handleSegmentResult = (message: AvatarMattingRuntimeResult) => {
    if (disposed) return;
    inferenceBusy = false;
    if (!maskContext) {
      fail('This browser cannot create a matting canvas.');
      return;
    }
    const receivedAt = performance.now();
    const requestMetrics = pendingRequest;
    pendingRequest = null;
    const transportMs = requestMetrics
      ? Math.max(0, receivedAt - requestMetrics.postedAt - message.inferenceMs)
      : 0;
    const uploadStartedAt = performance.now();
    mask.width = message.width;
    mask.height = message.height;
    const pixels = new Uint8ClampedArray(message.pixels.length);
    pixels.set(message.pixels);
    maskContext.putImageData(new ImageData(pixels, message.width, message.height), 0, 0);
    const completedAt = performance.now();
    const uploadMs = completedAt - uploadStartedAt;
    const captureMs = requestMetrics?.captureMs ?? 0;
    const endToEndMs = requestMetrics
      ? completedAt - requestMetrics.startedAt
      : message.inferenceMs + uploadMs;
    maskReady = true;
    if (!firstMaskMs) {
      firstMaskMs = completedAt - runtimeStartedAt;
      firstMaskAt = completedAt;
    }
    if (!statsStartedAt) statsStartedAt = requestMetrics?.startedAt ?? completedAt;
    completedFrames += 1;
    captureMsTotal += captureMs;
    inferenceMsTotal += message.inferenceMs;
    inferenceMsSamples.push(message.inferenceMs);
    transportMsTotal += transportMs;
    uploadMsTotal += uploadMs;
    endToEndMsTotal += endToEndMs;
    const elapsedMs = completedAt - statsStartedAt;
    if (elapsedMs < 1000) return;

    const adapted = adaptAvatarMattingPerformance({
      delegate,
      targetFps,
      stableWindows,
      poorWindows,
      criticalWindows,
      firstMaskAt,
      completedAt,
      modelLoadMs,
      firstMaskMs,
      sample: {
        completedFrames,
        elapsedMs,
        captureMsTotal,
        inferenceMsTotal,
        inferenceMsSamples,
        transportMsTotal,
        uploadMsTotal,
        endToEndMsTotal,
        compositeMsTotal,
        compositeSamples,
        sourceFrameMsTotal,
        sourceFrameSamples,
      },
    });
    targetFps = adapted.targetFps;
    outputMaxDimension = adapted.outputMaxDimension;
    stableWindows = adapted.stableWindows;
    poorWindows = adapted.poorWindows;
    criticalWindows = adapted.criticalWindows;
    if (adapted.failCritical) {
      cancelFrameLoop();
      fail(
        'Background removal was disabled because this device is too slow. Showing the original video.',
      );
      return;
    }
    onStatusChange({
      phase: 'running',
      fps: adapted.outputFps,
      inferenceMs: adapted.inferenceMsAverage,
      delegate,
      timing: adapted.timing,
      message: adapted.message,
    });
    completedFrames = 0;
    captureMsTotal = 0;
    inferenceMsTotal = 0;
    inferenceMsSamples = [];
    transportMsTotal = 0;
    uploadMsTotal = 0;
    endToEndMsTotal = 0;
    compositeMsTotal = 0;
    compositeSamples = 0;
    sourceFrameMsTotal = 0;
    sourceFrameSamples = 0;
    statsStartedAt = completedAt;
  };

  const observer = new MutationObserver(bindVideo);
  observer.observe(host, { childList: true, subtree: true });
  bindVideo();
  onStatusChange({ phase: 'loading', message: 'Loading the matting model' });
  void acquireRuntime(assetRoot)
    .then((lease) => {
      if (disposed) {
        lease.release();
        return;
      }
      runtimeLease = lease;
      runtimeReady = true;
      delegate = lease.delegate;
      modelLoadMs = performance.now() - runtimeStartedAt;
      if (delegate === 'CPU') {
        targetFps = 10;
        outputMaxDimension = AVATAR_MATTING_LOW_OUTPUT_DIMENSION;
      }
      onStatusChange({ phase: 'loading', delegate, message: 'Waiting for the first mask' });
      bindVideo();
      startFrameLoop();
    })
    .catch((error) => {
      fail(error instanceof Error ? error.message : String(error));
    });

  return {
    dispose: () => {
      disposed = true;
      observer.disconnect();
      cancelFrameLoop();
      currentVideo?.removeEventListener('loadeddata', startFrameLoop);
      runtimeLease?.release();
      runtimeLease = null;
    },
  };
}
