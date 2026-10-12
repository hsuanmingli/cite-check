#!/usr/bin/env node
// claim-check: for every cited claim in a markdown/text document, fetch the
// cited page and check whether the claim actually appears there.
// Zero dependencies. Node 18+ (uses global fetch).
//
// Usage:
//   node claim-check.mjs <doc.md> [--out report.md] [--json] [--timeout 20]
//
// Verdicts: found | partial | not found | unreachable

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// ---------- args ----------
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
  console.log('Usage: node claim-check.mjs <doc.md> [--out report.md] [--json] [--timeout 20]');
  process.exit(argv.length ? 0 : 1);
}
const docPath = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const outPath = opt('--out', null);
const asJson = argv.includes('--json');
const timeoutMs = Number(opt('--timeout', '20')) * 1000;

// ---------- 1. extract claims ----------
const URL_RE = /https?:\/\/[^\s<>)\]"'，。、」]+/g;
const trimUrl = (u) => u.replace(/[.,;:!?]+$/, '');

function extractClaims(text) {
  const lines = text.split(/\r?\n/);
  const footnotes = {};
  const body = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const fn = line.match(/^\s*\[\^([^\]]+)\]:\s*(.*)$/);
    if (fn) {
      const u = fn[2].match(URL_RE);
      if (u) footnotes[fn[1]] = trimUrl(u[0]);
      continue;
    }
    body.push(line);
  }

  const claims = [];
  // Treat each non-empty line (paragraph / list item / table row) as a unit.
  for (const rawLine of body) {
    let line = rawLine.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, '').trim();
    if (!line) continue;
    const urls = [];
    // Protect links with placeholders so sentence splitting never breaks a URL.
    // Link URLs may contain one level of parentheses, e.g. wiki/Python_(programming_language).
    line = line.replace(/\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g, (_, t, u) => {
      urls.push(trimUrl(u));
      return `${t}⟦${urls.length - 1}⟧`;
    });
    line = line.replace(/\[\^([^\]]+)\]/g, (_, id) => {
      if (!footnotes[id]) return '';
      urls.push(footnotes[id]);
      return `⟦${urls.length - 1}⟧`;
    });
    line = line.replace(URL_RE, (u) => {
      urls.push(trimUrl(u));
      return `⟦${urls.length - 1}⟧`;
    });
    if (!urls.length) continue;
    // A parenthetical that is only a citation, e.g. "([Wikipedia](url))" or "(https://...)", is not part of the claim.
    line = line.replace(/\(\s*[^()\u27E6]{0,30}?((?:\u27E6\d+\u27E7\s*)+)\)/g, '$1');
    // Citation markers after the sentence end belong to that sentence.
    line = line.replace(/([.!?。！？])((?:\s*\u27E6\d+\u27E7)+)/g, '$2$1');

    const sentences = line.split(/(?<=[.!?])\s+(?=["“'(\[A-Z0-9⟦])|(?<=[。！？])/);
    for (const s of sentences) {
      const ids = [...s.matchAll(/⟦(\d+)⟧/g)].map((m) => Number(m[1]));
      if (!ids.length) continue;
      const claim = s.replace(/⟦\d+⟧/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
      if (claim.replace(/[\s\p{P}]/gu, '').length < 4) continue; // nothing to check
      for (const id of new Set(ids)) claims.push({ claim, url: urls[id] });
    }
  }
  return claims;
}

// ---------- 2. fetch pages ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·' };
function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|br|li|tr|td|th|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol|dd|dt|figcaption)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, '\n')
    // Attribute values can contain '>' (e.g. Wikipedia's data-mw JSON), so skip over quoted strings
    .replace(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; claim-check/0.1; +https://github.com/)',
        Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (/pdf/i.test(type)) return { error: 'PDF (not supported in MVP)' };
    if (type && !/text|html|xml|json/i.test(type)) return { error: `unsupported type ${type.split(';')[0]}` };
    const body = await res.text();
    const text = /html|xml/i.test(type) || /^\s*</.test(body) ? htmlToText(body) : body;
    if (text.replace(/\s/g, '').length < 200) return { error: 'page has almost no text (JS-rendered or blocked?)', text };
    return { text };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message) };
  }
}

// ---------- 3. match ----------
const STOP = new Set('the a an and or of to in on at for by with from as is are was were be been being this that these those it its into than then there their they he she we you i our your his her not no but if so such which who whom what when where how also has have had do does did can could will would may might shall should about over after before between per via according said says say source see more most other some any all each new one two'.split(' '));
const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

function norm(s) {
  return s.toLowerCase()
    .replace(/[“”«»„]/g, '"').replace(/[‘’`]/g, "'").replace(/[–—]/g, '-')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
function tokens(s) {
  const out = new Set();
  const n = norm(s);
  for (const w of n.match(/[a-z0-9][a-z0-9'.-]*[a-z0-9]|[a-z0-9]/g) || []) {
    if (/^\d/.test(w) || (w.length >= 3 && !STOP.has(w))) out.add(w.replace(/'s$/, ''));
  }
  // CJK: character bigrams
  const cjkRuns = n.match(new RegExp(`${CJK.source}+`, 'g')) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}
function numbersIn(s) {
  return [...new Set((norm(s).match(/\d+(?:\.\d+)?/g) || []).filter((x) => x.length >= 2 || /\./.test(x)))];
}
function quotesIn(s) {
  const q = [];
  for (const m of s.matchAll(/["“]([^"”]{12,})["”]|「([^」]{6,})」|『([^』]{6,})』/g)) q.push(m[1] || m[2] || m[3]);
  return q;
}
function splitSentences(text) {
  return text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])|(?<=[。！？])/).map((s) => s.trim()).filter((s) => s.length > 3);
}
const clip = (s, n = 220) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function matchClaim(claim, pageText) {
  const sentences = splitSentences(pageText);
  const pageNorm = norm(pageText);
  const notes = [];

  // (a) quoted text gets an exact (normalized) substring check first
  const quotes = quotesIn(claim);
  let quoteFound = null, quoteMissing = false;
  for (const q of quotes) {
    const qn = norm(q);
    const idx = pageNorm.indexOf(qn);
    if (idx >= 0) {
      quoteFound = sentences.find((s) => norm(s).includes(qn.slice(0, 40))) || pageText.slice(idx, idx + 200);
    } else quoteMissing = true;
  }

  // (b) token overlap against every 1- and 2-sentence window
  const ct = tokens(claim);
  let best = { score: 0, snippet: '' };
  const relevant = [];
  if (ct.size) {
    for (let i = 0; i < sentences.length; i++) {
      for (const w of [1, 2]) {
        if (i + w > sentences.length) continue;
        const win = sentences.slice(i, i + w).join(' ');
        const wt = tokens(win);
        let hit = 0;
        for (const t of ct) if (wt.has(t)) hit++;
        const score = hit / ct.size;
        if (score >= 0.3) relevant.push(win);
        if (score > best.score + 1e-9) best = { score, snippet: win };
      }
    }
  }

  // (c) every number in the claim must appear in a passage that is about the claim
  //     (a window sharing >= 30% of the claim's key words), not just anywhere on the page.
  const nums = numbersIn(claim);
  const missingNums = nums.filter((n) => !relevant.some((w) => (norm(w).match(/\d+(?:\.\d+)?/g) || []).includes(n)));
  if (missingNums.length) notes.push(`numbers not found near matching text: ${missingNums.join(', ')}`);

  let verdict;
  if (quoteFound && !quoteMissing && !missingNums.length) {
    verdict = 'found';
    best.snippet = quoteFound;
    notes.unshift('exact quote');
  } else if (quoteMissing && !quoteFound) {
    verdict = best.score >= 0.6 ? 'partial' : 'not found';
    notes.unshift('quoted text not on page');
  } else if (best.score >= 0.75) verdict = 'found';
  else if (best.score >= 0.45) verdict = 'partial';
  else verdict = 'not found';

  if (verdict === 'found' && missingNums.length) verdict = 'partial';
  return { verdict, score: Math.round(best.score * 100) / 100, snippet: clip((best.snippet || '').replace(/\s+/g, ' ').trim()), notes };
}

// ---------- 4. run ----------
const doc = readFileSync(docPath, 'utf8');
const claims = extractClaims(doc);
if (!claims.length) {
  console.error('No cited claims found (looked for markdown links, [^footnotes] and bare URLs).');
  process.exit(2);
}

const uniqueUrls = [...new Set(claims.map((c) => c.url))];
const pages = new Map();
const CONCURRENCY = 4;
let next = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uniqueUrls.length) }, async () => {
  while (next < uniqueUrls.length) {
    const u = uniqueUrls[next++];
    pages.set(u, await fetchPage(u));
  }
}));

const results = claims.map((c, i) => {
  const page = pages.get(c.url);
  if (page.error && !page.text) return { n: i + 1, ...c, verdict: 'unreachable', score: null, snippet: '', notes: [page.error] };
  const m = matchClaim(c.claim, page.text);
  if (page.error) m.notes.push(page.error);
  return { n: i + 1, ...c, ...m };
});

const counts = results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});

if (asJson) {
  console.log(JSON.stringify({ document: docPath, checked_at: new Date().toISOString(), counts, results }, null, 2));
} else {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const icon = { found: '✅ found', partial: '🟡 partial', 'not found': '❌ not found', unreachable: '⚠️ unreachable' };
  const lines = [
    `# Claim check: ${basename(docPath)}`,
    '',
    `Checked ${results.length} citation(s) on ${new Date().toISOString().slice(0, 10)}. ` +
      ['found', 'partial', 'not found', 'unreachable'].map((k) => `${k}: ${counts[k] || 0}`).join(' · '),
    '',
    '| # | Claim | URL | Verdict | Overlap | Best matching sentence on page | Notes |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.n} | ${cell(clip(r.claim, 160))} | ${cell(r.url)} | ${icon[r.verdict]} | ${r.score ?? '–'} | ${cell(r.snippet)} | ${cell(r.notes.join('; '))} |`),
    '',
    '_Overlap = share of the claim\'s key words found in the best 1–2 sentence window of the page. Numbers in the claim must appear on the page, or the verdict is capped at partial._',
    '',
  ];
  const md = lines.join('\n');
  console.log(md);
  if (outPath) writeFileSync(outPath, md);
}
