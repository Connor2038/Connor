'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { LiveCountdown } from './live-countdown';
import type { DemoState } from '@/lib/vivix/demo-session';

const talkStyles = `
  .character-avatar-controls-overlay{position:absolute;top:var(--stage-controls-top,0);left:var(--stage-controls-left,0);z-index:9999;width:var(--stage-controls-width,100%);height:var(--stage-controls-height,100%);pointer-events:none}
  button.character-avatar-control{all:unset;box-sizing:border-box;position:absolute;bottom:20px;left:50%;z-index:50;display:flex;flex:0 0 auto;align-items:center;justify-content:center;gap:6px;width:185px;min-width:185px;max-width:185px;height:48px;min-height:48px;max-height:48px;padding:0 16px;overflow:hidden;border:0;border-radius:100px;color:#fff;background:rgb(0 0 0/10%);box-shadow:none;backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);transform:translateX(-50%);font:500 16px/19px 'Inter Variable',Inter,sans-serif;white-space:nowrap;transition:background 160ms ease;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent}
  button.character-avatar-control::before{position:absolute;inset:0;padding:1px;border-radius:inherit;background:linear-gradient(135deg,rgb(255 255 255/85%),rgb(255 255 255/24%) 44%,rgb(255 255 255/8%) 68%,rgb(255 255 255/58%));content:"";mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;pointer-events:none}
  button.character-avatar-control:hover:not(:disabled){background:rgb(0 0 0/20%)}
  button.character-avatar-control:disabled{opacity:1;cursor:wait}
  .character-avatar-control-icon{display:grid;flex:0 0 18px;width:18px;height:18px;place-items:center}
  .character-avatar-control-icon img{display:block;width:13.5px;height:16.5px;object-fit:contain}
  .character-avatar-control-icon svg{display:block;width:18px;height:18px;animation:character-avatar-spin 1s linear infinite}
  @keyframes character-avatar-spin{to{transform:rotate(360deg)}}
  @media (max-height:480px){button.character-avatar-control{bottom:12px;width:48px;min-width:48px;max-width:48px;padding:0}button.character-avatar-control>span:last-child{display:none}}
`;

function CameraIcon({ off = false }: { off?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196" />
          <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
          <rect x="2" y="6" width="14" height="12" rx="2" />
        </>
      )}
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10.6144 8.82972L10.621 8.8684C10.6974 9.32059 10.7356 9.54668 10.8543 9.72936C10.8896 9.78371 10.9298 9.83467 10.9745 9.88158C11.1247 10.0392 11.3356 10.1284 11.7574 10.3067C12.3912 10.5746 12.7081 10.7086 13.0121 10.6553C13.1014 10.6396 13.1882 10.6124 13.2705 10.5743C13.5507 10.4448 13.737 10.1508 14.1095 9.56285C14.498 8.94968 14.6922 8.6431 14.6644 8.29321C14.6581 8.21479 14.6377 8.11535 14.6126 8.04082C14.5006 7.70826 14.2372 7.52773 13.7105 7.16667C10.1449 4.72243 5.85578 4.72244 2.29015 7.16667C1.76344 7.52773 1.50009 7.70826 1.38803 8.04082C1.36291 8.11535 1.34253 8.2148 1.33629 8.29321C1.30844 8.6431 1.50268 8.94968 1.89118 9.56285C2.26369 10.1508 2.44994 10.4448 2.73015 10.5743C2.81243 10.6124 2.8993 10.6396 2.98857 10.6553C3.29256 10.7086 3.60947 10.5746 4.24328 10.3067C4.66503 10.1284 4.87591 10.0392 5.02613 9.88158C5.07082 9.83467 5.11108 9.78371 5.14639 9.72936C5.26508 9.54668 5.30328 9.32059 5.37968 8.8684L5.38621 8.82972C5.46507 8.36297 5.5045 8.12959 5.67744 7.91559C5.70164 7.88565 5.74568 7.83811 5.77367 7.8117C5.9738 7.62298 6.15041 7.57926 6.50361 7.49182C7.45491 7.25632 8.54575 7.25632 9.49704 7.49182C9.85025 7.57926 10.0268 7.62298 10.227 7.8117C10.255 7.83811 10.299 7.88565 10.3232 7.91559C10.4961 8.12959 10.5356 8.36297 10.6144 8.82972Z"
        fill="#FF3F3F"
        stroke="#FF3F3F"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TalkControl({ busy, onStart }: { busy: boolean; onStart: () => void }) {
  return (
    <>
      <style>{talkStyles}</style>
      <button
        type="button"
        className="character-avatar-control"
        aria-label={busy ? 'Connecting' : 'Talk to character'}
        aria-busy={busy}
        disabled={busy}
        onClick={onStart}
      >
        <span className="character-avatar-control-icon">
          {busy ? <SpinnerIcon /> : <img src="/serve-icons/preview-talk.svg" alt="" />}
        </span>
        <span>{busy ? 'Connecting' : 'Talk to character'}</span>
      </button>
    </>
  );
}

export function ServeHeader({
  characterName,
  state,
  onDisconnect,
}: {
  characterName: string;
  state: DemoState;
  onDisconnect: () => void;
}) {
  const canDisconnect = !['idle', 'error'].includes(state.status);
  return (
    <header className="character-share-topbar">
      <div className="character-share-identity">
        <strong className="character-share-logo">VIVIX</strong>
        <span className="character-share-title">{characterName}</span>
        <span className="character-share-label">API project</span>
      </div>
      <button
        type="button"
        className="character-share-end-session"
        disabled={!canDisconnect || state.status === 'stopping'}
        onClick={onDisconnect}
      >
        <DisconnectIcon />
        <span>{state.status === 'stopping' ? 'Disconnecting…' : 'Disconnect'}</span>
      </button>
    </header>
  );
}

export function LiveControls({
  state,
  characterName,
  cameraBusy,
  cameraOn,
  onMic,
  onCamera,
  onSend,
  onExpire,
}: {
  state: DemoState;
  characterName: string;
  cameraBusy: boolean;
  cameraOn: boolean;
  onMic: () => void;
  onCamera: () => void;
  onSend: (text: string) => void;
  onExpire: () => void;
}) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    onSend(value);
  };
  return (
    <>
      {state.deadline > 0 ? (
        <div className="character-live-badge">
          <i />
          <span>LIVE </span>
          <LiveCountdown deadline={state.deadline} onExpire={onExpire} />
        </div>
      ) : null}
      <div className="character-session-dock" data-embedded="true">
        {state.caption ? (
          <div className="character-session-caption" role="log" aria-label="Live captions">
            <div className="character-session-speaker" data-user={state.captionSpeaker === 'user'}>
              <span>{state.captionSpeaker === 'user' ? 'You' : characterName}</span>
            </div>
            <p className="character-session-transcript">
              {state.caption}
              {state.captionStreaming ? <span className="character-session-cursor" /> : null}
            </p>
          </div>
        ) : null}
        <div className="character-session-composer" role="group" aria-label="Conversation controls">
          <button
            type="button"
            className="character-session-mic"
            aria-label={state.microphone ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={state.microphone}
            onClick={onMic}
          >
            <span className="character-session-mic-icon" aria-hidden="true">
              <img src="/serve-icons/preview-microphone.svg" alt="" />
              {state.microphone ? (
                <img
                  src="/serve-icons/preview-microphone.svg"
                  className="character-session-mic-glow"
                  alt=""
                />
              ) : (
                <span className="character-session-mic-slash" />
              )}
            </span>
          </button>
          <button
            type="button"
            className="character-session-camera"
            aria-label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
            aria-pressed={cameraOn}
            disabled={cameraBusy}
            onClick={onCamera}
          >
            <CameraIcon off={!cameraOn} />
          </button>
          <form className="character-session-form" onSubmit={submit}>
            <input
              className="character-session-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
              }}
              aria-label={`Message ${characterName}`}
              placeholder="Say something"
              autoComplete="off"
            />
            <button
              type="submit"
              className="character-session-send"
              aria-label="Send message"
              disabled={!text.trim()}
            >
              <img src="/serve-icons/preview-send.svg" alt="" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
