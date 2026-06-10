// ENGINEER REVIEW CHECKLIST — rendered immediately before the
// certification page.
//
// A consulting-engineer exhibit ships with an explicit review checklist
// so the engineer of record walks every load-bearing surface before
// signing.  The checkboxes are intentionally blank: Genoa never checks
// them — the reviewing engineer does, by hand or in the workbench.
//
// Items are static by design (the checklist is a review protocol, not a
// computed result); two conditional items appear only when the exhibit
// actually carries the relevant surface (AI advisory review, tower data).

export function buildEngineerReviewChecklistSection(exhibit, options = {}){
  const items = [
    '□  Facility data verified',
    '□  Coordinates verified',
    '□  ERP verified',
    '□  HAAT basis verified',
    '□  Tower data verified',
    '□  Interference study reviewed',
    '□  Source conflicts reviewed',
    '□  AI advisory review reviewed',
    '□  Filing readiness confirmed'
  ];

  return {
    id:      'engineer-review-checklist',
    type:    'paragraphs',
    heading: 'ENGINEER REVIEW CHECKLIST',
    paragraphs: [
      'The engineer of record should complete each item below before ' +
      'certifying this exhibit.  Genoa provides deterministic calculations ' +
      'and supporting evidence; the review and certification decisions are ' +
      'the engineer\'s alone.',
      ...items
    ]
  };
}
