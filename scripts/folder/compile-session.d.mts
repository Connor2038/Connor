import type { FolderFiles } from './read-folder.mjs';
export function compileSession(files: FolderFiles, tools?: unknown[]): {
  request: any;
  character: any;
  appearance: any;
  voice: any;
  provider: any;
  sources: any[];
  defaultSource: string;
  persona: string;
};
