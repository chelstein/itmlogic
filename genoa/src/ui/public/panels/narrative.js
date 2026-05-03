// Narrative panel — renders the AI narrative section text.
// AI did NOT calculate anything; this is pure templated text.

export function renderNarrative(exhibit){
  const n = exhibit.narrative;
  document.getElementById('narrative-text').textContent =
    n?.text || 'No narrative attached.';
}
