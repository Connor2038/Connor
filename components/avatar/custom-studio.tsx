'use client';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import CharacterUI from '@/generated/custom-ui.mjs';
import customCSS from '@/generated/custom-ui-css';
import { MattedVideo } from './matted-video';
import { DemoSession, initialState, type DemoState } from '@/lib/vivix/demo-session';
import {
  ActionRegistry,
  MemoryUIState,
  type UIBridge,
  type UICatalog,
  type UIAvatarProps,
} from '@/lib/vivix/custom-ui';
import { createCustomUIStyleRoot } from '@/lib/vivix/custom-ui-style';
import { executePortableTool, type PortableToolCall } from '@/lib/vivix/portable-tools';
import { RuntimeUISession } from '@/lib/vivix/ui-session';
import type { TemplateConfig } from '@/lib/vivix/types';
import { LocalCamera, type LocalCameraState } from '@/lib/vivix/local-camera';
import { attachSharedLayout } from '@/lib/vivix/shared-layout';
import { LiveControls, ServeHeader, TalkControl } from './serve-controls';
import './serve-controls.css';

interface AvatarRuntime {
  config: TemplateConfig;
  state: DemoState;
  view: React.RefObject<HTMLDivElement | null>;
  setView(node: HTMLDivElement | null): void;
  stop(): void;
  microphone(): void;
  camera(): void;
  cameraBusy: boolean;
  cameraStream: MediaStream | null;
  overlayEnded(): void;
  overlayFailed(): void;
}
const AvatarContext = createContext<AvatarRuntime | null>(null);

function CameraSelfView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      aria-label="Your camera"
      style={{
        position: 'absolute',
        right: 16,
        bottom: 72,
        zIndex: 7,
        width: 'min(28%, 220px)',
        aspectRatio: '16 / 9',
        borderRadius: 12,
        objectFit: 'cover',
        transform: 'scaleX(-1)',
        boxShadow: '0 8px 28px rgb(0 0 0 / 22%)',
      }}
    />
  );
}

function Avatar({ style, className, mattingRegion }: UIAvatarProps) {
  const runtime = useContext(AvatarContext)!;
  const live = runtime.state.status === 'live';
  const setView = runtime.setView;
  const aspectRatio = runtime.config.sessionDefaults?.output.aspect_ratio ?? '9:16';
  const dimensions = aspectRatio.split(/[:/]/).map(Number);
  const [width, height] =
    dimensions.length === 2 && dimensions.every((value) => value > 0 && Number.isFinite(value))
      ? dimensions
      : [9, 16];
  React.useLayoutEffect(() => {
    setView(runtime.view.current);
    return () => setView(null);
  }, [runtime.view, setView]);
  return (
    <div
      className={`vivix-avatar ${className ?? ''}`}
      data-character-avatar-frame
      data-embedded="true"
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...(style as React.CSSProperties),
      }}
    >
      <style>{`
        [data-character-avatar-media] video{background-color:transparent!important;width:100%!important;height:100%!important;object-fit:cover!important}
        [data-character-avatar-frame] .video-host,[data-character-avatar-frame] .matting-output{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
        [data-character-avatar-frame] .matting-output{pointer-events:none!important;z-index:1!important;background:transparent!important;object-fit:contain!important}
      `}</style>
      <MattedVideo
        view={runtime.view}
        enabled={Boolean(mattingRegion)}
        live={live}
        region={
          mattingRegion ? { ...mattingRegion, feather: mattingRegion.feather ?? 0 } : undefined
        }
        referenceImage={runtime.config.sourceImages[0].localPath}
      />
      <img
        src={runtime.config.sourceImages[0].localPath}
        alt={runtime.config.characterName}
        width={width}
        height={height}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'cover',
          opacity: live ? 0 : 1,
          pointerEvents: 'none',
        }}
      />
      {runtime.state.overlay && (
        <video
          src={runtime.state.overlay}
          autoPlay
          playsInline
          controls
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            zIndex: 5,
          }}
          onEnded={runtime.overlayEnded}
          onError={runtime.overlayFailed}
        />
      )}
      {runtime.cameraStream && <CameraSelfView stream={runtime.cameraStream} />}
    </div>
  );
}

class UIBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div role="alert">Custom UI failed: {this.state.error}</div>
    ) : (
      this.props.children
    );
  }
}

export function CustomStudio({ config }: { config: TemplateConfig }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const runtime = useRef<DemoSession | null>(null);
  const uiState = useRef(new MemoryUIState()).current;
  const uiSession = useRef(new RuntimeUISession()).current;
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [viewNode, setViewNode] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState<DemoState>(initialState);
  const [catalog, setCatalog] = useState<UICatalog>({ version: 'folder-build', actions: [] });
  const [cameraState, setCameraState] = useState<LocalCameraState>({ stream: null, busy: false });
  const camera = useRef<LocalCamera | null>(null);
  if (!camera.current) camera.current = new LocalCamera(setCameraState);
  const registry = useRef<ActionRegistry | null>(null);
  if (!registry.current) registry.current = new ActionRegistry(setCatalog);
  const run = useCallback((operation: (session: DemoSession) => Promise<unknown>) => {
    const session = runtime.current;
    if (session)
      void operation(session).catch((error) =>
        setState((value) => ({ ...value, message: String(error) })),
      );
  }, []);
  const portableTool = useCallback(async (call: PortableToolCall) => {
    if (call.name !== 'vivix.ui.invoke') return executePortableTool(call);
    const action = call.arguments.action;
    const args = call.arguments.arguments;
    if (typeof action !== 'string' || !args || typeof args !== 'object' || Array.isArray(args))
      return { error: { code: 'ui_arguments_invalid', message: 'Invalid UI invocation.' } };
    return registry.current!.invoke({ action, arguments: args as Record<string, unknown> });
  }, []);
  const setHost = useCallback((node: HTMLDivElement | null) => {
    host.current = node;
    if (!node) return;
    const shadow = node.shadowRoot ?? node.attachShadow({ mode: 'open' });
    const root = createCustomUIStyleRoot(shadow, customCSS);
    setMount((current) => (current === root ? current : root));
  }, []);
  useEffect(() => {
    if (!viewNode) return;
    if (runtime.current) {
      void runtime.current.bindView(viewNode).catch((error) =>
        setState((value) => ({
          ...value,
          message: error instanceof Error ? error.message : String(error),
        })),
      );
      return;
    }
    runtime.current = new DemoSession(
      config,
      viewNode,
      (next) => {
        setState(next);
        uiSession.update(next);
      },
      portableTool,
      (productId) => uiState.set('product.active_id', productId),
    );
  }, [config, portableTool, uiSession, uiState, viewNode]);
  useEffect(() => {
    if (!mount || !viewNode) return;
    const frame = viewNode.closest<HTMLElement>('[data-character-avatar-frame]');
    if (!frame) return;
    viewNode.setAttribute('data-character-avatar-media', '');
    const controls = stage.current;
    return attachSharedLayout(
      mount,
      frame,
      config.sessionDefaults?.output.aspect_ratio ?? '9:16',
      (rect) => {
        controls?.style.setProperty('--stage-controls-left', `${rect.left}px`);
        controls?.style.setProperty('--stage-controls-top', `${rect.top}px`);
        controls?.style.setProperty('--stage-controls-width', `${rect.width}px`);
        controls?.style.setProperty('--stage-controls-height', `${rect.height}px`);
      },
    );
  }, [config.sessionDefaults?.output.aspect_ratio, mount, viewNode]);
  useEffect(
    () => () => {
      camera.current?.close();
      void runtime.current?.leave();
    },
    [],
  );
  useEffect(() => {
    if (state.status === 'live') void runtime.current?.publishUIActions(catalog);
  }, [catalog, state.status]);
  const bridge = useMemo<UIBridge>(
    () => ({
      registerActions: registry.current!.registerActions,
      emitEvent: (event) => runtime.current?.emitUIEvent(event) ?? false,
    }),
    [],
  );
  const toggleCamera = useCallback(() => {
    void camera.current?.toggle().catch((error) =>
      setState((value) => ({
        ...value,
        message: error instanceof Error ? error.message : String(error),
      })),
    );
  }, []);
  const avatarRuntime = useMemo<AvatarRuntime>(
    () => ({
      config,
      state,
      view,
      setView: setViewNode,
      stop: () => run((session) => session.stop()),
      microphone: () => run((session) => session.toggleMicrophone()),
      camera: toggleCamera,
      cameraBusy: cameraState.busy,
      cameraStream: cameraState.stream,
      overlayEnded: () => runtime.current?.overlayEnded(),
      overlayFailed: () => runtime.current?.overlayFailed(),
    }),
    [cameraState, config, run, state, toggleCamera],
  );
  const live = state.status === 'live';
  const showTalk = ['idle', 'error', 'starting'].includes(state.status);
  return (
    <main className="character-share-shell">
      <div className="character-share-main">
        <ServeHeader
          characterName={config.characterName}
          state={state}
          onDisconnect={() => run((session) => session.stop())}
        />
        <section ref={stage} className="character-share-stage" aria-label="Character experience">
          <div ref={setHost} className="character-ui-host" />
          {mount &&
            createPortal(
              <UIBoundary>
                <AvatarContext.Provider value={avatarRuntime}>
                  <CharacterUI
                    Avatar={Avatar}
                    bridge={bridge}
                    session={uiSession}
                    state={uiState}
                  />
                </AvatarContext.Provider>
              </UIBoundary>,
              mount,
            )}
          {showTalk && host.current?.shadowRoot
            ? createPortal(
                <div className="character-avatar-controls-overlay">
                  <TalkControl
                    busy={state.status === 'starting'}
                    onStart={() => run((session) => session.start())}
                  />
                </div>,
                host.current.shadowRoot,
              )
            : null}
          {live ? (
            <div className="character-session-controls-overlay">
              <LiveControls
                state={state}
                characterName={config.characterName}
                cameraBusy={cameraState.busy}
                cameraOn={Boolean(cameraState.stream)}
                onMic={() => run((session) => session.toggleMicrophone())}
                onCamera={toggleCamera}
                onSend={(text) => run((session) => session.say(text))}
                onExpire={() => run((session) => session.stop())}
              />
            </div>
          ) : null}
          {state.message ? (
            <div className="character-session-error" role="alert">
              {state.message}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
