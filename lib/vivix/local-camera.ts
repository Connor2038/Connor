export interface LocalCameraState {
  stream: MediaStream | null;
  busy: boolean;
}

type CameraOpener = () => Promise<MediaStream>;

const initialState: LocalCameraState = { stream: null, busy: false };

async function openBrowserCamera(): Promise<MediaStream> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.mediaDevices?.getUserMedia !== 'function'
  ) {
    throw new Error('Camera is not available in this browser.');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
  });
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Local self-view only. This stream is never passed to TRTC or Vivix. */
export class LocalCamera {
  private request = 0;
  private state: LocalCameraState = initialState;

  constructor(
    private readonly onChange: (state: LocalCameraState) => void,
    private readonly open: CameraOpener = openBrowserCamera,
  ) {}

  snapshot(): LocalCameraState {
    return this.state;
  }

  async toggle(): Promise<void> {
    if (this.state.stream || this.state.busy) {
      this.close();
      return;
    }
    const request = ++this.request;
    this.publish({ stream: null, busy: true });
    let stream: MediaStream;
    try {
      stream = await this.open();
    } catch (error) {
      if (request === this.request) this.publish(initialState);
      throw error;
    }
    if (request !== this.request) {
      stopStream(stream);
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopStream(stream);
      this.publish(initialState);
      throw new Error('Camera did not provide a video track.');
    }
    track.addEventListener(
      'ended',
      () => {
        if (this.state.stream !== stream) return;
        ++this.request;
        this.publish(initialState);
      },
      { once: true },
    );
    this.publish({ stream, busy: false });
  }

  close() {
    ++this.request;
    stopStream(this.state.stream);
    if (this.state.stream || this.state.busy) this.publish(initialState);
  }

  private publish(state: LocalCameraState) {
    this.state = state;
    this.onChange(state);
  }
}
