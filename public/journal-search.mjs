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
