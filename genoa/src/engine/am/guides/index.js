// Guide-module registry for the siteOptimizer decomposition.
// See README.md in this directory for the pattern and migration recipe.
//
// buildGuideRegistry() throws on any duplicate key, missing key/build
// export, or a key that collides with a reserved top-level canonical
// authoritative field name — making the duplicate-key clobbering defect
// class (2026 audit) structurally impossible for migrated guides, and
// making it impossible for a migrated guide to shadow a canonical field.
// index.js calls it once, at import time, with the real module list;
// src/tests/guideRegistry.test.js calls it directly with synthetic module
// lists to prove the rejection behavior.

import * as adaGuide          from './amSiteAccessibilityAndAdaComplianceGuide.js';
import * as groundSystemGuide from './amGroundSystemAndRadialFieldInstallationGuide.js';
import * as faaLightingGuide  from './amFaaTowerLightingAndObstructionMarkingGuide.js';
import { RESERVED_CANONICAL_FIELD_NAMES } from '../canonical/reservedFieldNames.js';

const MODULES = [
  adaGuide,
  groundSystemGuide,
  faaLightingGuide
];

/**
 * Validate and index a list of guide modules ({key, build}) into a
 * key → build map. Throws on:
 *   - a module missing a string `key` export
 *   - a module missing a function `build` export
 *   - two modules claiming the same key (duplicate-key clobbering)
 *   - a module's key colliding with a reserved canonical authoritative
 *     field name (a guide may never shadow a canonical top-level field)
 *
 * @param {Array<{key: string, build: Function}>} modules
 * @param {Set<string>} [reservedNames] override for testing
 * @returns {{ GUIDE_BUILDERS: Readonly<object>, GUIDE_KEYS: ReadonlyArray<string> }}
 */
export function buildGuideRegistry(modules, reservedNames = RESERVED_CANONICAL_FIELD_NAMES){
  const builders = {};
  for (const m of modules){
    if (!m || typeof m.key !== 'string' || !m.key){
      throw new Error('guide module missing string export `key`');
    }
    if (typeof m.build !== 'function'){
      throw new Error(`guide module ${m.key} missing function export \`build\``);
    }
    if (reservedNames.has(m.key)){
      throw new Error(
        `guide key "${m.key}" collides with a reserved canonical authoritative field name — ` +
        'a guide may never shadow a top-level canonical field. Rename the guide key.'
      );
    }
    if (Object.prototype.hasOwnProperty.call(builders, m.key)){
      throw new Error(`duplicate guide key registered: ${m.key}`);
    }
    builders[m.key] = m.build;
  }
  return {
    GUIDE_BUILDERS: Object.freeze(builders),
    GUIDE_KEYS: Object.freeze(Object.keys(builders)),
  };
}

const { GUIDE_BUILDERS, GUIDE_KEYS } = buildGuideRegistry(MODULES);
export { GUIDE_BUILDERS, GUIDE_KEYS };
