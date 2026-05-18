// statusUtil — shared color + label helpers for candidate status badges.
// PROMISING and SCREENING ONLY are advisory; REVIEW REQUIRED and ENGINEER
// REVIEW REQUIRED warn the operator that a candidate cannot be trusted
// without human follow-up; NON-COMPLIANT is the only hard reject.

export const STATUS_TONES = {
  'PROMISING':                  { fg: '#63d471', bg: 'rgba(99,212,113,0.12)',  border: 'rgba(99,212,113,0.5)'  },
  'SCREENING ONLY':             { fg: '#6fd3ff', bg: 'rgba(111,211,255,0.10)', border: 'rgba(111,211,255,0.45)' },
  'REVIEW REQUIRED':            { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)',  border: 'rgba(255,179,71,0.5)'  },
  'ENGINEER REVIEW REQUIRED':   { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)',  border: 'rgba(255,179,71,0.5)'  },
  'NON-COMPLIANT':              { fg: '#ff5a5a', bg: 'rgba(255,90,90,0.12)',   border: 'rgba(255,90,90,0.55)'  }
};

export function tonesFor(label){
  return STATUS_TONES[label] || { fg: '#a89c84', bg: 'rgba(168,156,132,0.08)', border: 'rgba(168,156,132,0.4)' };
}

// Rank → colour gradient.  Top-rank candidate is amber (warm/featured);
// gradient cools through gold → cyan as rank degrades.
const RANK_COLORS = ['#ffb347', '#f3c86d', '#d6a36a', '#9fd3bd', '#6fd3ff', '#3e7e94'];
export function rankColor(rank){
  const i = Math.min(Math.max(0, (rank | 0) - 1), RANK_COLORS.length - 1);
  return RANK_COLORS[i];
}

// A candidate's primary "headline" status — chosen so the rank table
// can show one chip per row even when the server returns several.
// Severity order: NON-COMPLIANT > REVIEW REQUIRED > ENGINEER REVIEW
// REQUIRED > PROMISING > SCREENING ONLY.
const SEVERITY = [
  'NON-COMPLIANT',
  'REVIEW REQUIRED',
  'ENGINEER REVIEW REQUIRED',
  'PROMISING',
  'SCREENING ONLY'
];
export function primaryStatus(labels){
  if (!Array.isArray(labels) || labels.length === 0) return 'SCREENING ONLY';
  for (const s of SEVERITY){
    if (labels.includes(s)) return s;
  }
  return labels[0];
}
