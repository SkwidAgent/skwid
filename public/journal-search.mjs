export function normalizeJournalQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function filterJournalEntries(items, value) {
  const query = normalizeJournalQuery(value).toLocaleLowerCase('en-US');
  if (!query) return Array.isArray(items) ? items : [];
  const terms = query.split(' ');
  return (Array.isArray(items) ? items : []).filter((item) => {
    const text = `${item?.title ?? ''} ${item?.summary ?? ''}`.toLocaleLowerCase('en-US');
    return terms.every((term) => text.includes(term));
  });
}

export function journalSearchPath(value) {
  const query = normalizeJournalQuery(value);
  return query ? `/journal?q=${encodeURIComponent(query)}` : '/journal';
}

export function journalEntryPath(id, value) {
  const entry = String(id ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry)) {
    throw new TypeError('Journal entry ID must be a UUID.');
  }
  const query = normalizeJournalQuery(value);
  return `/journal?entry=${encodeURIComponent(entry.toLowerCase())}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
}
