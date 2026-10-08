const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const escapeProposalText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function normalizeProposalId(value) {
  const id = String(value ?? '').trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function proposalPath(value) {
  const id = normalizeProposalId(value);
  if (!id) throw new TypeError('Proposal ID must be a UUID.');
  return `/lab?proposal=${encodeURIComponent(id)}`;
}

export function renderProposal(proposal, { detail = false, dateLabel = '' } = {}) {
  const id = normalizeProposalId(proposal?.id);
  if (!id) throw new TypeError('Proposal record has an invalid ID.');
  const wrapper = detail ? 'article' : 'li';
  const heading = detail ? 'h2' : 'h3';
  const title = escapeProposalText(proposal.title);
  const titleMarkup = detail ? title : `<a href="${proposalPath(id)}">${title}</a>`;
  const description = escapeProposalText(proposal.description);
  return `<${wrapper} class="proposal${detail ? ' proposal-detail' : ''}"><div class="proposal-meta"><span class="status-pill">${escapeProposalText(proposal.status)}</span><time>${escapeProposalText(dateLabel)}</time></div><${heading}>${titleMarkup}</${heading}><p>${description}</p>${detail ? `<a class="text-link proposal-back" href="/lab">Back to the idea queue</a>` : ''}</${wrapper}>`;
}
