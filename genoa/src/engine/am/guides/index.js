// Guide-module registry for the siteOptimizer decomposition.
// See README.md in this directory for the pattern and migration recipe.
//
// The registry throws AT IMPORT TIME if two modules claim the same key,
// making the duplicate-key clobbering defect class (2026 audit) structurally
// impossible for migrated guides.

import * as adaGuide          from './amSiteAccessibilityAndAdaComplianceGuide.js';
import * as groundSystemGuide from './amGroundSystemAndRadialFieldInstallationGuide.js';
import * as faaLightingGuide  from './amFaaTowerLightingAndObstructionMarkingGuide.js';

const MODULES = [
  adaGuide,
  groundSystemGuide,
  faaLightingGuide
];

const builders = {};
for (const m of MODULES){
  if (typeof m.key !== 'string' || !m.key)          throw new Error('guide module missing string export `key`');
  if (typeof m.build !== 'function')                throw new Error(`guide module ${m.key} missing function export \`build\``);
  if (Object.prototype.hasOwnProperty.call(builders, m.key)){
    throw new Error(`duplicate guide key registered: ${m.key}`);
  }
  builders[m.key] = m.build;
}

export const GUIDE_BUILDERS = Object.freeze(builders);
export const GUIDE_KEYS     = Object.freeze(Object.keys(builders));
