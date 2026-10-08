const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const scopeGroup = (scope) => {
  const normalized = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  if (normalized === 'syntax' || normalized === 'syntax-only') return 'syntax';
  if (normalized === 'runtime' || normalized === 'runtime-only') return 'runtime';
  return 'unknown';
};

const outcome = (value) => value === true
  ? { label: 'Passed', className: 'passed' }
  : value === false
    ? { label: 'Failed', className: 'failed' }
    : { label: 'Unknown', className: 'unknown' };

function checkMarkup(check) {
  const result = outcome(check?.ok);
  const name = typeof check?.name === 'string' && check.name.trim() ? check.name.trim() : 'Unnamed check';
  const scope = typeof check?.scope === 'string' && check.scope.trim() ? check.scope.trim() : 'Scope not recorded';
  return `<li><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(scope)}</span></div><span class="check-outcome ${result.className}">${result.label}</span></li>`;
}

export function renderJournalEvidence(entry = {}) {
  const identifiers = [
    ['Source revision', entry.commit],
    ['Patch digest · SHA-256', entry.details?.patchSha256],
  ];
  const groups = { syntax: [], runtime: [], unknown: [] };
  for (const check of Array.isArray(entry.checks) ? entry.checks : []) groups[scopeGroup(check?.scope)].push(check);
  const groupLabels = { syntax: 'Syntax checks', runtime: 'Runtime checks', unknown: 'Unclassified checks' };
  const populated = Object.entries(groups).filter(([, checks]) => checks.length);
  const checks = populated.length
    ? populated.map(([group, items]) => `<section class="evidence-check-group" data-scope="${group}"><h4>${groupLabels[group]}</h4><ul>${items.map(checkMarkup).join('')}</ul></section>`).join('')
    : '<p class="evidence-missing">No checks recorded.</p>';
  const id = typeof entry.id === 'string' ? entry.id : '';
  return `<div class="evidence-identifiers">${identifiers.map(([label, value]) => `<div><span>${label}</span><code>${value == null || value === '' ? 'Not recorded' : escapeHtml(value)}</code></div>`).join('')}</div><div class="evidence-checks"><h3>Recorded checks</h3>${checks}</div>${id ? `<a class="text-link" href="/api/journal/${encodeURIComponent(id)}">Read entry as JSON</a>` : ''}`;
}
