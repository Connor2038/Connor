import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve the assets from the installed, locked SDK; no third-party runtime CDN.
const sdk = dirname(fileURLToPath(import.meta.resolve('trtc-sdk-v5')));
const target = join(process.cwd(), 'public', 'trtc-assets');
await mkdir(target, { recursive: true });
for (const file of ['denoiser-wasm.js', 'denoiser-wasm-nosimd.js']) {
  await cp(join(sdk, 'assets', file), join(target, file));
}
const vision = dirname(fileURLToPath(import.meta.resolve('@mediapipe/tasks-vision')));
await cp(join(vision, 'wasm'), join(process.cwd(), 'public/avatar-matting/wasm'), {
  recursive: true,
});
