// cspell:ignore tflite
export const AVATAR_MATTING_INPUT_SIZE = 256;
export const AVATAR_MATTING_INITIAL_TARGET_FPS = 15;
export const AVATAR_MATTING_LOW_OUTPUT_DIMENSION = 720;
export const AVATAR_MATTING_MAX_OUTPUT_DIMENSION = 1080;
export const AVATAR_MATTING_TARGET_FPS = 30;
export const AVATAR_MATTING_REGION_RATIO = 0.375;
export const AVATAR_MATTING_TRANSITION_RATIO = 0.06;
export const AVATAR_MATTING_MIN_REGION_SIZE = 0.05;
export const AVATAR_MATTING_MAX_FEATHER = 0.25;
export const DEFAULT_AVATAR_MATTING_ASSET_ROOT = '/avatar-matting';

export function nextAvatarMattingTimestamp(candidate: number, previous: number): number {
  return Math.max(Math.floor(candidate), previous + 1);
}

export interface AvatarMattingRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number;
}

export const DEFAULT_AVATAR_MATTING_REGION: AvatarMattingRegion = {
  x: 0,
  y: 0,
  w: 1,
  h: AVATAR_MATTING_REGION_RATIO,
  feather: AVATAR_MATTING_TRANSITION_RATIO,
};

export type AvatarMattingPhase = 'off' | 'loading' | 'waiting-video' | 'running' | 'error';
export type AvatarMattingTargetFps = 10 | 15 | 20 | 30;

export interface AvatarMattingTiming {
  sourceFps: number;
  sourceFramePeriodMs: number;
  targetFps: AvatarMattingTargetFps;
  inferenceP95Ms: number;
  outputMaxDimension: number;
  warmingUp: boolean;
  captureMs: number;
  inferenceMs: number;
  transportMs: number;
  uploadMs: number;
  endToEndMs: number;
  compositeMs: number;
  framePeriodMs: number;
  idleMs: number;
  modelLoadMs: number;
  firstMaskMs: number;
}

export interface AvatarMattingStatus {
  phase: AvatarMattingPhase;
  fps?: number;
  inferenceMs?: number;
  delegate?: 'GPU' | 'CPU';
  message?: string;
  timing?: AvatarMattingTiming;
}

export type AvatarMattingWorkerMessage =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | {
      type: 'result';
      requestId: number;
      width: number;
      height: number;
      pixels: Uint8ClampedArray;
      inferenceMs: number;
    }
  | { type: 'error'; message: string };

export type AvatarMattingWorkerRequest =
  | { type: 'initialize'; wasmRoot: string; modelUrl: string }
  | { type: 'segment'; requestId: number; bitmap: ImageBitmap; timestampMs: number }
  | { type: 'dispose' };

export function confidenceValuesToMaskPixels(values: Float32Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(Math.min(1, Math.max(0, values[index] ?? 0)) * 255);
  }
  return pixels;
}

export function fitAvatarMattingOutput(
  width: number,
  height: number,
  maxDimension = AVATAR_MATTING_MAX_OUTPUT_DIMENSION,
): { width: number; height: number } {
  const safeWidth = Math.max(2, width || 2);
  const safeHeight = Math.max(2, height || 2);
  const scale = Math.min(1, Math.max(2, maxDimension) / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(2, Math.round(safeWidth * scale)),
    height: Math.max(2, Math.round(safeHeight * scale)),
  };
}

export function avatarMattingInferenceP95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function recommendAvatarMattingTargetFps(
  delegate: 'GPU' | 'CPU' | undefined,
  inferenceP95Ms: number,
): AvatarMattingTargetFps {
  if (delegate !== 'GPU') return 10;
  if (inferenceP95Ms <= 20) return 30;
  if (inferenceP95Ms <= 35) return 20;
  if (inferenceP95Ms <= 55) return 15;
  return 10;
}

export function stepAvatarMattingTargetFps(
  current: AvatarMattingTargetFps,
  recommended: AvatarMattingTargetFps,
): AvatarMattingTargetFps {
  if (recommended <= current) return recommended;
  if (current === 10) return 15;
  if (current === 15) return 20;
  return 30;
}

export interface AvatarMattingPerformanceSample {
  completedFrames: number;
  elapsedMs: number;
  captureMsTotal: number;
  inferenceMsTotal: number;
  inferenceMsSamples: number[];
  transportMsTotal: number;
  uploadMsTotal: number;
  endToEndMsTotal: number;
  compositeMsTotal: number;
  compositeSamples: number;
  sourceFrameMsTotal: number;
  sourceFrameSamples: number;
}

export interface AvatarMattingAdaptationInput {
  delegate: 'GPU' | 'CPU' | undefined;
  targetFps: AvatarMattingTargetFps;
  stableWindows: number;
  poorWindows: number;
  criticalWindows: number;
  firstMaskAt: number;
  completedAt: number;
  modelLoadMs: number;
  firstMaskMs: number;
  sample: AvatarMattingPerformanceSample;
}

export interface AvatarMattingAdaptationResult {
  targetFps: AvatarMattingTargetFps;
  outputMaxDimension: number;
  stableWindows: number;
  poorWindows: number;
  criticalWindows: number;
  failCritical: boolean;
  outputFps: number;
  inferenceMsAverage: number;
  timing: AvatarMattingTiming;
  message: string;
}

export function adaptAvatarMattingPerformance(
  input: AvatarMattingAdaptationInput,
): AvatarMattingAdaptationResult {
  const { sample, delegate, firstMaskAt, completedAt, modelLoadMs, firstMaskMs } = input;
  let { targetFps, stableWindows, poorWindows, criticalWindows } = input;

  const captureMsAverage = sample.captureMsTotal / sample.completedFrames;
  const inferenceMsAverage = sample.inferenceMsTotal / sample.completedFrames;
  const inferenceP95Ms = avatarMattingInferenceP95(sample.inferenceMsSamples);
  const transportMsAverage = sample.transportMsTotal / sample.completedFrames;
  const uploadMsAverage = sample.uploadMsTotal / sample.completedFrames;
  const endToEndMsAverage = sample.endToEndMsTotal / sample.completedFrames;
  const framePeriodMs = sample.elapsedMs / sample.completedFrames;
  const sourceFramePeriodMs =
    sample.sourceFrameSamples > 0 ? sample.sourceFrameMsTotal / sample.sourceFrameSamples : 0;
  const sourceFps = sourceFramePeriodMs > 0 ? 1000 / sourceFramePeriodMs : 0;
  const outputFps = (sample.completedFrames * 1000) / sample.elapsedMs;
  const warmedUp = delegate === 'CPU' || (firstMaskAt > 0 && completedAt - firstMaskAt >= 5000);
  let recommendedTargetFps = recommendAvatarMattingTargetFps(delegate, inferenceP95Ms);
  const expectedFps = Math.min(sourceFps || targetFps, targetFps);
  const trackingRatio = expectedFps > 0 ? outputFps / expectedFps : 1;
  if (trackingRatio < 0.75 && recommendedTargetFps >= targetFps && targetFps > 10) {
    recommendedTargetFps = targetFps === 30 ? 20 : targetFps === 20 ? 15 : 10;
  }

  if (warmedUp && delegate === 'GPU') {
    if (recommendedTargetFps > targetFps) {
      stableWindows += 1;
      poorWindows = 0;
      if (stableWindows >= 3) {
        targetFps = stepAvatarMattingTargetFps(targetFps, recommendedTargetFps);
        stableWindows = 0;
      }
    } else if (recommendedTargetFps < targetFps) {
      stableWindows = 0;
      poorWindows += 1;
      if ((recommendedTargetFps === 10 && inferenceP95Ms > 80) || poorWindows >= 2) {
        targetFps = recommendedTargetFps;
        poorWindows = 0;
      }
    } else {
      stableWindows = 0;
      poorWindows = 0;
    }
  }

  const outputMaxDimension =
    targetFps === 10 ? AVATAR_MATTING_LOW_OUTPUT_DIMENSION : AVATAR_MATTING_MAX_OUTPUT_DIMENSION;
  criticalWindows = targetFps === 10 && inferenceP95Ms > 120 ? criticalWindows + 1 : 0;
  const timing: AvatarMattingTiming = {
    sourceFps,
    sourceFramePeriodMs,
    targetFps,
    inferenceP95Ms,
    outputMaxDimension,
    warmingUp: !warmedUp,
    captureMs: captureMsAverage,
    inferenceMs: inferenceMsAverage,
    transportMs: transportMsAverage,
    uploadMs: uploadMsAverage,
    endToEndMs: endToEndMsAverage,
    compositeMs:
      sample.compositeSamples > 0 ? sample.compositeMsTotal / sample.compositeSamples : 0,
    framePeriodMs,
    idleMs: Math.max(0, framePeriodMs - endToEndMsAverage),
    modelLoadMs,
    firstMaskMs,
  };

  return {
    targetFps,
    outputMaxDimension,
    stableWindows,
    poorWindows,
    criticalWindows,
    failCritical: criticalWindows >= 5,
    outputFps,
    inferenceMsAverage,
    timing,
    message: `${timing.warmingUp ? 'Warming up' : `Target ${targetFps} FPS`} · P95 ${inferenceP95Ms.toFixed(1)}ms · Capture ${captureMsAverage.toFixed(1)}ms · Inference ${inferenceMsAverage.toFixed(1)}ms · Transport ${transportMsAverage.toFixed(1)}ms · Upload ${uploadMsAverage.toFixed(1)}ms · Composite ${timing.compositeMs.toFixed(1)}ms`,
  };
}

export function advanceAvatarMattingDeadline(
  previousAt: number,
  now: number,
  intervalMs: number,
): number {
  if (previousAt <= 0 || now <= previousAt || intervalMs <= 0) return now;
  return previousAt + Math.floor((now - previousAt) / intervalMs) * intervalMs;
}

export function avatarMattingBoundary(height: number): number {
  return Math.round(Math.max(0, height) * AVATAR_MATTING_REGION_RATIO);
}

export function avatarMattingTransition(height: number): { start: number; end: number } {
  const safeHeight = Math.max(0, height);
  const end = avatarMattingBoundary(safeHeight);
  return {
    start: Math.max(0, Math.round(end - safeHeight * AVATAR_MATTING_TRANSITION_RATIO)),
    end,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeAvatarMattingRegion(
  value?: Partial<AvatarMattingRegion> | null,
): AvatarMattingRegion {
  const rawX =
    typeof value?.x === 'number' && Number.isFinite(value.x)
      ? value.x
      : DEFAULT_AVATAR_MATTING_REGION.x;
  const rawY =
    typeof value?.y === 'number' && Number.isFinite(value.y)
      ? value.y
      : DEFAULT_AVATAR_MATTING_REGION.y;
  const x = clamp(rawX, 0, 1 - AVATAR_MATTING_MIN_REGION_SIZE);
  const y = clamp(rawY, 0, 1 - AVATAR_MATTING_MIN_REGION_SIZE);
  const rawW =
    typeof value?.w === 'number' && Number.isFinite(value.w)
      ? value.w
      : DEFAULT_AVATAR_MATTING_REGION.w;
  const rawH =
    typeof value?.h === 'number' && Number.isFinite(value.h)
      ? value.h
      : DEFAULT_AVATAR_MATTING_REGION.h;
  const rawFeather =
    typeof value?.feather === 'number' && Number.isFinite(value.feather)
      ? value.feather
      : DEFAULT_AVATAR_MATTING_REGION.feather;
  return {
    x,
    y,
    w: clamp(rawW, AVATAR_MATTING_MIN_REGION_SIZE, 1 - x),
    h: clamp(rawH, AVATAR_MATTING_MIN_REGION_SIZE, 1 - y),
    feather: clamp(rawFeather, 0, AVATAR_MATTING_MAX_FEATHER),
  };
}

/**
 * Alpha used to remove the original frame inside the configurable matting region.
 * A region edge that touches the video edge is treated as open, so the compatible
 * default only feathers its lower boundary just like the original implementation.
 */
export function avatarMattingRegionAlpha(
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
  value?: Partial<AvatarMattingRegion> | null,
): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const region = normalizeAvatarMattingRegion(value);
  const left = region.x * safeWidth;
  const top = region.y * safeHeight;
  const right = (region.x + region.w) * safeWidth;
  const bottom = (region.y + region.h) * safeHeight;
  if (pixelX < left || pixelX > right || pixelY < top || pixelY > bottom) return 0;

  const edgeDistances: number[] = [];
  if (region.x > 0) edgeDistances.push(pixelX - left);
  if (region.y > 0) edgeDistances.push(pixelY - top);
  if (region.x + region.w < 1) edgeDistances.push(right - pixelX);
  if (region.y + region.h < 1) edgeDistances.push(bottom - pixelY);
  if (edgeDistances.length === 0 || region.feather === 0) return 1;

  const featherPixels = Math.max(1, region.feather * safeHeight);
  return clamp(Math.min(...edgeDistances) / featherPixels, 0, 1);
}

export function resolveAvatarMattingAssetUrls(
  assetRoot: string,
  origin: string,
): { wasmRoot: string; modelUrl: string } {
  const normalizedRoot = assetRoot.replace(/\/$/, '');
  const absoluteRoot = new URL(`${normalizedRoot}/`, origin).href.replace(/\/$/, '');
  return {
    wasmRoot: `${absoluteRoot}/wasm`,
    modelUrl: `${absoluteRoot}/models/selfie_segmenter.tflite`,
  };
}
