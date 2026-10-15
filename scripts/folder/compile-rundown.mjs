import { yaml } from './read-folder.mjs';

function mediaMap(files, authored) {
  if (!authored?.resources?.media) return new Map();
  const path = authored.resources.media.replace(/^\.\//, '');
  const document = yaml(files, path, true);
  if (document.schema_version !== 'character-ui-media/v0.1')
    throw new Error(`${path} has an unsupported media schema.`);
  return new Map(
    (document.media ?? []).map(item => {
      if (item.kind !== 'video' || item.presentation?.surface !== 'live_overlay' || !item.source?.url)
        throw new Error(`${path} media ${item.id} is not a supported live overlay video.`);
      return [
        item.id,
        {
          id: item.id,
          url: item.source.url,
          mime_type: item.source.mime_type,
          fit: item.presentation.fit || 'contain',
          start_at_ms: item.playback?.start_at_ms || 0,
          end_at_ms: item.playback?.end_at_ms,
          muted: item.playback?.muted ?? true,
          volume: item.playback?.volume ?? 1,
          end_behavior: item.playback?.end_behavior || 'hide',
        },
      ];
    }),
  );
}

function compileStep(step, media) {
  if (step.type === 'ui.stage.set_visibility') return undefined;
  if (step.type === 'ui.media.play') {
    const item = media.get(step.media_id);
    if (!item) throw new Error(`Rundown step ${step.id} references unknown media ${step.media_id}.`);
    return {
      id: step.id,
      type: 'media',
      url: item.url,
      media: item,
      advance_on: step.advance_on || 'ended',
      lifetime: step.lifetime || 'step',
    };
  }
  if (step.type === 'ivi.script') {
    if (!step.response?.script) throw new Error(`Rundown step ${step.id} requires response.script.`);
    return { id: step.id, type: 'script', script: step.response.script };
  }
  if (step.type === 'ivi.session_update') {
    const source = step.session?.source_image_id ?? step.session?.active_avatar_id;
    if (!source) throw new Error(`Rundown step ${step.id} requires a source image or avatar id.`);
    return { id: step.id, type: 'session_update', source_image_id: source };
  }
  throw new Error(`Rundown step ${step.id} has unsupported type ${step.type}.`);
}

export function compileRundown(files) {
  const authored = yaml(files, 'rundown.yaml');
  if (!authored) return { products: [], playlist: undefined, items: [], media: [] };
  if (!['character-rundown/v0.1', 'character-rundown/v0.2'].includes(authored.schema_version))
    throw new Error('rundown.yaml has an unsupported schema.');
  const media = mediaMap(files, authored);
  const products = (authored.products ?? []).map(product => ({
    id: product.id,
    name: product.title || product.id,
    description: product.commerce?.description || '',
    price: String(product.commerce?.price || '0').replace(/[^0-9.]/g, '') || '0',
    image: '',
    purchase_url: product.commerce?.link,
    steps: (product.steps ?? []).map(step => compileStep(step, media)).filter(Boolean),
  }));
  const known = new Set(products.map(product => product.id));
  const occurrences = new Set();
  const items = (authored.playlist?.items ?? []).map(item => {
    if (!known.has(item.product_id) || occurrences.has(item.occurrence_id))
      throw new Error(`Invalid rundown occurrence ${item.occurrence_id}.`);
    occurrences.add(item.occurrence_id);
    return { occurrence_id: item.occurrence_id, product_id: item.product_id };
  });
  if (!products.length || !items.length) throw new Error('Compiled rundown is empty.');
  const playlist = {
    items,
    auto_start: authored.playlist?.auto_start ?? false,
    auto_advance: authored.playlist?.auto_advance ?? true,
    loop_after_completion:
      authored.playlist?.loop_after_completion ?? authored.playlist?.loop ?? false,
    resume_after_interruption: authored.playlist?.resume_after_interruption ?? false,
    manual_switch_policy: authored.playlist?.manual_switch_policy || 'immediate',
  };
  const switchable = [];
  for (const item of items) {
    if (switchable.some(product => product.id === item.product_id)) continue;
    const product = products.find(candidate => candidate.id === item.product_id);
    switchable.push({ id: product.id, title: product.name, description: product.description });
  }
  return { products, playlist, items: switchable, media: [...media.values()] };
}
