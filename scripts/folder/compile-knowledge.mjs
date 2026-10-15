import { parse } from 'yaml';

import { text } from './read-folder.mjs';

function frontmatter(raw, path) {
  const lines = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  if (lines[0].trim() !== '---') return { metadata: {}, lines, firstLine: 1 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error(`${path} frontmatter is not closed.`);
  const metadata = parse(lines.slice(1, end).join('\n')) ?? {};
  if (metadata.schema_version && metadata.schema_version !== 'character-knowledge/v1')
    throw new Error(`${path} has unsupported knowledge schema ${metadata.schema_version}.`);
  return { metadata, lines: lines.slice(end + 1), firstLine: end + 2 };
}

function blocks(lines, firstLine) {
  const result = [];
  const headings = [];
  let body = [];
  let lineStart = 0;
  let page = 0;
  let pageStart = 0;
  let fenced = false;
  const flush = end => {
    const value = body.join('\n').trim();
    if (value)
      result.push({
        text: value,
        heading: headings.filter(Boolean).join(' > '),
        line_start: lineStart,
        line_end: end,
        page_start: pageStart,
        page_end: page,
      });
    body = [];
    lineStart = 0;
    pageStart = page;
  };
  lines.forEach((line, offset) => {
    const number = firstLine + offset;
    const trimmed = line.trim();
    if (!fenced) {
      const pageMatch = trimmed.match(/^<!--\s*source-page:\s*([1-9]\d*)\s*-->$/);
      if (pageMatch) {
        flush(number - 1);
        page = Number(pageMatch[1]);
        pageStart = page;
        return;
      }
      const heading = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
      if (heading) {
        flush(number - 1);
        headings.length = heading[1].length - 1;
        headings.push(heading[2].trim());
        return;
      }
      if (!trimmed) {
        flush(number - 1);
        return;
      }
    }
    if (!lineStart) {
      lineStart = number;
      pageStart = page;
    }
    body.push(line);
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) fenced = !fenced;
  });
  flush(firstLine + lines.length - 1);
  return result;
}

function chunks(items) {
  const output = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    output.push({
      ...pending[0],
      text: pending.map(item => item.text).join('\n\n'),
      line_end: pending.at(-1).line_end,
      page_end: pending.at(-1).page_end,
    });
    pending = [];
  };
  for (const item of items) {
    const points = [...item.text];
    if (points.length > 1200) {
      flush();
      for (let start = 0; start < points.length; start += 900) {
        output.push({ ...item, text: points.slice(start, start + 1000).join('').trim() });
        if (start + 1000 >= points.length) break;
      }
      continue;
    }
    const size = pending.reduce((total, part) => total + [...part.text].length + 2, 0);
    if (pending.length && (pending[0].heading !== item.heading || size >= 800 || size + points.length > 1200)) flush();
    pending.push(item);
  }
  flush();
  return output;
}

export function compileKnowledge(files) {
  const output = [];
  for (const path of [...files.keys()].filter(name => /^knowledge\/.+\.md$/.test(name)).sort()) {
    const raw = text(files, path).trim();
    if (!raw) continue;
    const { metadata, lines, firstLine } = frontmatter(raw, path);
    const parsed = blocks(lines, firstLine);
    const title = String(metadata.title || parsed[0]?.heading?.split(' > ')[0] || path.split('/').at(-1).replace(/\.md$/, ''));
    const source = {
      kind: metadata.source_kind || '', title, url: metadata.source_url || '',
      name: metadata.source_name || '', captured_at: metadata.captured_at || '', coverage: metadata.coverage || '',
    };
    output.push(...chunks(parsed).map(chunk => ({ path, title, source, ...chunk })));
  }
  return output;
}
