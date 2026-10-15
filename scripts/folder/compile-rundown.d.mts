import type { FolderFiles } from './read-folder.mjs';
export function compileRundown(files: FolderFiles): {
  products: any[];
  playlist?: any;
  items: { id: string; title: string; description: string }[];
  media: any[];
};
