import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, JOURNAL_FEED_CONTENT_TYPE, renderJournalFeed } from '../server/journal-feed.mjs';

test('journal RSS uses canonical entry links and escapes untrusted text', () => {
  const xml = renderJournalFeed([{
    id: 'entry one',
    title: 'Grow <strong> & "steady"',
    summary: "Owner's checked result > proposal",
    createdAt: '2026-10-08T12:00:00.000Z',
  }]);
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /Grow &lt;strong&gt; &amp; &quot;steady&quot;/);
  assert.match(xml, /Owner&apos;s checked result &gt; proposal/);
  assert.match(xml, /https:\/\/skwid\.fun\/journal\?entry=entry%20one/);
  assert.match(xml, /Thu, 08 Oct 2026 12:00:00 GMT/);
  assert.doesNotMatch(xml, /<strong>/);
});

test('empty journal RSS is valid and contains no fabricated items', () => {
  const xml = renderJournalFeed([]);
  assert.match(xml, /<channel>/);
  assert.doesNotMatch(xml, /<item>/);
  assert.doesNotMatch(xml, /<lastBuildDate>/);
});

test('XML escaping covers all reserved characters', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('journal feed declares the RSS media type', () => {
  assert.equal(JOURNAL_FEED_CONTENT_TYPE, 'application/rss+xml; charset=utf-8');
});
