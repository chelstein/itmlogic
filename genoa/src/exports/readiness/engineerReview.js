// Engineer Review Summary — takes a readiness report and produces a
// structured + plain-text summary for a consulting engineer's 15-second scan.

/**
 * buildEngineerReviewSummary(readiness, station?)
 *
 * @param {object} readiness  Output of buildReadinessReport
 * @param {object} [station]  Optional { call, service, frequency } for header line
 * @returns {{ determination, score, sections, text }}
 */
export function buildEngineerReviewSummary(readiness, station = {}) {
  const { determination, readiness_score: score, blockers = [], warnings = [], advisories = [] } = readiness;

  // ── Sections ───────────────────────────────────────────────────────────────

  const blockerItems = blockers.map(b => ({
    icon: '[X]',
    message: b.rule ? `${b.rule}: ${b.message}` : b.message,
    rule: b.rule ?? null,
    field: b.field ?? null,
    remedy: b.remedy ?? null,
    category: b.category ?? null,
  }));

  const warningItems = warnings.map(w => ({
    icon: '[!]',
    message: w.message,
    field: w.field ?? null,
    detail: w.detail ?? null,
  }));

  const advisoryItems = advisories.map(a => ({
    icon: '[i]',
    message: a.message,
  }));

  // ── Plain-text ─────────────────────────────────────────────────────────────

  const lines = [];

  // Header line — only when call/service are provided
  const { call, service, frequency } = station;
  if (call && service) {
    const freqPart = frequency ? ` · ${frequency}` : '';
    lines.push(`${call} · ${service}${freqPart} · ${determination} · Score: ${score}/100`);
    lines.push('');
  }

  const RULE = '─'.repeat(44);

  lines.push(`BLOCKERS ${RULE}`);
  if (blockerItems.length === 0) {
    lines.push('(none)');
  } else {
    for (const b of blockerItems) {
      lines.push(`[X] ${b.message}`);
    }
  }

  lines.push('');
  lines.push(`WARNINGS ${RULE}`);
  if (warningItems.length === 0) {
    lines.push('(none)');
  } else {
    for (const w of warningItems) {
      lines.push(`[!] ${w.message}`);
    }
  }

  lines.push('');
  lines.push(`ADVISORIES ${RULE}`);
  if (advisoryItems.length === 0) {
    lines.push('(none)');
  } else {
    for (const a of advisoryItems) {
      lines.push(`[i] ${a.message}`);
    }
  }

  const text = lines.join('\n');

  return {
    determination,
    score,
    sections: {
      blockers: blockerItems,
      warnings: warningItems,
      advisories: advisoryItems,
    },
    text,
  };
}
