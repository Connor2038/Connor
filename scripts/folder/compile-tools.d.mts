import type { FolderFiles } from './read-folder.mjs';
export interface CompiledToolDefinition {
  type: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export function compileTools(
  files: FolderFiles,
  options?: {
    hasUI?: boolean;
    rundownItems?: { id: string; title: string; description?: string }[];
    knowledge?: { path: string; title: string }[];
  },
): {
  definitions: CompiledToolDefinition[];
  runtime: {
    name: string;
    target: string;
    command: string[];
    timeout_ms: number;
    parameters: Record<string, unknown>;
  }[];
  unavailable: { name: string; target: string; reason: string }[];
};
