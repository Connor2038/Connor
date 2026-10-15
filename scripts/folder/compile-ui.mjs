const extensions = [
  '',
  '.jsx',
  '.js',
  '.tsx',
  '.ts',
  '.json',
  '.css',
  '/index.jsx',
  '/index.js',
  '/index.tsx',
  '/index.ts',
];
const external = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]);
const loaders = {
  jsx: 'jsx',
  js: 'jsx',
  ts: 'ts',
  tsx: 'tsx',
  css: 'css',
  json: 'json',
  png: 'dataurl',
  jpg: 'dataurl',
  jpeg: 'dataurl',
  gif: 'dataurl',
  webp: 'dataurl',
  svg: 'dataurl',
  avif: 'dataurl',
  ico: 'dataurl',
};

function resolveImport(importer, specifier, files) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../'))
    throw new Error(`Only relative ui/ imports and React are supported: ${specifier}`);
  const parts = importer.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length <= 1) throw new Error(`UI import escapes ui/: ${specifier}`);
      parts.pop();
    } else parts.push(part);
  }
  const base = parts.join('/');
  for (const extension of extensions) if (files.has(base + extension)) return base + extension;
  throw new Error(`Cannot resolve ${specifier} from ${importer}.`);
}

export async function compileCustomUI(files) {
  const source = new Map([...files].filter(([path]) => path.startsWith('ui/')));
  const hasCustomUI = source.has('ui/container.jsx') || source.has('ui/container.tsx');
  if (!hasCustomUI)
    return {
      hasCustomUI: false,
      js: `import React from 'react';\nexport default function CharacterUI({Avatar}) { return React.createElement(Avatar); }\n`,
      css: '',
    };
  const entry = source.has('ui/container.jsx') ? 'ui/container.jsx' : 'ui/container.tsx';
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    target: 'es2022',
    outfile: 'custom-ui.js',
    external: [...external],
    logLevel: 'silent',
    plugins: [
      {
        name: 'character-folder-ui',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (external.has(args.path)) return { path: args.path, external: true };
            if (args.kind === 'url-token' && /^(https:\/\/|data:)/.test(args.path))
              return { path: args.path, external: true };
            return {
              path:
                args.kind === 'entry-point'
                  ? entry
                  : resolveImport(args.importer, args.path, source),
              namespace: 'character-ui',
            };
          });
          build.onLoad({ filter: /.*/, namespace: 'character-ui' }, (args) => {
            const extension = args.path.split('.').at(-1);
            const loader = loaders[extension];
            if (!loader) throw new Error(`Unsupported UI import: ${args.path}`);
            return { contents: source.get(args.path), loader };
          });
        },
      },
    ],
  });
  return {
    hasCustomUI,
    js: result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '',
    css: result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '',
  };
}
