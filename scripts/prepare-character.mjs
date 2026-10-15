import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileRundown } from './folder/compile-rundown.mjs';
import { compileKnowledge } from './folder/compile-knowledge.mjs';
import { compileSession } from './folder/compile-session.mjs';
import { compileTools } from './folder/compile-tools.mjs';
import { compileCustomUI } from './folder/compile-ui.mjs';
import { readCharacterFolder } from './folder/read-folder.mjs';

function openingFor(appearance, sourceId) {
  const source = appearance.source_images.find((image) => image.id === sourceId);
  return source?.opening ?? { dialogue: '', action: { prompt: '', duration_ms: 0 } };
}

function runtimeConfig(compiled, rundown) {
  const { request, character, appearance, sources, defaultSource } = compiled;
  return {
    id: 'creator-clone',
    name: character.name,
    description: character.description || 'A portable Vivix Creator project.',
    characterName: character.name,
    model: request.model,
    voice: { tts_provider: '', tts_voice_id: '', tts_model_id: '' },
    sourceImages: sources.map((image) => ({
      id: image.source_image_id,
      url: image.url,
      localPath: image.url,
      description: image.description || '',
      title: image.title,
    })),
    references: request.assets?.images ?? [],
    products: rundown.products,
    product_playlist: rundown.playlist,
    performances: [],
    opening: openingFor(appearance, defaultSource),
    suggestions: [],
  };
}

async function writeJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function prepareCharacter(projectRoot = process.cwd()) {
  const files = await readCharacterFolder(join(projectRoot, 'character'));
  const rundown = compileRundown(files);
  const hasUI = files.has('ui/container.jsx') || files.has('ui/container.tsx');
  const ui = await compileCustomUI(files);
  const knowledge = compileKnowledge(files);
  const tools = compileTools(files, { hasUI, rundownItems: rundown.items, knowledge });
  const compiled = compileSession(files, tools.definitions);
  const generated = join(projectRoot, 'generated');
  await Promise.all([
    writeJSON(join(generated, 'session.json'), compiled.request),
    writeJSON(join(generated, 'runtime.json'), runtimeConfig(compiled, rundown)),
    writeJSON(join(generated, 'tools.json'), tools),
    writeJSON(join(generated, 'rundown.json'), rundown),
    writeJSON(join(generated, 'knowledge.json'), knowledge),
    writeFile(join(generated, 'custom-ui.mjs'), ui.js),
    writeFile(join(generated, 'custom-ui.css'), ui.css),
    writeFile(
      join(generated, 'custom-ui-css.ts'),
      `const css = ${JSON.stringify(ui.css)};\nexport default css;\n`,
    ),
  ]);
  return { generated, session: compiled.request, tools, rundown, knowledge, ui };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  await prepareCharacter();
  process.stderr.write('Prepared character Folder for Creator Clone.\n');
}
