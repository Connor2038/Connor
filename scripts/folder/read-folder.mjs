import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { parse } from 'yaml';

const fixed = new Set([
  'AGENTS.md',
  'CONTEXT.md',
  'CONTEXT.meta.json',
  'character.yaml',
  'appearance.yaml',
  'voice.yaml',
  'hooks.yaml',
  'rundown.yaml',
  'provider/vivix_official_dh30.yaml',
  'ui/stage.yaml',
  'ui/media.yaml',
  'prompts/persona.md',
  'prompts/motion_enhanced.md',
  'prompts/idle_motion.md',
  'character.export.json',
]);

export function canonicalFolderPath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  if (fixed.has(path)) return true;
  if (/^assets\/images\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/.test(path)) return true;
  if (/^knowledge\/.+\.md$/.test(path)) return true;
  if (/^tools\/[^/.][^/]*$/.test(path)) return true;
  return path.startsWith('ui/');
}

export async function readCharacterFolder(directory = resolve('character')) {
  const files = new Map();
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.gitkeep') continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const path = relative(directory, absolute).split(sep).join('/');
        if (!canonicalFolderPath(path)) throw new Error(`Unsupported Character Folder path: ${path}`);
        files.set(path, await readFile(absolute));
      }
    }
  }
  await visit(directory);
  if (!files.has('character.yaml')) throw new Error('character/character.yaml is required.');
  return files;
}

export function text(files, path, required = false) {
  const value = files.get(path);
  if (!value) {
    if (required) throw new Error(`${path} is required.`);
    return '';
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

export function yaml(files, path, required = false) {
  const value = text(files, path, required);
  if (!value) return undefined;
  const parsed = parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${path} must contain a YAML object.`);
  return parsed;
}
