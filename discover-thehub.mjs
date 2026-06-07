#!/usr/bin/env node
/**
 * discover-thehub.mjs — API-based discovery from The Hub (thehub.io)
 *
 * The Hub exposes a public JSON API used by its own frontend:
 *   https://thehub.io/api/jobs?search={term}&countryCode={cc}
 * Response: { docs: [ { id, key, title, company: { name }, location?, ... } ] }
 *
 * This queries a set of creative search terms, applies Uri's title_filter from
 * portals.yml, dedupes, and appends new leads to data/pipeline.md.
 *
 * Usage: node discover-thehub.mjs [term ...]   (defaults to creative terms)
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const root = import.meta.dirname;
const pipelinePath = path.join(root, "data", "pipeline.md");
const portalsPath = path.join(root, "portals.yml");

const COUNTRY = process.env.HUB_COUNTRY || "DK";
const TERMS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["creative", "brand", "art director", "content", "designer", "marketing", "video"];

function loadTitleFilter() {
  try {
    const p = yaml.load(fs.readFileSync(portalsPath, "utf8")) || {};
    const tf = p.title_filter || {};
    return {
      positive: (tf.positive || []).map((s) => String(s).toLowerCase()),
      negative: (tf.negative || []).map((s) => String(s).toLowerCase()),
    };
  } catch {
    return { positive: [], negative: [] };
  }
}

function titleOk(title, tf) {
  const t = title.toLowerCase();
  if (tf.negative.some((n) => t.includes(n))) return false;
  if (tf.positive.length && !tf.positive.some((p) => t.includes(p))) return false;
  return true;
}

function jobLocation(doc) {
  if (typeof doc.location === "string" && doc.location) return doc.location;
  if (Array.isArray(doc.locations) && doc.locations.length) return doc.locations.join(", ");
  if (Array.isArray(doc.cities) && doc.cities.length) return doc.cities.join(", ");
  return COUNTRY === "DK" ? "Denmark" : COUNTRY;
}

async function fetchHub(term) {
  const url = `https://thehub.io/api/jobs?search=${encodeURIComponent(term)}&countryCode=${COUNTRY}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`The Hub "${term}": HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.docs) ? data.docs : [];
}

const tf = loadTitleFilter();
const existing = fs.existsSync(pipelinePath) ? fs.readFileSync(pipelinePath, "utf8") : "";
const seen = new Set();
const rows = [];
const companies = new Set();

for (const term of TERMS) {
  let docs = [];
  try {
    docs = await fetchHub(term);
  } catch (e) {
    console.error(String(e.message || e));
    continue;
  }
  for (const d of docs) {
    const title = (d.title || "").trim();
    const company = (d.company && d.company.name) || d.companyName || "";
    const key = d.key || d.id;
    if (!title || !key) continue;
    const url = `https://thehub.io/jobs/${key}`;
    const dedup = `${title}|${company}`.toLowerCase();
    if (seen.has(dedup) || existing.includes(url)) continue;
    if (!titleOk(title, tf)) continue;
    seen.add(dedup);
    companies.add(company || "(unknown)");
    rows.push(`- [ ] ${url} | ${company} | ${title} | ${jobLocation(d)}`);
  }
}

if (rows.length) {
  const block = `\n## The Hub — API discovery (${new Date().toISOString().slice(0, 10)})\n\n${rows.join("\n")}\n`;
  fs.appendFileSync(pipelinePath, block, "utf8");
}

console.log(
  JSON.stringify(
    {
      source: "thehub-api",
      country: COUNTRY,
      terms: TERMS,
      added: rows.length,
      distinctCompanies: companies.size,
      companies: [...companies].slice(0, 25),
      sample: rows.slice(0, 12),
    },
    null,
    2
  )
);
