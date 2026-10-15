import { text, yaml } from './read-folder.mjs';

const dimensions = {
  '480p/9:16': [448, 832],
  '480p/16:9': [832, 448],
  '480p/1:1': [608, 608],
  '480p/3:4': [544, 704],
  '480p/4:3': [704, 544],
  '720p/9:16': [704, 1248],
  '720p/16:9': [1248, 704],
  '720p/1:1': [928, 928],
  '720p/3:4': [832, 1056],
  '720p/4:3': [1056, 832],
};

function avatarId(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'avatar-1';
}

function mediaType(id, url, authored) {
  if (authored) return authored;
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  throw new Error(`Source image ${id} requires media_type.`);
}

function sourceImage(image, appearance, model, output) {
  let selected = image;
  if (appearance.schema_version === 2) {
    const standard = dimensions[`${output.resolution}/${output.aspect_ratio}`];
    if (!standard) throw new Error(`Unsupported appearance output ${output.resolution}/${output.aspect_ratio}.`);
    const legacy = model === 'vivix-a1-stream:0.9.4' && output.resolution === '480p';
    const wanted = legacy
      ? output.aspect_ratio === '9:16'
        ? [464, 832]
        : output.aspect_ratio === '16:9'
          ? [832, 464]
          : standard
      : standard;
    const key = `avatar-${wanted[0]}x${wanted[1]}`;
    const fallback = `avatar-${dimensions[`480p/${output.aspect_ratio}`]?.join('x')}`;
    selected = image.variants?.[key] ?? (output.resolution === '720p' ? image.variants?.[fallback] : undefined);
    if (!selected || selected.width !== wanted[0] && key in (image.variants ?? {}))
      throw new Error(`Appearance variant ${key} is required for source image ${image.id}.`);
  }
  const entry = {
    source_image_id: image.id,
    url: selected.url,
    media_type: mediaType(image.id, selected.url, selected.media_type),
  };
  if (image.description) entry.description = image.description;
  if (image.opening) entry.opening = image.opening;
  return entry;
}

function imageAssets(files, character) {
  const definitions = new Map();
  for (const [path] of files) {
    if (!path.startsWith('assets/images/')) continue;
    const asset = yaml(files, path, true);
    if (asset.schema_version !== 'character-image-asset/v1' || !/^OBJ_(0|[1-9]\d*)$/.test(asset.asset_id))
      throw new Error(`${path} has an invalid image asset identity.`);
    const tags = String(asset.description ?? '').match(/<OBJ_(?:0|[1-9]\d*)>/g) ?? [];
    if (tags.length !== 1 || tags[0] !== `<${asset.asset_id}>`)
      throw new Error(`${path} description must contain its OBJ_N tag exactly once.`);
    if (definitions.has(asset.asset_id)) throw new Error(`Duplicate image asset id ${asset.asset_id}.`);
    definitions.set(path, asset);
  }
  const seen = new Set();
  return (character.assets?.images ?? []).map(({ ref }) => {
    if (seen.has(ref)) throw new Error(`Duplicate image asset binding ${ref}.`);
    seen.add(ref);
    const asset = definitions.get(ref);
    if (!asset) throw new Error(`Image asset ${ref} does not exist.`);
    return {
      asset_id: asset.asset_id,
      url: asset.url,
      mime_type: asset.mime_type,
      description: asset.description,
    };
  });
}

export function compileSession(files, tools = []) {
  const character = yaml(files, 'character.yaml', true);
  const appearance = yaml(files, 'appearance.yaml', true);
  const voice = yaml(files, 'voice.yaml');
  const provider = yaml(files, 'provider/vivix_official_dh30.yaml');
  if (!character.name || !appearance.source_images?.length) throw new Error('Character name and appearance are required.');
  if (provider?.media_transport && provider.media_transport !== 'trtc')
    throw new Error(`Unsupported media transport: ${provider.media_transport}. Creator Clone currently requires TRTC.`);
  const model = provider?.model || character.model;
  if (!model) throw new Error('character.yaml model is required.');
  const output = {
    aspect_ratio: character.session_defaults?.aspect_ratio || '9:16',
    resolution: character.session_defaults?.resolution || '480p',
  };
  const sources = appearance.source_images.map(image => sourceImage(image, appearance, model, output));
  const defaultSource = appearance.default_source_image || sources[0].source_image_id;
  if (!sources.some(image => image.source_image_id === defaultSource))
    throw new Error(`Unknown default_source_image ${defaultSource}.`);
  const persona = text(files, 'prompts/persona.md').trim();
  const mainId = provider?.avatar_id || avatarId(character.name);
  const visual = { source_images: sources, default_source_image_id: defaultSource };
  if (appearance.visual_instructions) visual.instructions = appearance.visual_instructions;
  const avatar = { avatar_id: mainId, visual };
  if (persona) avatar.instructions = persona;
  if (provider?.avatar_voice)
    avatar.voice = {
      provider: provider.avatar_voice.provider,
      provider_voice_id: provider.avatar_voice.provider_voice_id,
      model: provider.avatar_voice.model,
      ...(provider.avatar_voice.speed === undefined ? {} : { speed: provider.avatar_voice.speed }),
    };
  const avatars = [avatar];
  for (const frame of provider?.start_frames ?? []) {
    const image = {
      source_image_id: frame.id,
      url: frame.url,
      media_type: mediaType(frame.id, frame.url, frame.media_type),
      description: frame.description || '',
      ...(frame.opening ? { opening: frame.opening } : {}),
    };
    avatars.push({
      avatar_id: frame.id,
      instructions: persona,
      ...(avatar.voice ? { voice: avatar.voice } : {}),
      visual: { source_images: [image], default_source_image_id: frame.id, instructions: frame.description || '' },
    });
  }
  const conversation = {
    turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
    input_audio_transcription: { enabled: true, language: 'zh' },
  };
  if (character.conversation?.instructions) conversation.instructions = character.conversation.instructions;
  const defaults = {};
  if (character.conversation?.temperature !== undefined) defaults.temperature = character.conversation.temperature;
  if (character.conversation?.max_output_tokens !== undefined) defaults.max_output_tokens = character.conversation.max_output_tokens;
  if (Object.keys(defaults).length) conversation.response_defaults = defaults;
  if (tools.length) conversation.tools = tools;
  let pipeline = provider?.pipeline_config ? structuredClone(provider.pipeline_config) : {};
  if (!provider) {
    if (voice)
      pipeline.tts_config = {
        tts_provider: voice.provider,
        tts_voice_id: voice.voice_id,
        tts_model_id: voice.model,
        ...(voice.endpoint ? { tts_endpoint: voice.endpoint } : {}),
        ...(voice.workspace_id ? { tts_workspace_id: voice.workspace_id } : {}),
        ...(voice.speed === undefined ? {} : { speed: voice.speed }),
        ...(voice.stability === undefined ? {} : { stability: voice.stability }),
        ...voice.extra,
      };
    if (character.tts_config && Object.keys(character.tts_config).length) pipeline.tts_config = character.tts_config;
    if (character.vlm_config && Object.keys(character.vlm_config).length) pipeline.vlm_config = character.vlm_config;
    const motion = text(files, 'prompts/motion_enhanced.md').trim();
    const idle = text(files, 'prompts/idle_motion.md').trim();
    if (motion) pipeline.motion_enhanced = { prompt: motion };
    if (idle) pipeline.motion_planner = { prompt: idle };
  }
  const request = {
    model,
    session: { mode: 'video_avatar', active_avatar_id: mainId, source_image_id: defaultSource },
    output,
    conversation,
    avatars,
    recording_mode: character.session_defaults?.recording_mode || 'on',
    delivery: { media: { transport: 'trtc' } },
  };
  const duration = character.session_defaults?.max_duration_seconds;
  if (duration !== undefined && duration !== 0) request.max_duration_seconds = duration;
  else request.max_duration_seconds = 300;
  if (Object.keys(pipeline).length) request.pipeline_config = pipeline;
  const assets = imageAssets(files, character);
  if (assets.length) request.assets = { images: assets };
  if (provider?.region) request.region = provider.region;
  return { request, character, appearance, voice, provider, sources, defaultSource, persona };
}
