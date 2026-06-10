import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { costOf, priceFor, Usage } from './pricing';

export const PROJECTS_DIR =
  process.env.PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');

export interface Entry {
  ts: number | null;
  model: string;
  project: string;
  session: string;
  msgId: string | null;
  requestId: string | null;
  usage: Usage;
  cost: number;
  known: boolean;
}

// Turn the encoded project-dir name back into a readable path.
// Claude Code encodes /Users/me/foo as -Users-me-foo.
function decodeProject(dirName: string): string {
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

function listTranscripts(dir: string = PROJECTS_DIR): Array<{ project: string; file: string }> {
  const out: Array<{ project: string; file: string }> = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const projDir = path.join(dir, p.name);
    let files: string[];
    try {
      files = fs.readdirSync(projDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith('.jsonl')) {
        out.push({ project: decodeProject(p.name), file: path.join(projDir, f) });
      }
    }
  }
  return out;
}

// Per-file parse cache keyed by size+mtime so unchanged transcripts are not
// re-read on every poll. Realtime feel, low overhead.
const fileCache = new Map<string, { sig: string; entries: Entry[] }>();

function parseFile(file: string, project: string): Entry[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  const sig = `${stat.size}:${stat.mtimeMs}`;
  const cached = fileCache.get(file);
  if (cached && cached.sig === sig) return cached.entries;

  const entries: Entry[] = [];
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const session = path.basename(file, '.jsonl');
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o['type'] !== 'assistant' || !o['message'] || !o['message']['usage']) continue;
    const m = o['message'];
    const u = m['usage'];
    const cc = u['cache_creation'] || {};
    const usage: Usage = {
      input: u['input_tokens'] || 0,
      output: u['output_tokens'] || 0,
      cacheWrite5m: cc['ephemeral_5m_input_tokens'] != null
        ? cc['ephemeral_5m_input_tokens']
        : (u['cache_creation_input_tokens'] || 0),
      cacheWrite1h: cc['ephemeral_1h_input_tokens'] || 0,
      cacheRead: u['cache_read_input_tokens'] || 0,
    };
    entries.push({
      ts: o['timestamp'] ? Date.parse(o['timestamp']) : null,
      model: m['model'] || 'unknown',
      project,
      session,
      msgId: m['id'] || null,
      requestId: o['requestId'] || null,
      usage,
      cost: costOf(m['model'], usage),
      known: !!priceFor(m['model']),
    });
  }
  fileCache.set(file, { sig, entries });
  return entries;
}

// Read every transcript, dedupe records that appear in more than one file
// (resumed sessions / sidechains repeat the same assistant message), and
// return them sorted by timestamp.
export function loadEntries(dir: string = PROJECTS_DIR): Entry[] {
  const all: Entry[] = [];
  const seen = new Set<string>();
  for (const { project, file } of listTranscripts(dir)) {
    for (const e of parseFile(file, project)) {
      if (e.ts == null) continue;
      const key = e.msgId && e.requestId ? `${e.msgId}:${e.requestId}` : null;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      all.push(e);
    }
  }
  all.sort((a, b) => (a.ts as number) - (b.ts as number));
  return all;
}
