type PaneRect = { left: number; top: number; width: number; height: number; avatar: boolean };

type Composition = {
  paneCount: number;
  direction: 'horizontal' | 'vertical';
  avatarPosition: 'only' | 'left' | 'center' | 'right' | 'top' | 'bottom';
  secondaryStacked: boolean;
};

function overlap(leftA: number, widthA: number, leftB: number, widthB: number) {
  const value = Math.max(0, Math.min(leftA + widthA, leftB + widthB) - Math.max(leftA, leftB));
  return value / Math.max(1, Math.min(widthA, widthB));
}

function composition(panes: PaneRect[], declared?: Composition['direction']): Composition {
  const visible = panes.filter(
    (pane) =>
      pane.width > 1 &&
      pane.height > 1 &&
      [pane.left, pane.top, pane.width, pane.height].every(Number.isFinite),
  );
  const avatar = visible.find((pane) => pane.avatar);
  if (!avatar || visible.length <= 1)
    return {
      paneCount: 1,
      direction: 'horizontal',
      avatarPosition: 'only',
      secondaryStacked: false,
    };
  const others = visible.filter((pane) => !pane.avatar);
  const centerX = (pane: PaneRect) => pane.left + pane.width / 2;
  const centerY = (pane: PaneRect) => pane.top + pane.height / 2;
  const secondaryStacked =
    others.length === 2 &&
    overlap(others[0]!.left, others[0]!.width, others[1]!.left, others[1]!.width) >= 0.5 &&
    overlap(others[0]!.top, others[0]!.height, others[1]!.top, others[1]!.height) < 0.5;
  if (secondaryStacked) {
    const otherCenter = (centerX(others[0]!) + centerX(others[1]!)) / 2;
    return {
      paneCount: visible.length,
      direction: 'horizontal',
      avatarPosition: centerX(avatar) <= otherCenter ? 'left' : 'right',
      secondaryStacked: true,
    };
  }
  const horizontalSpread = Math.max(...visible.map(centerX)) - Math.min(...visible.map(centerX));
  const verticalSpread = Math.max(...visible.map(centerY)) - Math.min(...visible.map(centerY));
  const direction = declared ?? (horizontalSpread >= verticalSpread ? 'horizontal' : 'vertical');
  const ordered = [...visible].sort((a, b) =>
    direction === 'horizontal' ? centerX(a) - centerX(b) : centerY(a) - centerY(b),
  );
  const index = ordered.indexOf(avatar);
  return {
    paneCount: visible.length,
    direction,
    avatarPosition:
      direction === 'vertical'
        ? index === 0
          ? 'top'
          : 'bottom'
        : ordered.length >= 3 && index > 0 && index < ordered.length - 1
          ? 'center'
          : index === 0
            ? 'left'
            : 'right',
    secondaryStacked: false,
  };
}

function horizontalMetrics(widths: number[], avatarIndex: number, avatarRatio: number, gap = 2) {
  if (
    widths.length < 2 ||
    avatarIndex < 0 ||
    avatarIndex >= widths.length ||
    !Number.isFinite(avatarRatio) ||
    avatarRatio <= 0 ||
    widths.some((width) => !Number.isFinite(width) || width <= 0)
  )
    return undefined;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const avatarFraction = widths[avatarIndex]! / total;
  const totalGap = gap * (widths.length - 1);
  return {
    columns: widths.map((width) => `minmax(0, ${width / total}fr)`).join(' '),
    totalGap,
    widthPerHeight: avatarRatio / avatarFraction,
    heightPerWidth: avatarFraction / avatarRatio,
  };
}

/** Matches the layout containment used by Official Character Serve. */
export function attachSharedLayout(
  body: HTMLElement,
  avatar: HTMLElement,
  aspectRatio: string,
  onStageLayout?: (rect: { left: number; top: number; width: number; height: number }) => void,
) {
  const win = body.ownerDocument.defaultView!;
  const flowChildren = (node: HTMLElement) =>
    Array.from(node.children).filter((child): child is HTMLElement => {
      if (
        !(child instanceof win.HTMLElement) ||
        ['STYLE', 'SCRIPT', 'LINK'].includes(child.tagName)
      )
        return false;
      const css = win.getComputedStyle(child);
      return css.display !== 'none' && !['absolute', 'fixed'].includes(css.position);
    });
  let target = avatar;
  let composite: HTMLElement | undefined;
  let canvas: HTMLElement | undefined;
  let authoredStacked = false;
  for (let node = avatar.parentElement; node && node !== body; node = node.parentElement) {
    target = node;
    const css = win.getComputedStyle(node);
    if (/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(css.aspectRatio)) canvas = node;
    const children = flowChildren(node);
    if (
      !composite &&
      children.length >= 2 &&
      ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(css.display)
    ) {
      composite = node;
      authoredStacked = css.display.includes('flex')
        ? css.flexDirection.startsWith('column')
        : css.gridTemplateColumns.split(' ').length === 1;
    }
  }
  if (canvas && (!composite || (canvas !== composite && canvas.contains(composite))))
    composite = undefined;
  const layout = composite ?? canvas ?? target;
  const panes = composite ? flowChildren(composite) : [];
  const rects = panes.map((pane) => {
    const rect = pane.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      avatar: pane === avatar || pane.contains(avatar),
    };
  });
  const detail = composition(
    rects.length ? rects : [{ ...avatar.getBoundingClientRect(), avatar: true }],
    panes.length === 2 ? (authoredStacked ? 'vertical' : 'horizontal') : undefined,
  );
  const ratio = aspectRatio
    .trim()
    .split(/\s*[:/]\s*/)
    .map(Number);
  const avatarRatio =
    ratio.length === 2 && ratio.every((value) => Number.isFinite(value) && value > 0)
      ? ratio[0]! / ratio[1]!
      : 9 / 16;
  const portrait = avatarRatio <= 1;
  const avatarIndex = rects.findIndex((pane) => pane.avatar);
  const metrics =
    portrait && detail.direction === 'horizontal' && !detail.secondaryStacked
      ? horizontalMetrics(
          rects.map((pane) => pane.width),
          avatarIndex,
          avatarRatio,
        )
      : undefined;
  const containment = metrics
    ? 'avatar-row'
    : !portrait && panes.length === 2 && detail.direction === 'vertical'
      ? detail.avatarPosition === 'bottom'
        ? 'avatar-bottom'
        : 'avatar-top'
      : !portrait && panes.length === 3 && detail.secondaryStacked
        ? detail.avatarPosition === 'right'
          ? 'avatar-right-secondary-stacked'
          : 'avatar-left-secondary-stacked'
        : '';
  const style = body.ownerDocument.createElement('style');
  const hostAttribute = 'data-character-preview-containment-host';
  const layoutAttribute = 'data-character-preview-containment';
  const paneAttribute = 'data-character-preview-containment-pane';
  const previousHost = body.getAttribute(hostAttribute);
  const previousLayout = composite?.getAttribute(layoutAttribute) ?? null;
  const previousPanes = new Map(panes.map((pane) => [pane, pane.getAttribute(paneAttribute)]));
  if (containment && composite) {
    body.setAttribute(hostAttribute, '');
    composite.setAttribute(layoutAttribute, containment);
    if (containment.includes('secondary-stacked')) {
      const avatarPane = panes.find((pane) => pane === avatar || pane.contains(avatar));
      const interaction = panes.filter((pane) => pane !== avatarPane);
      avatarPane?.setAttribute(paneAttribute, 'avatar');
      interaction[0]?.setAttribute(paneAttribute, 'interaction-first');
      interaction[1]?.setAttribute(paneAttribute, 'interaction-second');
    }
    style.textContent = `
      [data-character-preview-containment-host]{container-type:size!important;overflow:hidden!important}
      [data-character-preview-containment]{display:grid!important;place-self:center!important;margin:auto!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;aspect-ratio:auto!important;gap:2px!important;overflow:hidden!important}
      ${metrics ? `[data-character-preview-containment="avatar-row"]{width:min(100cqw,calc(${metrics.widthPerHeight * 100}cqh + ${metrics.totalGap}px))!important;height:min(100cqh,calc(${metrics.heightPerWidth * 100}cqw - ${metrics.totalGap * metrics.heightPerWidth}px))!important;grid-template-columns:${metrics.columns}!important;grid-template-rows:minmax(0,1fr)!important}` : ''}
      [data-character-preview-containment="avatar-top"],[data-character-preview-containment="avatar-bottom"]{width:min(100cqw,calc(79.113924cqh - 1.582278px))!important;height:min(100cqh,calc(126.4cqw + 2px))!important;grid-template-columns:minmax(0,1fr)!important}
      [data-character-preview-containment="avatar-top"]{grid-template-rows:minmax(0,281.25fr) minmax(0,350.75fr)!important}
      [data-character-preview-containment="avatar-bottom"]{grid-template-rows:minmax(0,350.75fr) minmax(0,281.25fr)!important}
      [data-character-preview-containment*="secondary-stacked"]{width:min(100cqw,calc(140.625cqh + 2px))!important;height:min(100cqh,calc(71.111111cqw - 1.422222px))!important;grid-template-columns:minmax(0,4fr) minmax(0,6fr)!important;grid-template-rows:minmax(0,1fr) minmax(0,1fr)!important}
      [data-character-preview-containment="avatar-left-secondary-stacked"]>[data-character-preview-containment-pane="avatar"]{grid-column:1!important;grid-row:1/3!important}
      [data-character-preview-containment="avatar-left-secondary-stacked"]>[data-character-preview-containment-pane^="interaction-"]{grid-column:2!important}
      [data-character-preview-containment="avatar-right-secondary-stacked"]>[data-character-preview-containment-pane="avatar"]{grid-column:2!important;grid-row:1/3!important}
      [data-character-preview-containment="avatar-right-secondary-stacked"]>[data-character-preview-containment-pane^="interaction-"]{grid-column:1!important}
      [data-character-preview-containment]>[data-character-preview-containment-pane="interaction-first"]{grid-row:1!important}
      [data-character-preview-containment]>[data-character-preview-containment-pane="interaction-second"]{grid-row:2!important}
      [data-character-preview-containment*="secondary-stacked"] [data-character-avatar-frame]{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;aspect-ratio:9/16!important}
      [data-character-preview-containment*="secondary-stacked"] [data-character-avatar-media] video,[data-character-preview-containment*="secondary-stacked"] .matting-output{object-fit:cover!important}
      [data-character-preview-containment]>:not(style):not(script):not(link){width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important}
    `;
    body.append(style);
  }
  const stage = canvas && !composite ? layout : avatar;
  stage.setAttribute('data-character-preview-stage', '');
  const update = () => {
    const hostRect = body.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    body.style.setProperty('--stage-controls-left', `${stageRect.left - hostRect.left}px`);
    body.style.setProperty('--stage-controls-top', `${stageRect.top - hostRect.top}px`);
    body.style.setProperty('--stage-controls-width', `${stageRect.width}px`);
    body.style.setProperty('--stage-controls-height', `${stageRect.height}px`);
    onStageLayout?.({
      left: stageRect.left - hostRect.left,
      top: stageRect.top - hostRect.top,
      width: stageRect.width,
      height: stageRect.height,
    });
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(body);
  if (stage !== body) observer.observe(stage);
  if (composite && composite !== stage) observer.observe(composite);
  return () => {
    observer.disconnect();
    style.remove();
    if (previousHost === null) body.removeAttribute(hostAttribute);
    else body.setAttribute(hostAttribute, previousHost);
    if (composite) {
      if (previousLayout === null) composite.removeAttribute(layoutAttribute);
      else composite.setAttribute(layoutAttribute, previousLayout);
    }
    for (const [pane, value] of previousPanes) {
      if (value === null) pane.removeAttribute(paneAttribute);
      else pane.setAttribute(paneAttribute, value);
    }
    for (const name of Array.from(body.style))
      if (name.startsWith('--stage-controls-')) body.style.removeProperty(name);
    stage.removeAttribute('data-character-preview-stage');
  };
}
