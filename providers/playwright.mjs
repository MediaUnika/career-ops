// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Generic browser-backed listing provider for job boards that need rendered DOM.
// Fetches are serialized because Playwright scans are heavier than API calls and
// many boards rate-limit aggressive parallel browsing.

const JOB_PATH_RE = /\/(job|jobs|jobannonce|jobopslag|stillinger|stilling|career|careers|vacanc|position|ledige|find-job)/i;
const BLOCKED_EXT_RE = /\.(pdf|png|jpe?g|gif|svg|webp|zip|docx?|xlsx?)(?:[?#]|$)/i;
const COOKIE_RE = /accept|allow all|agree|godkend|accepter|tillad/i;

let queue = Promise.resolve();

function clean(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function titleCaseHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch {
    return '';
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
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
  const host = parsed.hostname.replace(/^www\./, '');
  if (sourceHost && host !== sourceHost && !host.endsWith(`.${sourceHost}`)) {
    if (!/linkedin\.com|thehub\.io|jobindex\.dk|it-jobbank\.dk|jobnet\.dk|workindenmark\.jobnet\.dk|englishjobs\.dk|altinget\.dk|moment\.dk|um\.dk|danskindustri\.dk|novonordisk\.|dr\.dk|tv2\.dk|svt\.se|ashbyhq\.com|greenhouse\.io|lever\.co/i.test(host)) {
      return false;
    }
  }
  return JOB_PATH_RE.test(`${parsed.pathname}${parsed.search}`);
}

function locationFromText(text) {
  if (/copenhagen|københavn|koebenhavn/i.test(text)) return 'Copenhagen, Denmark';
  if (/denmark|danmark/i.test(text)) return 'Denmark';
  if (/new york/i.test(text)) return 'New York';
  if (/las vegas|nevada/i.test(text)) return 'Las Vegas, Nevada';
  if (/london/i.test(text)) return 'London';
  if (/remote|fjernarbejde|hybrid/i.test(text)) return 'Remote';
  if (/stockholm|sweden|sverige/i.test(text)) return 'Stockholm, Sweden';
  return '';
}

async function tryAcceptCookies(page) {
  for (const locator of [
    page.getByRole('button', { name: COOKIE_RE }).first(),
    page.getByText(COOKIE_RE).first(),
  ]) {
    try {
      if (await locator.isVisible({ timeout: 800 })) {
        await locator.click({ timeout: 1200 });
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // Continue to the next generic cookie locator.
    }
  }
}

async function autoScroll(page) {
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 700)));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function clickLoadMore(page) {
  for (let i = 0; i < 3; i += 1) {
    const button = page.getByRole('button', { name: /more|show|load|next|flere|vis flere|næste|neste/i }).first();
    try {
      if (!(await button.isVisible({ timeout: 500 }))) return;
      await button.click({ timeout: 1500 });
      await page.waitForTimeout(900);
    } catch {
      return;
    }
  }
}

function searchTokens(entry) {
  const raw = [
    entry.browser_keywords,
    entry.keywords,
    entry.scan_query,
    entry.query,
    entry.name,
  ].flat().join(' ');
  return clean(raw)
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 4 && !/site|https|http|jobs|find|denmark|danmark/.test(term))
    .slice(0, 30);
}

function normalizeTitle(title) {
  return clean(title)
    .replace(/\s+Se rejsetid\b.*$/i, '')
    .replace(/\s+As\s+[A-Z].*$/i, '')
    .replace(/\s+Vi søger\b.*$/i, '')
    .replace(/\s+We are looking\b.*$/i, '')
    .replace(/\s+-\s+Apply.*$/i, '')
    .replace(/\s+\|\s+.*$/, '')
    .replace(/\s+[-–—]\s+(Job|Jobs|Careers).*$/i, '')
    .slice(0, 160)
    .trim();
}

async function scrapeRenderedJobs(entry) {
  const url = entry.careers_url || entry.url || '';
  if (!url) return [];

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await tryAcceptCookies(page);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await clickLoadMore(page);
    await autoScroll(page);

    const pageUrl = normalizeUrl(page.url());
    const sourceHost = new URL(page.url()).hostname.replace(/^www\./, '');
    const tokens = searchTokens(entry);
    const rows = await page.evaluate(() => {
      const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const firstLine = (value) => String(value || '')
        .split(/\r?\n/)
        .map((line) => cleanText(line))
        .find((line) => line.length >= 3) || '';
      return [...document.querySelectorAll('a[href]')]
        .map((anchor) => {
          const container = anchor.closest('article, li, tr, div');
          const href = anchor.href;
          const title =
            cleanText(anchor.getAttribute('aria-label')) ||
            firstLine(anchor.querySelector('h1,h2,h3,h4,[class*="title" i],[class*="job-title" i]')?.textContent) ||
            firstLine(anchor.innerText || anchor.textContent) ||
            firstLine(container?.textContent);
          const context = cleanText(container?.textContent || anchor.textContent || '');
          return { href, title, context };
        })
        .filter((row) => row.href && row.title);
    });

    const seen = new Set();
    const jobs = [];
    for (const row of rows) {
      const jobUrl = normalizeUrl(row.href);
      if (!isLikelyJobUrl(jobUrl, sourceHost) || seen.has(jobUrl)) continue;
      if (jobUrl === pageUrl) continue;
      const title = normalizeTitle(row.title);
      const haystack = `${title} ${row.context}`.toLowerCase();
      if (!title || /cookie|privacy|terms|login|sign in|job agent|opret|gem søgning|gå direkte|skip to|vores partnere|our partners|vikar$/i.test(title)) continue;
      if (tokens.length > 0 && !tokens.some((term) => haystack.includes(term))) continue;
      seen.add(jobUrl);
      jobs.push({
        title,
        url: jobUrl,
        company: entry.company || titleCaseHost(jobUrl) || entry.name,
        location: locationFromText(row.context),
      });
    }
    return jobs;
  } finally {
    await browser.close();
  }
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/** @type {Provider} */
export default {
  id: 'playwright',

  detect(entry) {
    if (entry.provider === 'playwright' || entry.scan_method === 'playwright') {
      return { url: entry.careers_url || '' };
    }
    return null;
  },

  async fetch(entry) {
    const maxJobs = Number.isFinite(Number(entry.max_jobs)) ? Number(entry.max_jobs) : 30;
    const jobs = await enqueue(() => scrapeRenderedJobs(entry));
    return jobs.slice(0, maxJobs);
  },
};
