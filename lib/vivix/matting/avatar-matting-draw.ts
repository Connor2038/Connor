import {
  type AvatarMattingRegion,
  avatarMattingRegionAlpha,
  fitAvatarMattingOutput,
} from './avatar-matting';

const AVATAR_MATTING_REGION_MASK_MAX_DIMENSION = 256;

type AvatarMattingRegionMask = HTMLCanvasElement & { regionKey?: string };

function ensureAvatarMattingRegionMask(
  mask: AvatarMattingRegionMask,
  width: number,
  height: number,
  region: AvatarMattingRegion,
): void {
  const scale = Math.min(1, AVATAR_MATTING_REGION_MASK_MAX_DIMENSION / Math.max(width, height));
  const maskWidth = Math.max(2, Math.round(width * scale));
  const maskHeight = Math.max(2, Math.round(height * scale));
  const key = `${maskWidth}:${maskHeight}:${region.x}:${region.y}:${region.w}:${region.h}:${region.feather}`;
  if (mask.regionKey === key) return;

  mask.width = maskWidth;
  mask.height = maskHeight;
  const context = mask.getContext('2d', { alpha: true });
  if (!context) return;
  const image = context.createImageData(maskWidth, maskHeight);
  for (let y = 0; y < maskHeight; y += 1) {
    for (let x = 0; x < maskWidth; x += 1) {
      const offset = (y * maskWidth + x) * 4;
      const alpha = avatarMattingRegionAlpha(x + 0.5, y + 0.5, maskWidth, maskHeight, region);
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
  mask.regionKey = key;
}

export function drawMatteFrame(
  output: HTMLCanvasElement,
  foreground: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  regionMask: AvatarMattingRegionMask,
  video: HTMLVideoElement,
  maxOutputDimension: number,
  mattingRegion: AvatarMattingRegion,
): boolean {
  if (!video.videoWidth || !video.videoHeight || !mask.width || !mask.height) return false;
  const size = fitAvatarMattingOutput(video.videoWidth, video.videoHeight, maxOutputDimension);
  if (output.width !== size.width || output.height !== size.height) {
    output.width = size.width;
    output.height = size.height;
    foreground.width = size.width;
    foreground.height = size.height;
  }

  const outputContext = output.getContext('2d', { alpha: true });
  const foregroundContext = foreground.getContext('2d', { alpha: true });
  if (!outputContext || !foregroundContext) return false;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  foregroundContext.imageSmoothingEnabled = true;
  foregroundContext.imageSmoothingQuality = 'high';

  foregroundContext.clearRect(0, 0, size.width, size.height);
  foregroundContext.globalCompositeOperation = 'source-over';
  foregroundContext.filter = 'none';
  foregroundContext.drawImage(video, 0, 0, size.width, size.height);
  foregroundContext.globalCompositeOperation = 'destination-in';
  foregroundContext.filter = 'blur(1px)';
  foregroundContext.drawImage(mask, 0, 0, size.width, size.height);
  foregroundContext.filter = 'none';
  foregroundContext.globalCompositeOperation = 'source-over';

  outputContext.clearRect(0, 0, size.width, size.height);
  outputContext.drawImage(foreground, 0, 0);

  // Restore the untouched source outside the configurable matting rectangle.
  // The region mask erases the source inside the rectangle and feathers only
  // edges that do not touch the video boundary.
  foregroundContext.clearRect(0, 0, size.width, size.height);
  foregroundContext.globalCompositeOperation = 'source-over';
  foregroundContext.drawImage(video, 0, 0, size.width, size.height);
  foregroundContext.globalCompositeOperation = 'destination-out';
  ensureAvatarMattingRegionMask(regionMask, size.width, size.height, mattingRegion);
  foregroundContext.drawImage(regionMask, 0, 0, size.width, size.height);
  foregroundContext.globalCompositeOperation = 'source-over';
  outputContext.drawImage(foreground, 0, 0);
  return true;
}
