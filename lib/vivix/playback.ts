/** Detects the first audible remote samples for startup diagnostics only. */
export class PlaybackObserver {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  attach(track: MediaStreamTrack, onAudible: () => void) {
    this.close();
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    void this.context.resume();
    const samples = new Float32Array(this.analyser.fftSize);
    this.meter = setInterval(() => {
      this.analyser?.getFloatTimeDomainData(samples);
      if (this.context?.state === 'running' && samples.some((value) => Math.abs(value) > 0.008)) {
        if (this.meter) clearInterval(this.meter);
        this.meter = null;
        onAudible();
      }
    }, 100);
  }
  async resume() {
    await this.context?.resume();
  }
  close() {
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    this.source?.disconnect();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.source = null;
  }
}
