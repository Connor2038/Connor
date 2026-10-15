export type FolderFiles = Map<string, Buffer>;
export function canonicalFolderPath(path: string): boolean;
export function readCharacterFolder(directory?: string): Promise<FolderFiles>;
export function text(files: FolderFiles, path: string, required?: boolean): string;
export function yaml(files: FolderFiles, path: string, required?: boolean): Record<string, any> | undefined;
