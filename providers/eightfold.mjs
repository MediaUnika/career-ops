// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Eightfold.ai-hosted career sites (e.g. explore.jobs.{company}.{tld} —
// Netflix, and many other large companies use this platform). These are
// heavy React SPAs where job cards are click-handled divs, not <a href>
// elements, so the generic `playwright` provider's link-scraping can't see
// them. Eightfold exposes its full search state on `window.EF_REDUX_STORE`
// (a plain Redux store), which is far more reliable than DOM scraping.
//
// Known limitation: only the first page of results is read (Eightfold loads
// more via an internal scroll-triggered action that didn't fire from
// synthetic scroll/wheel events during testing — window.scrollTo,
// dispatching 'scroll' on window, and scrolling every overflow container on
// the page all left `positions` at the initial page size). `state.count` is
// the true total match count and is logged so the gap is visible rather than
// silently under-reporting. Fine as a periodic scan (catches the newest/most
// relevant postings, sorted via `sort_by=relevance` in the URL) — revisit if
// someone finds the actual "load more" trigger.

function clean(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

async function scrapeEightfold(entry) {
  const url = entry.careers_url || entry.url || '';
  if (!url) return [];

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await page.waitForFunction(() => typeof window.EF_REDUX_STORE?.getState === 'function', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500); // let the initial search request resolve into the store

    const state = await page.evaluate(() => {
      const store = window.EF_REDUX_STORE;
      if (!store || typeof store.getState !== 'function') return null;
      const s = store.getState();
      return {
        count: s.count,
        positions: (s.positions || []).map((p) => ({
          id: p.id,
          name: p.name,
          department: p.department,
          location: p.location,
          canonicalPositionUrl: p.canonicalPositionUrl,
        })),
      };
    });

    if (!state || state.positions.length === 0) return [];

    if (typeof state.count === 'number' && state.count > state.positions.length) {
      console.log(`  [eightfold] ${entry.name}: showing ${state.positions.length} of ${state.count} matching postings (pagination not yet automated)`);
    }

    return state.positions
      .filter((p) => p.id && p.name)
      .map((p) => ({
        title: clean(p.name),
        url: p.canonicalPositionUrl || `${new URL(url).origin}/careers/job/${p.id}`,
        company: entry.company || entry.name || '',
        location: clean(p.location || ''),
      }));
  } finally {
    await browser.close();
  }
}

/** @type {Provider} */
export default {
  id: 'eightfold',

  detect(entry) {
    if (entry.provider === 'eightfold' || entry.scan_method === 'eightfold') {
      return { url: entry.careers_url || '' };
    }
    if (/^https?:\/\/explore\.jobs\.[^/]+\/careers/i.test(entry.careers_url || '')) {
      return { url: entry.careers_url };
    }
    return null;
  },

  async fetch(entry) {
    const maxJobs = Number.isFinite(Number(entry.max_jobs)) ? Number(entry.max_jobs) : 30;
    const jobs = await scrapeEightfold(entry);
    return jobs.slice(0, maxJobs);
  },
};
