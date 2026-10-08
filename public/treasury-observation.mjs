const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function formatWei(value) {
  if (typeof value !== 'string' && typeof value !== 'bigint') return null;
  const source = typeof value === 'bigint' ? value.toString() : value;
  if (!/^(?:0|[1-9][0-9]*)$/.test(source)) return null;
  const wei = BigInt(source);
  const whole = wei / 10n ** 18n;
  const decimal = String(wei % 10n ** 18n).padStart(18, '0').slice(0, 6);
  return `${whole}.${decimal}`;
}

export function observationTime(value, now = Date.now()) {
  if ((typeof value !== 'string' && !(value instanceof Date)) || !Number.isFinite(now)) return null;
  const date = new Date(value);
  const observed = date.getTime();
  if (!Number.isFinite(observed) || observed > now) return null;
  const seconds = Math.floor((now - observed) / 1000);
  const age = seconds < 60 ? 'less than a minute ago'
    : seconds < 3600 ? `${Math.floor(seconds / 60)} ${Math.floor(seconds / 60) === 1 ? 'minute' : 'minutes'} ago`
      : seconds < 86400 ? `${Math.floor(seconds / 3600)} ${Math.floor(seconds / 3600) === 1 ? 'hour' : 'hours'} ago`
        : `${Math.floor(seconds / 86400)} ${Math.floor(seconds / 86400) === 1 ? 'day' : 'days'} ago`;
  return { iso: date.toISOString(), label: `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`, age };
}

export function renderTreasuryObservation(observation, now = Date.now()) {
  if (!observation || typeof observation !== 'object') return '<p class="quiet-state">No treasury observation has been recorded.</p>';
  const balance = formatWei(observation.balanceWei);
  const timing = observationTime(observation.observedAt, now);
  const address = typeof observation.address === 'string' && observation.address ? escapeHtml(observation.address) : 'Not recorded';
  const block = typeof observation.blockNumber === 'string' && /^(?:0|[1-9][0-9]*)$/.test(observation.blockNumber)
    ? escapeHtml(observation.blockNumber) : 'Not recorded';
  return `<div class="treasury-observation"><div class="treasury-row"><div><span>OBSERVED BALANCE</span><strong>${balance === null ? 'Unavailable' : `${balance} ETH`}</strong></div><div><span>TREASURY</span><strong class="treasury-address">${address}</strong></div></div><div class="observation-meta"><div><span>OBSERVED AT</span>${timing ? `<time datetime="${timing.iso}">${timing.label}</time><small>${timing.age}</small>` : '<strong>Timing unavailable</strong>'}</div><div><span>SOURCE BLOCK</span><strong>${block}</strong></div></div></div>`;
}
