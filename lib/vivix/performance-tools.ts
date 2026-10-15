import type { TemplateConfig } from './types';

export function performanceTools(config: TemplateConfig) {
  if (!config.performances.length) return [];
  return [
    {
      type: 'function',
      name: 'play_performance_script',
      description:
        'Play a preset performance only when requested. Do not generate a spoken reply after calling this tool; the script supplies its own audio and movement. Available performances: ' +
        config.performances.map(({ id, title }) => `${id}=${title}`).join('; '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['script_id'],
        properties: {
          script_id: { type: 'string', enum: config.performances.map(({ id }) => id) },
        },
      },
    },
  ];
}

export function planPerformanceTool(config: TemplateConfig, argumentsJson: string) {
  let id: unknown;
  try {
    id = JSON.parse(argumentsJson)?.script_id;
  } catch {
    return { output: { ok: false, reason: 'invalid_arguments' } };
  }
  const performance = config.performances.find((item) => item.id === id);
  return performance
    ? {
        output: { ok: true, script_id: performance.id, status: 'accepted' },
        script: performance.script,
      }
    : {
        output: {
          ok: false,
          reason: 'no_matching_performance',
          available: config.performances.map(({ id }) => id),
        },
      };
}
