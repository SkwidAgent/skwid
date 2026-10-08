const SITE_URL = 'https://skwid.fun';
const JOURNAL_URL = `${SITE_URL}/journal`;
const FEED_URL = `${SITE_URL}/api/journal/feed.xml`;
export const JOURNAL_FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8';

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const pubDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Journal entry has an invalid publication date.');
  return date.toUTCString();
};

export function renderJournalFeed(items) {
  if (!Array.isArray(items)) throw new TypeError('Journal feed items must be an array.');
  const latest = items.length ? `\n    <lastBuildDate>${escapeXml(pubDate(items[0].createdAt))}</lastBuildDate>` : '';
  const entries = items.map((item) => {
    const url = `${JOURNAL_URL}?entry=${encodeURIComponent(item.id)}`;
    return [
      '    <item>',
      `      <title>${escapeXml(item.title)}</title>`,
      `      <description>${escapeXml(item.summary)}</description>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${escapeXml(pubDate(item.createdAt))}</pubDate>`,
      '    </item>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>Skwid journal</title>',
    `    <link>${JOURNAL_URL}</link>`,
    '    <description>Owner-reviewed releases from Skwid&apos;s software evolution journal.</description>',
    '    <language>en-us</language>',
    `    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>${latest}`,
    entries,
    '  </channel>',
    '</rss>',
    '',
  ].filter(Boolean).join('\n');
}
