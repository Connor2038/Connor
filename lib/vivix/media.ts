import type TRTCType from 'trtc-sdk-v5';
import { Microphone } from './microphone';
import { PlaybackObserver } from './playback';
import type { SessionConnection } from './types';
export class AvatarMedia {
  private client: TRTCType | null = null;
  private publisher = '';
  private view: HTMLElement | null = null;
  private remote: {
    userId: string;
    streamType: Parameters<TRTCType['updateRemoteVideo']>[0]['streamType'];
  } | null = null;
  private microphone: Microphone | null = null;
  private resumePlayback: (() => Promise<void>) | null = null;
  readonly playback = new PlaybackObserver();
  async connect(
    session: SessionConnection,
    view: HTMLElement,
    onReady: () => void,
    onError: (error: Error) => void,
    onAudio: () => void,
    onBlocked: () => void,
    signal: AbortSignal,
    onWarning: (message: string) => void,
  ) {
    const { default: TRTC } = await import('trtc-sdk-v5');
    signal.throwIfAborted();
    const info = session.delivery?.media?.trtc;
    if (!info?.publisher_user_id || !info.user_sig)
      throw new Error('Vivix did not provide valid media connection information.');
    this.publisher = info.publisher_user_id;
    const client = TRTC.create({ enableSEI: true });
    this.client = client;
    this.view = view;
    this.microphone = new Microphone(client, info, onWarning);
    const subscriptions = new Set<string>();
    client.on(TRTC.EVENT.REMOTE_VIDEO_AVAILABLE, ({ userId, streamType }) => {
      const key = `${userId}:${streamType}`;
      if (this.client !== client || userId !== this.publisher || subscriptions.has(key)) return;
      subscriptions.add(key);
      const target = this.view;
      if (!target) return;
      void client
        .startRemoteVideo({ userId, streamType, view: target })
        .then(() => {
          if (this.client === client) this.remote = { userId, streamType };
        })
        .catch((error) => {
          subscriptions.delete(key);
          if (this.client === client && !signal.aborted) onError(new Error(String(error)));
        });
    });
    client.on(TRTC.EVENT.REMOTE_VIDEO_UNAVAILABLE, ({ userId, streamType }) => {
      subscriptions.delete(`${userId}:${streamType}`);
      if (this.remote?.userId === userId && this.remote.streamType === streamType)
        this.remote = null;
    });
    client.on(TRTC.EVENT.TRACK, ({ userId, track }) => {
      if (this.client === client && userId === this.publisher && track.kind === 'audio')
        this.playback.attach(track, onAudio);
    });
    client.on(TRTC.EVENT.FIRST_VIDEO_FRAME, ({ userId }) => {
      if (this.client === client && userId === this.publisher) onReady();
    });
    client.on(TRTC.EVENT.AUTOPLAY_FAILED, ({ resume }) => {
      this.resumePlayback = resume;
      onBlocked();
    });
    client.on(TRTC.EVENT.ERROR, (error) => {
      if (this.client === client && !signal.aborted) onError(new Error(error.message));
    });
    await client.enterRoom({
      sdkAppId: Number(info.sdk_app_id),
      userId: info.user_id,
      userSig: info.user_sig,
      strRoomId: info.room_id,
      scene: TRTC.TYPE.SCENE_RTC,
    });
    if (signal.aborted) await this.close();
  }
  async enableAudio() {
    await this.resumePlayback?.();
    await this.playback.resume();
    this.resumePlayback = null;
  }
  async bindView(view: HTMLElement) {
    this.view = view;
    if (this.client && this.remote)
      await this.client.updateRemoteVideo({ ...this.remote, view });
  }
  async toggleMicrophone(): Promise<boolean> {
    if (!this.microphone) throw new Error('Media is not connected.');
    return this.microphone.toggle();
  }

  async close() {
    this.playback.close();
    const client = this.client;
    this.client = null;
    this.view = null;
    this.remote = null;
    const microphone = this.microphone;
    this.microphone = null;
    this.resumePlayback = null;
    if (!client) return;
    try {
      try {
        await microphone?.close();
      } finally {
        await client.exitRoom();
      }
    } finally {
      client.destroy();
    }
  }
}
