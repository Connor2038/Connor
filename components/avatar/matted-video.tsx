'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createAvatarMattingSession } from '@/lib/vivix/matting/avatar-matting-session';
import {
  normalizeAvatarMattingRegion,
  type AvatarMattingRegion,
} from '@/lib/vivix/matting/avatar-matting';
import { acquireAvatarMattingRuntime } from '@/lib/vivix/matting/avatar-matting-runtime';

export function MattedVideo({
  view,
  enabled,
  live,
  region,
  referenceImage,
}: {
  view: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  live: boolean;
  region?: AvatarMattingRegion;
  referenceImage: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mattingRegion = useRef(normalizeAvatarMattingRegion(region));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mattingRegion.current = normalizeAvatarMattingRegion(region);
  }, [region]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let release: (() => void) | undefined;
    void acquireAvatarMattingRuntime('/avatar-matting')
      .then(async (lease) => {
        if (disposed) return lease.release();
        release = () => lease.release();
        await lease.prewarmReference(referenceImage);
      })
      .catch(() => {}); // The live session surfaces a model-load failure with a video fallback.
    return () => {
      disposed = true;
      release?.();
    };
  }, [enabled, referenceImage]);
  useEffect(() => {
    if (!enabled || !live || !view.current) return;
    setError('');
    const session = createAvatarMattingSession({
      host: view.current,
      assetRoot: '/avatar-matting',
      getOutput: () => canvas.current,
      getMattingRegion: () => mattingRegion.current,
      setMatteReady: setReady,
      onStatusChange: (status) => {
        if (status.phase === 'error')
          setError(status.message ?? 'Background removal is unavailable.');
      },
    });
    return () => session.dispose();
  }, [enabled, live, view]);
  const show = enabled && live && ready;
  return (
    <>
      <div ref={view} className="video-host" style={{ opacity: show ? 0 : 1 }} />
      <canvas
        ref={canvas}
        className="matting-output"
        data-matting-ready={show}
        style={{ opacity: show ? 1 : 0 }}
      />
      {error && (
        <span className="matting-error" role="status">
          {error}
        </span>
      )}
    </>
  );
}
