// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// The Hub listing-page provider.
// The Hub does not expose a documented public jobs API, so this provider reads
// public listing pages and normalizes active job cards into scanner jobs.

function isTheHubUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'thehub.io' || parsed.hostname === 'www.thehub.io';
  } catch {
    return false;
  }
}

function uniq(values) {
  return [...new Set(values)];
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFrom(html) {
  const match = html.match(/<title>(.*?)<\/title>/is);
  return match ? match[1].replace(/\s+/g, ' ').trim().replace(/^The Hub \|\s*/, '').replace(/&amp;/g, '&') : '';
}

function splitTitle(title) {
  const parts = title.split(' | ').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { role: parts[0], company: parts[1] };
  return { role: title, company: 'The Hub' };
}

/** @type {Provider} */
export default {
  id: 'thehub',

  detect(entry) {
    const url = entry.careers_url || '';
    return isTheHubUrl(url) && url.includes('/jobs') ? { url } : null;
  },

  async fetch(entry, ctx) {
    const listingUrl = entry.careers_url;
    if (!listingUrl || !isTheHubUrl(listingUrl)) {
      throw new Error(`thehub: invalid listing URL for ${entry.name}`);
    }

    const listingHtml = await ctx.fetchText(listingUrl, { timeoutMs: 20_000 });
    const paths = uniq([...listingHtml.matchAll(/href="(\/jobs\/[a-zA-Z0-9]+)"/g)].map(m => m[1]));
    const maxJobs = Number.isFinite(Number(entry.max_jobs)) ? Number(entry.max_jobs) : 30;
    const jobs = [];

    for (const path of paths.slice(0, maxJobs)) {
      const url = `https://thehub.io${path}`;
      const html = await ctx.fetchText(url, { timeoutMs: 20_000 });
      const text = stripHtml(html);
      if (/This job is no longer active/i.test(text)) continue;

      const title = titleFrom(html);
      const { role, company } = splitTitle(title);
      if (!role) continue;

      let location = '';
      if (/Copenhagen|København/i.test(text)) location = 'Copenhagen, Denmark';
      else if (/Hellerup/i.test(text)) location = 'Hellerup, Denmark';
      else if (/Denmark/i.test(text)) location = 'Denmark';

      jobs.push({
        title: role,
        url,
        company,
        location,
      });
    }

    return jobs;
  },
};
