import type { TemplateConfig } from './types';

export function commerceTools(config: TemplateConfig) {
  if (!config.products.length) return [];
  const media =
    config.stage_layout?.layers.filter((layer) => layer.kind === 'video' && layer.visible) ?? [];
  return [
    {
      type: 'function',
      name: 'switch_product',
      description:
        'Start a product presentation. Use a product_id from this catalog: ' +
        JSON.stringify(
          config.products.map(({ id, name, description, price, currency }) => ({
            id,
            name,
            description,
            price,
            currency,
          })),
        ),
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', enum: config.products.map((product) => product.id) },
        },
        required: ['product_id'],
        additionalProperties: false,
      },
    },
    ...(media.length
      ? [
          {
            type: 'function',
            name: 'display_media',
            description:
              'Display a product film only when the viewer asks. Available films: ' +
              JSON.stringify(media.map(({ id, name }) => ({ id, name }))),
            parameters: {
              type: 'object',
              properties: { media_id: { type: 'string', enum: media.map((layer) => layer.id) } },
              required: ['media_id'],
              additionalProperties: false,
            },
          },
        ]
      : []),
  ];
}

export function planCommerceTool(config: TemplateConfig, name: string, argumentsJson: string) {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsJson);
    if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error();
  } catch {
    return { output: { ok: false, reason: 'invalid_arguments' } };
  }
  if (name === 'switch_product') {
    const product = config.products.find((item) => item.id === args.product_id);
    return product
      ? { output: { ok: true, product_id: product.id, status: 'accepted' }, productId: product.id }
      : {
          output: {
            ok: false,
            reason: 'no_matching_product',
            available: config.products.map((item) => item.id),
          },
        };
  }
  if (name === 'switch_room_view') {
    const frame = config.sourceImages.find((image) => image.id === args.room);
    return frame
      ? { output: { ok: true, room: frame.id }, frameId: frame.id }
      : { output: { ok: false, reason: 'no_matching_scene' } };
  }
  if (name === 'display_media') {
    const layer = config.stage_layout?.layers.find(
      (item) => item.id === args.media_id && item.kind === 'video' && item.visible,
    );
    return layer
      ? { output: { ok: true, displaying: layer.id }, mediaId: layer.id }
      : { output: { ok: false, reason: 'no_matching_media' } };
  }
  return { output: { ok: false, reason: 'tool_not_supported' } };
}
