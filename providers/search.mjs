// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Generic search/listing provider for sources that are not ATS APIs.
// It handles:
// - tracked_companies entries with `scan_method: search`
// - entries with `provider: search`
// - virtual entries created from `search_queries`

const JOB_PATH_RE = /\/(job|jobs|jobannonce|jobopslag|stillinger|career|careers|vacanc|position|ledige)/i;
const BLOCKED_EXT_RE = /\.(pdf|png|jpe?g|gif|svg|webp|zip|docx?|xlsx?)(?:[?#]|$)/i;

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch {
    return '';
  }
}

function resolveUrl(href, baseUrl) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return '';
  try {
    return new URL(decodeEntities(href), baseUrl).toString();
  } catch {
    return '';
  }
}

function isLikelyJobUrl(url, sourceHost = '') {
  if (!url || BLOCKED_EXT_RE.test(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (sourceHost && parsed.hostname !== sourceHost && !parsed.hostname.endsWith(`.${sourceHost}`)) {
    const host = parsed.hostname.replace(/^www\./, '');
    if (!/linkedin\.com|thehub\.io|jobindex\.dk|it-jobbank\.dk|jobnet\.dk|englishjobs\.dk|altinget\.dk|moment\.dk|um\.dk|danskindustri\.dk|novonordisk\./i.test(host)) {
      return false;
    }
  }
  return JOB_PATH_RE.test(`${parsed.pathname}${parsed.search}`);
}

function extractAnchors(html, baseUrl) {
  const sourceHost = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const seen = new Set();
  const jobs = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const attrs = match[1] || '';
    const href = attrs.match(/\bhref=(["'])(.*?)\1/i)?.[2] || attrs.match(/\bhref=([^\s>]+)/i)?.[1] || '';
    const url = resolveUrl(href, baseUrl);
    if (!isLikelyJobUrl(url, sourceHost) || seen.has(url)) continue;
    const title = stripHtml(match[2]).replace(/\s+-\s+Apply.*$/i, '').trim();
    if (!title || title.length < 3 || /cookie|privacy|terms|login|sign in/i.test(title)) continue;
    seen.add(url);
    jobs.push({ title, url });
  }
  return jobs;
}

function extractBingResults(html) {
  const jobs = [];
  const seen = new Set();
  const resultRe = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(resultRe)) {
    const url = decodeEntities(match[1]);
    const title = stripHtml(match[2]);
    if (!isLikelyJobUrl(url) || seen.has(url) || !title) continue;
    seen.add(url);
    jobs.push({ title, url });
  }
  return jobs;
}

function locationFromText(text) {
  if (/copenhagen|københavn/i.test(text)) return 'Copenhagen, Denmark';
  if (/denmark|danmark/i.test(text)) return 'Denmark';
  if (/new york/i.test(text)) return 'New York';
  if (/las vegas|nevada/i.test(text)) return 'Las Vegas, Nevada';
  if (/london/i.test(text)) return 'London';
  if (/remote/i.test(text)) return 'Remote';
  return '';
}

async function fetchListingJobs(entry, ctx) {
  const url = entry.careers_url || entry.url || '';
  if (!url) return [];
  const html = await ctx.fetchText(url, { timeoutMs: 20_000 });
  return extractAnchors(html, url).map(job => ({
    ...job,
    company: entry.company || titleCaseHost(job.url) || entry.name,
    location: locationFromText(`${job.title} ${job.url}`),
  }));
}

async function fetchWebSearchJobs(entry, ctx) {
  const query = entry.query || entry.scan_query || '';
  if (!query) return [];
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=25`;
  const html = await ctx.fetchText(url, { timeoutMs: 20_000 });
  return extractBingResults(html).map(job => ({
    ...job,
    company: titleCaseHost(job.url) || entry.name,
    location: locationFromText(`${job.title} ${job.url}`),
  }));
}

/** @type {Provider} */
export default {
  id: 'search',

  detect(entry) {
    if (entry.provider === 'search' || entry.scan_method === 'search' || entry.query || entry.scan_query) return { url: entry.careers_url || '' };
    return null;
  },

  async fetch(entry, ctx) {
    const maxJobs = Number.isFinite(Number(entry.max_jobs)) ? Number(entry.max_jobs) : 25;
    let jobs = [];
    if (entry.careers_url) {
      jobs = await fetchListingJobs(entry, ctx);
    }
    if (jobs.length === 0 && (entry.query || entry.scan_query)) {
      jobs = await fetchWebSearchJobs(entry, ctx);
    }
    return jobs.slice(0, maxJobs);
  },
};
