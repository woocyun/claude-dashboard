'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { costOf, priceFor } = require('./pricing');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Turn the encoded project-dir name back into a readable path.
// Claude Code encodes /Users/me/foo as -Users-me-foo.
function decodeProject(dirName) {
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

function listTranscripts(dir = PROJECTS_DIR) {
  const out = [];
  let projects;
  try {
    projects = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const projDir = path.join(dir, p.name);
    let files;
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
const fileCache = new Map(); // path -> { sig, entries }

function parseFile(file, project) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  const sig = `${stat.size}:${stat.mtimeMs}`;
  const cached = fileCache.get(file);
  if (cached && cached.sig === sig) return cached.entries;

  const entries = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const session = path.basename(file, '.jsonl');
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== 'assistant' || !o.message || !o.message.usage) continue;
    const m = o.message;
    const u = m.usage;
    const cc = u.cache_creation || {};
    const usage = {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheWrite5m: cc.ephemeral_5m_input_tokens != null
        ? cc.ephemeral_5m_input_tokens
        : (u.cache_creation_input_tokens || 0),
      cacheWrite1h: cc.ephemeral_1h_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
    };
    entries.push({
      ts: o.timestamp ? Date.parse(o.timestamp) : null,
      model: m.model || 'unknown',
      project,
      session,
      msgId: m.id || null,
      requestId: o.requestId || null,
      usage,
      cost: costOf(m.model, usage),
      known: !!priceFor(m.model),
    });
  }
  fileCache.set(file, { sig, entries });
  return entries;
}

// Read every transcript, dedupe records that appear in more than one file
// (resumed sessions / sidechains repeat the same assistant message), and
// return them sorted by timestamp.
function loadEntries(dir = PROJECTS_DIR) {
  const all = [];
  const seen = new Set();
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
  all.sort((a, b) => a.ts - b.ts);
  return all;
}

module.exports = { loadEntries, listTranscripts, PROJECTS_DIR };
