import type TRTC from 'trtc-sdk-v5';
import type { SessionConnection } from './types';

// Same browser 3A and far-field policy as the public Playground.
export const MICROPHONE_OPTIONS = {
  option: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
export class Microphone {
  private enabled = false;
  private denoising = false;
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private client: TRTC,
    private credentials: SessionConnection['delivery']['media']['trtc'],
    private warning: (message: string) => void,
  ) {}
  toggle(): Promise<boolean> {
    const operation = this.pending.then(async () => {
      if (this.closed) throw new Error('Media is not connected.');
      if (this.enabled) {
        await this.stop();
        return false;
      }
      await this.client.startLocalAudio(MICROPHONE_OPTIONS);
      this.enabled = true;
      if (this.closed) {
        await this.stop();
        return false;
      }
      try {
        const options = {
          sdkAppId: Number(this.credentials.sdk_app_id),
          userId: this.credentials.user_id,
          userSig: this.credentials.user_sig,
          assetsPath: `${location.origin}/trtc-assets/`,
          mode: 1 as const,
          farFieldReduceThreshold: 0.5,
        };
        await this.client.startPlugin('AIDenoiser', options);
        this.denoising = true;
      } catch {
        if (!this.closed)
          this.warning(
            'AI noise reduction is unavailable. Microphone uses browser echo cancellation and noise suppression.',
          );
      }
      if (this.closed) {
        await this.stop();
        return false;
      }
      return true;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  private async stop() {
    if (this.denoising) {
      await this.client.stopPlugin('AIDenoiser').catch(() => {});
      this.denoising = false;
    }
    if (this.enabled) await this.client.stopLocalAudio();
    this.enabled = false;
  }
  async close() {
    this.closed = true;
    await this.pending;
    await this.stop();
  }
}
