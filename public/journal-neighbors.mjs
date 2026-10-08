const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const normalizeQuery = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
const querySuffix = (value) => {
  const query = normalizeQuery(value);
  return query ? `&q=${encodeURIComponent(query)}` : '';
};

function neighborLink(neighbor, direction, query) {
  if (!neighbor || typeof neighbor.id !== 'string' || !UUID.test(neighbor.id)) return '';
  const title = typeof neighbor.title === 'string' && neighbor.title.trim() ? neighbor.title.trim() : 'Untitled entry';
  return `<a href="/journal?entry=${encodeURIComponent(neighbor.id.toLowerCase())}${querySuffix(query)}" class="neighbor-link ${direction}"><span>${direction === 'newer' ? 'Newer entry' : 'Older entry'}</span><strong>${escapeHtml(title)}</strong></a>`;
}

export function renderJournalNeighbors(neighbors = {}, query = '') {
  const newer = neighborLink(neighbors?.newer, 'newer', query);
  const older = neighborLink(neighbors?.older, 'older', query);
  const normalized = normalizeQuery(query);
  const allEntries = normalized ? `/journal?q=${encodeURIComponent(normalized)}` : '/journal';
  return `<nav class="entry-neighbors" aria-label="Adjacent journal entries"><div>${newer}</div><a class="text-link" href="${allEntries}">All entries</a><div>${older}</div></nav>`;
}
