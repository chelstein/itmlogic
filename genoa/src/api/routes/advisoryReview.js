// Advisory cross-check endpoint — ADVISORY ONLY.
//
//   POST /api/advisory/review
//     body: { disposition }   // the deterministic verdict + grounding facts
//                             // built client-side from the exhibit
//     returns: { available, text?, citations?, model?, reason? }
//
// Asks the KB-grounded rfengineer agent whether it concurs with the
// deterministic block/legacy/waiver disposition, with citations.  The agent
// can agree or question, but it CANNOT change the disposition and is
// instructed never to emit a pass/fail or numeric value — the engine's
// determination stands.  When the agent isn't configured the route returns
// { available:false } (200) so the UI degrades cleanly.
//
// When RFENGINEER_KB_KEY is set, this route also retrieves raw KB chunks
// keyed on the disposition's service and injects them as _rf_kb_grounding
// in the agent call.  The agent already queries its own attached KBs
// internally; the injected chunks are supplemental — verbatim source text
// the agent can reference for citations without relying on its own lookup.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { askRfEngineer, isRfAgentConfigured } from '../services/rfAgentClient.js';
import { retrieveFromKb, isKbRetrieveConfigured } from '../services/kbRetrieveClient.js';

const r = express.Router();

const REVIEW_TASK = [
  'A DETERMINISTIC FCC engine produced the disposition in the grounding below',
  'for a broadcast filing. Act as an advisory reviewer of record:',
  '- State whether you CONCUR with the disposition (block / legacy / waiver)',
  '  and briefly why, grounded in the controlling rule from your knowledge',
  '  base, with citations.',
  '- You may QUESTION it and note what the licensed engineer should re-check.',
  '- You MUST NOT change the disposition, and MUST NOT output any pass/fail',
  "  determination or numeric engineering value — the engine's result stands.",
  '- 3 to 5 sentences, conservative professional engineering language.'
].join('\n');

// Build a service-appropriate KB query from the disposition object.
function dispositionQuery(disposition){
  const svc = String(
    disposition?.service ||
    disposition?.station_inputs?.service ||
    ''
  ).toUpperCase();
  if (svc === 'AM'){
    return '§73.182 AM groundwave interference RSS §73.184 protected contours skywave NIF nighttime';
  }
  return '§73.215 FM contour protection §73.207 minimum distance separation spacing LPFM';
}

r.post('/advisory/review', asyncHandler(async (req, res) => {
  const disposition = req.body?.disposition;
  if (!disposition || typeof disposition !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'disposition (object) is required' });
  }
  if (!isRfAgentConfigured()){
    return res.json({ available: false, reason: 'rfengineer agent not configured' });
  }

  // Augment grounding with raw KB chunks when configured; fail-soft so
  // a KB error never blocks the agent call.
  let groundingWithKb = disposition;
  if (isKbRetrieveConfigured()){
    const query = dispositionQuery(disposition);
    const kbResult = await retrieveFromKb({ query, k: 4 }).catch(() => null);
    if (kbResult?.available && kbResult.chunks?.length){
      groundingWithKb = {
        ...disposition,
        _rf_kb_grounding: kbResult.chunks.map(c => ({
          source: c.source,
          text:   (c.text || '').slice(0, 600)
        }))
      };
    }
  }

  const result = await askRfEngineer({
    task:      REVIEW_TASK,
    grounding: groundingWithKb,
    timeoutMs: 60_000
  });
  res.json(result);
}));

export default r;
