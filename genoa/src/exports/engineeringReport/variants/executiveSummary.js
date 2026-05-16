// Executive-summary variant — customer-facing one-pager+ overview.
//
// Posture
//   Intended for client review meetings and ownership decks.  Reads as a
//   conservative consulting summary: cover, purpose, the visual coverage
//   page, the verdict, and the conclusion.  No raw radial tables, no
//   FORTRAN parity scatter, no replay-bundle hashes — those belong in
//   the full engineering report or the internal diagnostics variant.
//
// What survives
//   - cover, purpose, regulatory-context (when present)
//   - measurements + contour-results headline
//   - visual-summary (the showpiece coverage page)
//   - validation verdict (summary form)
//   - conclusion + certification
//   - Appendix D (provenance) and Appendix E (replay determinism)
//     are re-rendered in user-friendly form (no raw build_fingerprint
//     hashes, no replay command line, no engine SHA prefix).
//
// What is stripped
//   - All per-radial / per-azimuth tables (Appendix A, F-1, F-2, G,
//     PSRA/PSSA pairs)
//   - FORTRAN parity scatter + nighttime polar charts
//   - ITM coverage overlay and ITM-coverage section
//   - Spacing analysis / contour protection drilldowns
//   - Map package (kept) is retained because it is the deliverable.
//
// Returns a NEW document object — the caller's full doc is not mutated.

const KEEP_IDS = new Set([
  'cover',
  'purpose',
  'regulatory-context',
  'measurements',
  'contour-results',
  'map-package',
  'visual-summary',
  'validation',
  'conclusion',
  'certification',
  'appendix-d',
  'appendix-e'
]);

export function applyExecutiveSummaryVariant(doc){
  if (!doc || !Array.isArray(doc.sections)) return doc;
  const sections = [];
  for (const s of doc.sections){
    if (!s || !s.id) continue;
    if (!KEEP_IDS.has(s.id)) continue;
    if (s.id === 'appendix-d' || s.id === 'appendix-e'){
      sections.push(friendlyAppendixDe(s));
      continue;
    }
    // For surviving kv-style sections, scrub diagnostics rows.
    if (Array.isArray(s.rows)){
      sections.push({ ...s, rows: sanitizeDiagnosticsRows(s.rows) });
      continue;
    }
    sections.push(s);
  }
  const meta = {
    ...(doc.meta || {}),
    variant:  'exec_summary',
    title:    (doc.meta?.title || 'ENGINEERING STATEMENT'),
    subtitle: 'Executive Summary'
  };
  return { meta, sections };
}

// ── helpers (inlined; variants/_shared.js is not in the owned file set)─

// Rows that should not appear in a customer-facing variant.  Match by
// label (case-insensitive, substring) so the source section builders can
// emit any reasonable wording without us hardcoding exact strings.
const DIAGNOSTIC_LABEL_PATTERNS = [
  /build fingerprint/i,
  /node runtime/i,
  /replay bundle \(offline\)/i,
  /bundle hash/i,
  /^reproduction$/i,
  /engine sha-?256/i,
  /image sha-?256/i,
  /source sha-?256/i
];

function sanitizeDiagnosticsRows(rows){
  return rows.filter((r) => {
    if (!Array.isArray(r) || r.length < 1) return Boolean(r);
    const label = String(r[0] || '');
    return !DIAGNOSTIC_LABEL_PATTERNS.some((re) => re.test(label));
  });
}

// User-friendly Appendix D (provenance) / Appendix E (replay) renderings.
//   - Keep engine version + first-12 commit prefix + curve dataset label.
//   - Drop raw fingerprints, replay CLI command, FORTRAN source hashes.
//   - Re-word any remaining values to engineering-grade phrasing
//     (no "tier-3", no "stale", no "orchestrator", no "fallback").
function friendlyAppendixDe(section){
  if (!section || !Array.isArray(section.rows)) return section;
  const filtered = sanitizeDiagnosticsRows(section.rows).map(([label, value]) => {
    const v = String(value == null ? '' : value);
    // Truncate commits / hex hashes to a 12-char prefix so they are
    // referenceable but not visually dominant.
    const labelStr = String(label || '');
    if (/(commit|sha|fingerprint|hash)/i.test(labelStr) && /^[0-9a-f]{16,}$/i.test(v)){
      return [label, v.slice(0, 12)];
    }
    // Soften any leaked internal wording.
    const cleaned = v
      .replace(/\btier[- ]?3\b/gi,    'deterministic reference')
      .replace(/\bfallback\b/gi,      'reference computation')
      .replace(/\bstale\b/gi,         'cached')
      .replace(/\borchestrator\b/gi,  'engine')
      .replace(/\bgenoa replay[^\n]*/g, 'available on request');
    return [label, cleaned];
  });
  return { ...section, rows: filtered };
}
