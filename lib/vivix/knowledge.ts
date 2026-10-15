export interface KnowledgeChunk {
  path: string;
  title: string;
  heading: string;
  line_start: number;
  line_end: number;
  page_start: number;
  page_end: number;
  text: string;
  source: Record<string, string>;
}

const stopwords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with']);
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function tokenize(value: string) {
  const points = [...value.normalize('NFKC').toLowerCase()];
  const tokens: string[] = [];
  for (let index = 0; index < points.length; ) {
    if (cjk.test(points[index])) {
      let end = index + 1;
      while (end < points.length && cjk.test(points[end])) end++;
      for (let cursor = index; cursor + 1 < end; cursor++) tokens.push(points[cursor] + points[cursor + 1]);
      index = end;
      continue;
    }
    if (/^[\p{L}\p{N}]$/u.test(points[index])) {
      let value = points[index++];
      while (index < points.length && !cjk.test(points[index]) && /^[\p{L}\p{N}]$/u.test(points[index])) value += points[index++];
      tokens.push(value);
      continue;
    }
    index++;
  }
  return tokens;
}

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function range(start: number, end: number) {
  if (!start) return '';
  return end > start ? `${start}-${end}` : String(start);
}

export function searchKnowledge(chunks: KnowledgeChunk[], query: string, limit = 4) {
  query = query.trim();
  if (!query || [...query].length > 500 || limit < 1 || limit > 8) throw new Error('Knowledge query is invalid.');
  const queryTokens = [...new Set(tokenize(query).filter(token => !stopwords.has(token)))];
  if (!queryTokens.length) throw new Error('Knowledge query is invalid.');
  const documents = chunks.map(chunk => {
    const body = tokenize(chunk.text);
    const frequency = new Map<string, number>();
    body.forEach(token => frequency.set(token, (frequency.get(token) ?? 0) + 1));
    return {
      chunk,
      body,
      frequency,
      heading: new Set(tokenize(`${chunk.title} ${chunk.heading}`)),
      path: new Set(tokenize(chunk.path)),
    };
  });
  const average = Math.max(1, documents.reduce((sum, item) => sum + item.body.length, 0) / Math.max(1, documents.length));
  const frequency = new Map<string, number>();
  for (const token of queryTokens)
    frequency.set(token, documents.filter(item => item.frequency.has(token) || item.heading.has(token) || item.path.has(token)).length);
  const phrase = normalize(query);
  const best = new Map<string, { chunk: KnowledgeChunk; score: number }>();
  for (const item of documents) {
    let score = 0;
    let matched = false;
    for (const token of queryTokens) {
      const count = item.frequency.get(token) ?? 0;
      const heading = item.heading.has(token);
      const path = item.path.has(token);
      if (!count && !heading && !path) continue;
      matched = true;
      const df = frequency.get(token) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      if (count) score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * item.body.length / average));
      if (heading) score += 0.75 * idf;
      if (path) score += 0.25 * idf;
    }
    if (!matched) continue;
    if (phrase && (normalize(item.chunk.text).includes(phrase) || normalize(`${item.chunk.title} ${item.chunk.heading}`).includes(phrase))) score += 2;
    const group = `${item.chunk.path}:${item.chunk.line_start}-${item.chunk.line_end}`;
    if (!best.has(group) || best.get(group)!.score < score) best.set(group, { chunk: item.chunk, score });
  }
  const ordered = [...best.values()].sort((left, right) => right.score - left.score || left.chunk.path.localeCompare(right.chunk.path) || left.chunk.line_start - right.chunk.line_start);
  const result = { schema_version: 'character-knowledge-search-result/v1', status: ordered.length ? 'found' : 'not_found', hits: [] as unknown[], truncated: ordered.length > limit };
  for (const { chunk } of ordered.slice(0, limit)) {
    const hit = {
      path: chunk.path, heading: chunk.heading,
      locator: { lines: range(chunk.line_start, chunk.line_end), ...(chunk.page_start ? { pages: range(chunk.page_start, chunk.page_end) } : {}) },
      text: chunk.text, source: chunk.source,
    };
    const candidate = { ...result, hits: [...result.hits, hit] };
    if (Buffer.byteLength(JSON.stringify(candidate)) > 8192) {
      result.truncated = true;
      break;
    }
    result.hits.push(hit);
  }
  if (ordered.length && !result.hits.length) throw new Error('Knowledge result exceeds the output limit.');
  return result;
}
