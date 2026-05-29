// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Arbetsformedlingen / Platsbanken provider via the official JobTech Job Search API.
// Docs: https://jobsearch.api.jobtechdev.se/

const API_URL = 'https://jobsearch.api.jobtechdev.se/search';

const DEFAULT_QUERIES = [
  'projektledare',
  'verksamhetsutvecklare',
  'affärsutvecklare',
  'förändringsledning',
  'management consultant',
  'business developer',
  'change manager',
  'digital transformation',
];

const DEFAULT_MUNICIPALITIES = [
  '1280', // Malmo
  '1281', // Lund
  '1283', // Helsingborg
];

function asList(value, fallback = []) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return fallback;
}

function buildSearchUrl(query, municipality, limit) {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('limit', String(limit));
  if (municipality) params.set('municipality', municipality);
  return `${API_URL}?${params.toString()}`;
}

function locationFor(hit) {
  const address = hit?.workplace_address || {};
  return [
    address.city,
    address.municipality,
    address.region,
    address.country,
  ].filter(Boolean).join(', ');
}

function companyFor(hit) {
  const employer = hit?.employer || {};
  return employer.workplace || employer.name || 'Platsbanken';
}

/** @type {Provider} */
export default {
  id: 'platsbanken',

  detect(entry) {
    if (entry.provider === 'platsbanken') return { url: API_URL };
    return null;
  },

  async fetch(entry, ctx) {
    const queries = asList(entry.queries, DEFAULT_QUERIES);
    const municipalities = asList(entry.municipalities, DEFAULT_MUNICIPALITIES);
    const limit = Number.isFinite(Number(entry.limit)) ? Number(entry.limit) : 50;

    const seen = new Set();
    const jobs = [];

    for (const query of queries) {
      for (const municipality of municipalities) {
        const url = buildSearchUrl(query, municipality, limit);
        const json = await ctx.fetchJson(url, {
          headers: { accept: 'application/json' },
          timeoutMs: 20_000,
        });
        const hits = Array.isArray(json?.hits) ? json.hits : [];

        for (const hit of hits) {
          const jobUrl = hit?.webpage_url || hit?.application_details?.url || '';
          const title = hit?.headline || '';
          if (!jobUrl || !title) continue;
          if (seen.has(jobUrl)) continue;
          seen.add(jobUrl);

          jobs.push({
            title,
            url: jobUrl,
            company: companyFor(hit),
            location: locationFor(hit),
          });
        }
      }
    }

    return jobs;
  },
};
