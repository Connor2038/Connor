export function createCustomUIStyleRoot(shadow: ShadowRoot, css: string) {
  const existing = shadow.getElementById('character-ui-root');
  if (existing) return existing;
  const style = document.createElement('style');
  style.textContent = `
    :host { display:block; min-height:0; height:100%; color:inherit; background:transparent; font-family:inherit; }
    html, body, #character-ui-root { margin:0; min-height:0; height:100%; }
    *, *::before, *::after { box-sizing:border-box; }
    .vivix-avatar { position:relative; overflow:hidden; width:100%; height:100%; min-height:320px; background:transparent; }
    .vivix-avatar > img, .vivix-avatar .video-host, .vivix-avatar .matting-output { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .vivix-avatar-controls { position:absolute; inset:auto 16px 16px; z-index:10; display:flex; gap:8px; justify-content:center; }
    .vivix-avatar-controls button { border:0; border-radius:999px; padding:10px 16px; background:#d9fc6d; color:#20251f; font:600 13px Arial; }
    .vivix-avatar-error { position:absolute; left:16px; right:16px; bottom:64px; z-index:10; padding:8px; background:#5d1717; color:white; }
    ${css.replace(/:root\b/g, 'html')}
  `;
  shadow.append(style);
  const html = document.createElement('html');
  const body = document.createElement('body');
  body.id = 'character-ui-root';
  html.append(body);
  shadow.append(html);
  return body;
}
