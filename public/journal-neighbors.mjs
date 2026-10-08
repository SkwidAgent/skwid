const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function neighborLink(neighbor, direction) {
  if (!neighbor || typeof neighbor.id !== 'string' || !UUID.test(neighbor.id)) return '';
  const title = typeof neighbor.title === 'string' && neighbor.title.trim() ? neighbor.title.trim() : 'Untitled entry';
  return `<a href="/journal?entry=${encodeURIComponent(neighbor.id.toLowerCase())}" class="neighbor-link ${direction}"><span>${direction === 'newer' ? 'Newer entry' : 'Older entry'}</span><strong>${escapeHtml(title)}</strong></a>`;
}

export function renderJournalNeighbors(neighbors = {}) {
  const newer = neighborLink(neighbors?.newer, 'newer');
  const older = neighborLink(neighbors?.older, 'older');
  return `<nav class="entry-neighbors" aria-label="Adjacent journal entries"><div>${newer}</div><a class="text-link" href="/journal">All entries</a><div>${older}</div></nav>`;
}
