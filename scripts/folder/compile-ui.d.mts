import type { FolderFiles } from './read-folder.mjs';
export function compileCustomUI(files: FolderFiles): Promise<{ hasCustomUI: boolean; js: string; css: string }>;
