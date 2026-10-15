// cspell:ignore Fileset mediapipe
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

import {
  type AvatarMattingWorkerMessage,
  type AvatarMattingWorkerRequest,
  confidenceValuesToMaskPixels,
  nextAvatarMattingTimestamp,
} from './avatar-matting';

type WorkerScope = {
  onmessage: ((event: MessageEvent<AvatarMattingWorkerRequest>) => void) | null;
  postMessage: (message: AvatarMattingWorkerMessage, transfer?: Transferable[]) => void;
  close: () => void;
};

const workerScope = globalThis as unknown as WorkerScope;
let segmenter: ImageSegmenter | null = null;
let lastTimestampMs = -1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function initialize(wasmRoot: string, modelUrl: string): Promise<void> {
  try {
    // Turbopack boots workers through importScripts; use the classic WASM loader.
    const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
    const create = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });

    let delegate: 'GPU' | 'CPU' = 'GPU';
    try {
      segmenter = await create(delegate);
    } catch (gpuError) {
      console.warn('[avatar-matting] GPU delegate unavailable; using CPU.', gpuError);
      delegate = 'CPU';
      segmenter = await create(delegate);
    }
    workerScope.postMessage({ type: 'ready', delegate });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: `Matting model failed to load: ${errorMessage(error)}`,
    });
  }
}

workerScope.onmessage = (event) => {
  if (event.data.type === 'dispose') {
    segmenter?.close();
    segmenter = null;
    lastTimestampMs = -1;
    workerScope.close();
    return;
  }
  if (event.data.type === 'initialize') {
    if (!segmenter) void initialize(event.data.wasmRoot, event.data.modelUrl);
    return;
  }

  const { bitmap, requestId, timestampMs } = event.data;
  if (!segmenter) {
    bitmap.close();
    workerScope.postMessage({ type: 'error', message: 'The matting model is not ready.' });
    return;
  }

  const startedAt = performance.now();
  try {
    lastTimestampMs = nextAvatarMattingTimestamp(timestampMs, lastTimestampMs);
    const result = segmenter.segmentForVideo(bitmap, lastTimestampMs);
    try {
      const masks = result.confidenceMasks ?? [];
      const mask = masks[1] ?? masks[0];
      if (!mask) throw new Error('The model returned no person mask.');
      const pixels = confidenceValuesToMaskPixels(mask.getAsFloat32Array());
      workerScope.postMessage(
        {
          type: 'result',
          requestId,
          width: mask.width,
          height: mask.height,
          pixels,
          inferenceMs: performance.now() - startedAt,
        },
        [pixels.buffer],
      );
    } finally {
      result.close();
    }
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: `Matting inference failed: ${errorMessage(error)}`,
    });
  } finally {
    bitmap.close();
  }
};
