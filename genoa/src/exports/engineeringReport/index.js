// Engineering report — top-level builder.
//
// Returns a serializable document model:
//   { meta: {...}, sections: [ ... ] }
// Section objects are produced by the per-section builders under ./sections/.
// Renderers (renderText.js, renderPdf.js) walk the model.
//
// Major content sections are tagged with an `exhibit_number` (Roman
// numeral), so the renderers display "EXHIBIT III — METHODOLOGY" rather
// than just "METHODOLOGY".  Cover, certification, and appendices are NOT
// numbered (they're chrome / supplementary, per H&D / Cavell-Mertz house
// style).

import { buildCoverSection }              from './sections/cover.js';
import { buildPurposeSection }            from './sections/purpose.js';
import { buildFacilityParametersSection } from './sections/facilityParameters.js';
import { buildMethodologySection }        from './sections/methodology.js';
import { buildAssumptionsSection }        from './sections/assumptions.js';
import { buildRegulatoryContextSection }  from './sections/regulatoryContext.js';
import { buildContourResultsSection }     from './sections/contourResults.js';
import { buildItmCoverageSection }        from './sections/itmCoverage.js';
import { buildBuildAttestationSection }   from './sections/buildAttestation.js';
import { buildSpacingAnalysisSection }    from './sections/spacingAnalysis.js';
import { buildContourProtectionSection }  from './sections/contourProtection.js';
import { buildRfExposureSection }         from './sections/rfExposure.js';
import { buildPopulationMethodologySection } from './sections/populationMethodology.js';
import { buildTerrainProvenanceSection }  from './sections/terrainProvenance.js';
import { buildValidationVerdictSection }  from './sections/validationVerdict.js';
import { buildConclusionSection }         from './sections/conclusion.js';
import { buildCertificationSection }      from './sections/certification.js';
import { buildReferencesSection }         from './sections/references.js';
import { buildAppendixSections }          from './sections/appendices.js';
import { buildEngineeringConsiderationsSection } from './sections/engineeringConsiderations.js';
import { buildEngineeringInterpretationSection }  from './sections/engineeringInterpretation.js';
import { buildMapPackageSection }         from './sections/mapPackage.js';
import { buildTowerStudySection }         from './sections/towerStudy.js';

const ROMAN = ['', 'I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV'];

// Section ids whose heading should be treated as a numbered exhibit.
// Cover / certification / appendices are intentionally excluded.
const NUMBERED_TYPES = new Set([
  'kv','paragraphs','paragraphs-with-kv','table','table-with-summary','verdict','considerations','image'
]);
const EXCLUDE_FROM_NUMBERING = new Set([
  'cover',
  'certification',
  'build_attestation',  // chrome — sits beside the seal, not a numbered exhibit
  'references'          // bibliography appendix
]);
// Any section whose id starts with one of these prefixes is treated as
// supplementary and excluded from exhibit numbering.
const EXCLUDE_PREFIXES = ['appendix-'];

export function buildEngineeringReport(exhibit, options){
  const opt = options || {};
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('buildEngineeringReport: exhibit is required');
  }

  const sections = [];
  const push = (s) => { if (s) sections.push(s); };

  push(buildCoverSection(exhibit, opt));
  push(buildPurposeSection(exhibit, opt));
  push(buildFacilityParametersSection(exhibit, opt));
  push(buildMethodologySection(exhibit, opt));
  push(buildAssumptionsSection(exhibit, opt));
  push(buildRegulatoryContextSection(exhibit, opt));
  push(buildEngineeringConsiderationsSection(exhibit, opt));
  push(buildEngineeringInterpretationSection(exhibit, opt));
  push(buildContourResultsSection(exhibit, opt));
  push(buildMapPackageSection(exhibit, opt));                // NEW — printable contour map (Chromium-rendered PNG)
  push(buildItmCoverageSection(exhibit, opt));
  push(buildSpacingAnalysisSection(exhibit, opt));
  push(buildContourProtectionSection(exhibit, opt));
  push(buildRfExposureSection(exhibit, opt));
  push(buildPopulationMethodologySection(exhibit, opt));
  push(buildTerrainProvenanceSection(exhibit, opt));
  push(buildTowerStudySection(exhibit, opt));               // NEW — §17.4 ASR + FAA OE/AAA + §17.21/.23 lighting/marking
  push(buildValidationVerdictSection(exhibit, opt));
  push(buildConclusionSection(exhibit, opt));
  push(buildBuildAttestationSection(exhibit, opt));
  push(buildCertificationSection(exhibit, opt));
  push(buildReferencesSection(exhibit, opt));
  for (const ap of buildAppendixSections(exhibit, opt)) push(ap);

  // Assign exhibit numbers (Roman) to the major content sections.
  let n = 0;
  for (const s of sections){
    if (!s || !s.heading) continue;
    if (EXCLUDE_FROM_NUMBERING.has(s.id)) continue;
    if (EXCLUDE_PREFIXES.some(p => typeof s.id === 'string' && s.id.startsWith(p))) continue;
    if (!NUMBERED_TYPES.has(s.type)) continue;
    n += 1;
    s.exhibit_number = ROMAN[n] || String(n);
  }

  const s   = exhibit.station_inputs || {};
  const mv  = exhibit.method_versions || {};
  const meta = {
    title:           'ENGINEERING EXHIBIT',
    subtitle:        'FCC Propagation Study',
    station:         s.call || s.facility_id || 'Subject Facility',
    facility_id:     s.facility_id || null,
    service:         String(s.service || '').toUpperCase() || null,
    community:       s.community || s.city || null,
    generated_by:    'Genoa FCC Propagation Studio',
    engine_version:  mv.engine_version || mv.curve_engine || 'genoa',
    generated_at:    new Date().toISOString(),
    footer:          'Genoa FCC Propagation Studio',
    n_exhibits:      n
  };

  return { meta, sections };
}
