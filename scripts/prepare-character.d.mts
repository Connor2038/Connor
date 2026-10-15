export function prepareCharacter(projectRoot?: string): Promise<{
  generated: string;
  session: any;
  tools: any;
  rundown: any;
  knowledge: any[];
  ui: { hasCustomUI: boolean; js: string; css: string };
}>;
