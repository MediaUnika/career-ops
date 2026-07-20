import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Archive,
  BriefcaseBusiness,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Gauge,
  LayoutList,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import "./styles.css";

const scoreBands = [
  { id: "all", label: "All" },
  { id: "top", label: "Top 4.5+" },
  { id: "strong", label: "Strong 4.0+" },
];

function scoreTone(score) {
  if (score >= 4.5) return "excellent";
  if (score >= 4) return "strong";
  if (score >= 3.5) return "steady";
  return "low";
}

function compactUrl(url) {
  if (!url) return "No URL";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function UpdateButton() {
  const [state, setState] = useState("idle"); // idle | updating | error
  const [message, setMessage] = useState("");

  function pollForRestart() {
    let sawDown = false;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > 90000) {
        clearInterval(timer);
        setState("error");
        setMessage("Taking longer than expected -- check launcher/update.log");
        return;
      }
      try {
        const res = await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store" });
        if (res.ok && sawDown) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch {
        sawDown = true;
      }
    }, 1500);
  }

  async function runUpdate() {
    setState("updating");
    setMessage("Pulling latest changes...");
    try {
      const res = await fetch("/api/self-update", { method: "POST" });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || "Update failed");
      setMessage("Restarting -- this page will reload automatically...");
      pollForRestart();
    } catch (err) {
      setState("error");
      setMessage(err.message);
    }
  }

  return (
    <div className="updateBlock">
      <button
        className="updateButton"
        title="Pull latest changes and restart"
        onClick={runUpdate}
        disabled={state === "updating"}
      >
        <Download size={18} className={state === "updating" ? "spin" : ""} />
      </button>
      {message ? <small className={`updateMessage ${state}`}>{message}</small> : null}
    </div>
  );
}

function App() {
  const [data, setData] = useState({ summary: {}, applications: [], discovered: [], packages: [], sources: { tracked: [], searches: [] } });
  const [section, setSection] = useState("brief");
  const [mode, setMode] = useState("evaluated");
  const [query, setQuery] = useState("");
  const [band, setBand] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  async function loadData() {
    return fetch(`/career-data.json?t=${Date.now()}`)
      .then((res) => res.json())
      .then((json) => {
        const sorted = [...json.applications].sort((a, b) => b.score - a.score);
        const discovered = [...(json.discovered || [])].sort((a, b) => a.company.localeCompare(b.company));
        setData({ ...json, applications: sorted, discovered, packages: json.packages || [], sources: json.sources || { tracked: [], searches: [] } });
        setSelectedId(sorted[0]?.number || null);
      });
  }

  useEffect(() => {
    loadData();
  }, []);

  const packagedNumbers = useMemo(() => new Set(data.packages.map((pkg) => pkg.number).filter(Boolean)), [data.packages]);
  const pipelineApplications = useMemo(
    () => data.applications.filter((app) => !app.isPackaged && !packagedNumbers.has(app.number)),
    [data.applications, packagedNumbers],
  );
  const activeItems = mode === "evaluated" ? pipelineApplications : data.discovered;

  const statuses = useMemo(() => {
    return ["all", ...new Set(activeItems.map((app) => app.status))];
  }, [activeItems]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activeItems.filter((app) => {
      const haystack = [app.company, app.role, app.notes, app.location, app.source, app.archetype, app.keywords?.join(" ")]
        .join(" ")
        .toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (status !== "all" && app.status !== status) return false;
      if (mode === "evaluated" && band === "top" && app.score < 4.5) return false;
      if (mode === "evaluated" && band === "strong" && app.score < 4) return false;
      return true;
    });
  }, [activeItems, query, band, status, mode]);

  const selected = filtered.find((app) => (app.number || app.id) === selectedId) || filtered[0] || activeItems[0];
  const topCount = pipelineApplications.filter((app) => app.score >= 4.5).length;

  function addGeneratedPackage(result, app) {
    const id = result.publicBase.split("/").filter(Boolean).at(-1);
    const pkg = {
      id,
      number: result.number,
      title: `${result.company} - ${result.role}`,
      company: result.company,
      role: result.role,
      score: app?.score || 0,
      status: "Package",
      files: result.files,
    };
    setData((current) => ({
      ...current,
      summary: { ...current.summary, packageTotal: Math.max(current.summary.packageTotal || 0, current.packages.length + 1) },
      packages: [pkg, ...current.packages.filter((item) => item.id !== id)],
    }));
  }

  function markAppliedInState(result) {
    setData((current) => ({
      ...current,
      applications: current.applications.map((app) =>
        app.number === result.number
          ? {
              ...app,
              status: "Applied",
              appliedDate: result.appliedDate,
              notes: app.notes?.includes(`Applied ${result.appliedDate}`)
                ? app.notes
                : `Applied ${result.appliedDate}${app.notes ? `; ${app.notes}` : ""}`,
            }
          : app,
      ),
      packages: current.packages.map((pkg) =>
        pkg.number === result.number ? { ...pkg, status: "Applied", appliedDate: result.appliedDate } : pkg,
      ),
    }));
    setSection("targets");
  }

  async function revertApplicationStatus(number) {
    const response = await fetch("/api/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, status: "Evaluated" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not revert status");
    setData((current) => ({
      ...current,
      applications: current.applications.map((app) =>
        app.number === number ? { ...app, status: "Evaluated", appliedDate: "", notes: (app.notes || "").replace(/^Applied \d{4}-\d{2}-\d{2};?\s*/, "") } : app,
      ),
      packages: current.packages.map((pkg) =>
        pkg.number === number ? { ...pkg, status: "Package", appliedDate: "" } : pkg,
      ),
    }));
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="mark">CO</span>
          <div>
            <strong>Career Ops</strong>
            <small>Uri L. Schwarz</small>
          </div>
        </div>
        <nav className="railNav" aria-label="Dashboard sections">
          <button className={section === "brief" ? "active" : ""} title="Brief" onClick={() => setSection("brief")}>
            <Gauge size={18} />
          </button>
          <button className={section === "sources" ? "active" : ""} title="Sources" onClick={() => setSection("sources")}>
            <RefreshCw size={18} />
          </button>
          <button className={section === "pipeline" ? "active" : ""} title="Pipeline" onClick={() => setSection("pipeline")}>
            <LayoutList size={18} />
          </button>
          <button className={section === "packages" ? "active" : ""} title="Packages" onClick={() => setSection("packages")}>
            <FileText size={18} />
          </button>
          <button className={section === "targets" ? "active" : ""} title="Targets" onClick={() => setSection("targets")}>
            <Target size={18} />
          </button>
        </nav>
        <UpdateButton />
      </aside>

      {section === "sources" ? (
        <SourcesWorkspace data={data} onDataReload={loadData} />
      ) : section === "brief" ? (
        <BriefWorkspace data={data} setSection={setSection} />
      ) : section === "packages" ? (
        <PackageWorkspace data={data} onApplied={markAppliedInState} />
      ) : section === "targets" ? (
        <TargetsWorkspace data={data} onRevert={revertApplicationStatus} />
      ) : (
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="kicker">Nordic job command centre</p>
            <h1>Application pipeline</h1>
          </div>
          <div className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company, role, keyword"
            />
          </div>
        </header>

        <section className="metrics" aria-label="Pipeline metrics">
          <Metric icon={<BriefcaseBusiness />} label="In pipeline" value={pipelineApplications.length} />
          <Metric icon={<FolderOpen />} label="Packaged" value={data.packages.length} />
          <Metric icon={<LayoutList />} label="Discovered" value={data.summary.discoveredTotal || 0} />
          <Metric icon={<Sparkles />} label="Top matches" value={topCount} />
        </section>

        <section className="modeTabs" aria-label="Dashboard data">
          <button
            className={mode === "evaluated" ? "selected" : ""}
            onClick={() => {
              setMode("evaluated");
              setStatus("all");
              setSelectedId(pipelineApplications[0]?.number || null);
            }}
          >
            Evaluated
          </button>
          <button
            className={mode === "discovered" ? "selected" : ""}
            onClick={() => {
              setMode("discovered");
              setStatus("all");
              setBand("all");
              setSelectedId(data.discovered[0]?.id || null);
            }}
          >
            Discovered inbox
          </button>
        </section>

        <section className="controls" aria-label="Filters">
          {mode === "evaluated" ? (
            <div className="segmented">
              {scoreBands.map((item) => (
                <button key={item.id} className={band === item.id ? "selected" : ""} onClick={() => setBand(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="segmented mutedControl">
              <span>{filtered.length} discovered leads shown</span>
            </div>
          )}
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "All statuses" : item}
              </option>
            ))}
          </select>
        </section>

        <div className="contentGrid">
          <section className="jobList" aria-label="Jobs">
            {filtered.map((app) => (
              <button
                key={app.number || app.id}
                className={`jobRow ${selected && (selected.number || selected.id) === (app.number || app.id) ? "isActive" : ""}`}
                onClick={() => setSelectedId(app.number || app.id)}
              >
                {app.score ? (
                  <span className={`score ${scoreTone(app.score)}`}>{app.score.toFixed(1)}</span>
                ) : (
                  <span className="score unscored">New</span>
                )}
                <span className="jobText">
                  <strong>{app.company}</strong>
                  <span>{app.role}</span>
                </span>
                <span className="status">{app.status}</span>
              </button>
            ))}
          </section>

          <Detail app={selected} mode={mode} onPackageGenerated={addGeneratedPackage} />
        </div>
      </section>
      )}
    </main>
  );
}

function actionFor(app, packagedNumbers) {
  if (!app) return "Review";
  if (app.status === "Applied") return "Follow up";
  if (packagedNumbers.has(app.number) || app.isPackaged) return "Apply review";
  if ((app.score || 0) >= 4) return "Package";
  if ((app.score || 0) >= 3.6) return "Second pass";
  return "Archive";
}

function fitLabel(score) {
  if (score >= 4.5) return "Prime";
  if (score >= 4) return "Strong";
  if (score >= 3.6) return "Maybe";
  return "Weak";
}

function BriefWorkspace({ data, setSection }) {
  const packagedNumbers = useMemo(() => new Set((data.packages || []).map((pkg) => pkg.number).filter(Boolean)), [data.packages]);
  const applications = data.applications || [];
  const readyPackages = (data.packages || []).filter((pkg) => pkg.status !== "Applied");
  const focusQueue = useMemo(() => {
    return applications
      .filter((app) => app.status !== "Applied" && app.status !== "SKIP" && app.status !== "Discarded")
      .sort((a, b) => {
        const actionRank = { Package: 0, "Apply review": 1, "Second pass": 2, Archive: 3, Review: 4 };
        return (actionRank[actionFor(a, packagedNumbers)] ?? 9) - (actionRank[actionFor(b, packagedNumbers)] ?? 9) || b.score - a.score;
      })
      .slice(0, 6);
  }, [applications, packagedNumbers]);
  const sourceRows = [...(data.sources?.tracked || []), ...(data.sources?.searches || [])];
  const parsedSources = sourceRows.filter((source) => /ashby|greenhouse|lever|thehub|platsbanken/i.test(`${source.provider} ${source.url}`)).length;
  const searchSources = sourceRows.filter((source) => source.type === "search" || /search/i.test(source.provider || "")).length;
  const manualSources = Math.max(0, sourceRows.length - parsedSources - searchSources);
  const strongUnpackaged = applications.filter((app) => (app.score || 0) >= 4 && !packagedNumbers.has(app.number)).length;
  const applied = applications.filter((app) => app.status === "Applied").length;
  const conversion = applications.length ? Math.round((applied / applications.length) * 100) : 0;

  return (
    <section className="workspace briefWorkspace">
      <header className="briefHero">
        <div>
          <p className="kicker">Hunt brief</p>
          <h1>Uri job engine</h1>
        </div>
        <div className="briefCallout">
          <span>Next best move</span>
          <strong>{readyPackages.length ? "Review package and apply" : strongUnpackaged ? "Generate application package" : "Evaluate discovered leads"}</strong>
        </div>
      </header>

      <section className="briefMetrics" aria-label="Hunt metrics">
        <Metric icon={<Target />} label="Strong roles" value={applications.filter((app) => (app.score || 0) >= 4).length} />
        <Metric icon={<FileText />} label="Ready packages" value={readyPackages.length} />
        <Metric icon={<LayoutList />} label="Scanner-backed" value={data.sources?.scannableEnabled || data.sources?.enabled || 0} />
        <Metric icon={<CheckCircle2 />} label="Applied rate" value={`${conversion}%`} />
      </section>

      <div className="briefGrid">
        <section className="briefPanel focusPanel">
          <div className="panelHead">
            <div>
              <p className="kicker">Priority queue</p>
              <h2>Best moves</h2>
            </div>
            <button onClick={() => setSection("pipeline")}>Open pipeline</button>
          </div>
          <div className="focusTable">
            {focusQueue.map((app, index) => (
              <div key={app.number} className="focusRow">
                <span className="rank">{index + 1}</span>
                <div>
                  <strong>{app.company}</strong>
                  <span>{app.role}</span>
                </div>
                <span className={`fit ${scoreTone(app.score)}`}>{fitLabel(app.score)}</span>
                <span className="queueAction">{actionFor(app, packagedNumbers)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="briefPanel">
          <div className="panelHead">
            <div>
              <p className="kicker">Source quality</p>
              <h2>Coverage</h2>
            </div>
            <button onClick={() => setSection("sources")}>Open sources</button>
          </div>
          <div className="coverageBars">
            <CoverageBar label="Parsed sources" value={parsedSources} total={sourceRows.length} />
            <CoverageBar label="Search-led sources" value={searchSources} total={sourceRows.length} />
            <CoverageBar label="Manual watchlist" value={manualSources} total={sourceRows.length} />
            <CoverageBar label="Real discovered leads" value={data.summary?.discoveredTotal || 0} total={Math.max(1, data.summary?.rawLeadTotal || 1)} />
          </div>
        </section>

        <section className="briefPanel">
          <div className="panelHead">
            <div>
              <p className="kicker">Application room</p>
              <h2>Ready now</h2>
            </div>
            <button onClick={() => setSection("packages")}>Open packages</button>
          </div>
          <div className="readyList">
            {readyPackages.slice(0, 4).map((pkg) => (
              <div key={pkg.id} className="readyRow">
                <span className={`score ${scoreTone(pkg.score)}`}>{Number(pkg.score || 0).toFixed(1)}</span>
                <div>
                  <strong>{pkg.company}</strong>
                  <span>{pkg.role}</span>
                </div>
              </div>
            ))}
            {readyPackages.length === 0 && <div className="emptyInline">No packages waiting.</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

function CoverageBar({ label, value, total }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="coverageBar">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="barTrack">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function daysSince(dateString) {
  if (!dateString) return null;
  const start = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / 86_400_000));
}

function nextFollowUp(appliedDate) {
  const days = daysSince(appliedDate);
  if (days == null) return "Set after apply";
  if (days < 7) return `${7 - days} days`;
  if (days === 7) return "Today";
  return "Overdue";
}

function SourcesWorkspace({ data, onDataReload }) {
  const [refreshState, setRefreshState] = useState({ status: "idle", message: "" });
  const [evaluateState, setEvaluateState] = useState({ status: "idle", message: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "manual", url: "", query: "" });
  const [addState, setAddState] = useState("idle");
  const sources = [...(data.sources?.tracked || []), ...(data.sources?.searches || [])];

  async function refreshSources() {
    setRefreshState({ status: "loading", message: "Scanning sources..." });
    try {
      const response = await fetch("/api/refresh-sources", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Scan failed");
      await onDataReload?.();
      const added = result.stdout?.match(/Added\s+(\d+)/i)?.[1];
      setRefreshState({
        status: "done",
        message: added ? `Refresh complete. Added ${added} new jobs.` : "Refresh complete. Known jobs were skipped.",
      });
    } catch (error) {
      setRefreshState({ status: "error", message: error.message });
    }
  }

  async function addSource(event) {
    event.preventDefault();
    setAddState("saving");
    try {
      const response = await fetch("/api/add-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add source");
      setForm({ name: "", provider: "manual", url: "", query: "" });
      setShowAdd(false);
      setAddState("saved");
      await onDataReload?.();
    } catch (error) {
      setAddState(`error: ${error.message}`);
    }
  }

  async function evaluateDiscoveredJobs() {
    setEvaluateState({ status: "loading", message: "Evaluating discovered jobs..." });
    try {
      const response = await fetch("/api/evaluate-discovered", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Evaluation failed");
      await onDataReload?.();
      let created = "";
      try {
        const parsed = JSON.parse(result.stdout.match(/\{[\s\S]*\}/)?.[0] || "{}");
        created = String(parsed.created ?? "");
      } catch {}
      setEvaluateState({
        status: "done",
        message: created ? `Evaluation complete. Created ${created} new evaluated jobs.` : "Evaluation complete.",
      });
    } catch (error) {
      setEvaluateState({ status: "error", message: error.message });
    }
  }

  return (
    <section className="workspace">
      <header className="topbar">
        <div>
          <p className="kicker">Discovery control</p>
          <h1>Sources</h1>
        </div>
        <div className="actions topActions">
          <button onClick={() => setShowAdd((value) => !value)}>
            Add source <Plus size={16} />
          </button>
          <button onClick={refreshSources} disabled={refreshState.status === "loading"}>
            {refreshState.status === "loading" ? "Refreshing..." : "Refresh jobs"} <RefreshCw size={16} />
          </button>
          <button onClick={evaluateDiscoveredJobs} disabled={evaluateState.status === "loading" || (data.summary.discoveredTotal || 0) === 0}>
            {evaluateState.status === "loading" ? "Evaluating..." : "Evaluate discovered"} <CheckCircle2 size={16} />
          </button>
        </div>
      </header>

      <section className="metrics" aria-label="Source metrics">
        <Metric icon={<RefreshCw />} label="Scanner-backed" value={data.sources?.scannableEnabled || 0} />
        <Metric icon={<LayoutList />} label="Raw leads" value={data.sources?.scanHistoryRows || 0} />
        <Metric icon={<BriefcaseBusiness />} label="Pipeline" value={data.summary.pipelineTotal || 0} />
        <Metric icon={<Archive />} label="Scan log" value={data.sources?.scanHistoryRows || 0} />
      </section>

      {refreshState.message && (
        <div className={`scanNotice ${refreshState.status}`}>
          {refreshState.message}
        </div>
      )}

      {evaluateState.message && (
        <div className={`scanNotice ${evaluateState.status}`}>
          {evaluateState.message}
        </div>
      )}

      {showAdd && (
        <form className="sourceForm" onSubmit={addSource}>
          <label>
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Job board or search name" />
          </label>
          <label>
            <span>Type</span>
            <select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
              <option value="manual">Manual URL/listing</option>
              <option value="thehub">The Hub</option>
              <option value="platsbanken">Platsbanken</option>
              <option value="linkedin">LinkedIn/search</option>
              <option value="search">Search query</option>
            </select>
          </label>
          <label className="wide">
            <span>{form.provider === "search" ? "Search query" : "URL"}</span>
            <input
              value={form.provider === "search" ? form.query : form.url}
              onChange={(event) =>
                form.provider === "search"
                  ? setForm({ ...form, query: event.target.value })
                  : setForm({ ...form, url: event.target.value })
              }
              placeholder={form.provider === "search" ? 'site:example.com "Project Manager" Copenhagen' : "https://..."}
            />
          </label>
          <button type="submit" disabled={addState === "saving"}>
            {addState === "saving" ? "Adding..." : "Save source"}
          </button>
          {String(addState).startsWith("error") && <span className="formError">{addState}</span>}
        </form>
      )}

      <div className="sourceGrid">
        {sources.map((source, index) => {
          const stats = data.sources?.bySource?.[source.name] || {};
          return (
            <div key={`${source.type}-${source.name}-${index}`} className="sourceRow">
              <div>
                <strong>{source.name}</strong>
                <span>{source.provider} · {source.type}</span>
              </div>
              <div className="sourceMeta">
                <span className={source.enabled ? "live" : "paused"}>{source.enabled ? "Enabled" : "Paused"}</span>
                <span>{stats.added || 0} added</span>
              </div>
              <p>{source.query || source.url || (source.queries?.length ? source.queries.join(", ") : "Configured source")}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PackageWorkspace({ data, onApplied }) {
  const [query, setQuery] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState(data.packages[0]?.id || "");
  const [selectedFile, setSelectedFile] = useState("tailored-cv.md");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [applyState, setApplyState] = useState("idle");
  const [assistantState, setAssistantState] = useState({ status: "idle", message: "" });

  const readyPackages = useMemo(() => data.packages.filter((pkg) => pkg.status !== "Applied"), [data.packages]);

  const packages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return readyPackages.filter((pkg) => {
      if (!needle) return true;
      return [pkg.company, pkg.role, pkg.title, pkg.number].join(" ").toLowerCase().includes(needle);
    });
  }, [readyPackages, query]);

  const selectedPackage = packages.find((pkg) => pkg.id === selectedPackageId) || packages[0] || data.packages[0];
  const files = selectedPackage?.files || [];
  const activeFile = files.find((file) => file.name === selectedFile) || files[0];
  const dirty = content !== original;

  useEffect(() => {
    if (!selectedPackage && data.packages[0]) {
      setSelectedPackageId(data.packages[0].id);
    }
  }, [data.packages, selectedPackage]);

  useEffect(() => {
    if (!selectedPackage) return;
    if (!selectedPackage.files.some((file) => file.name === selectedFile)) {
      setSelectedFile(selectedPackage.files[0]?.name || "");
    }
  }, [selectedPackage, selectedFile]);

  useEffect(() => {
    if (!activeFile) {
      setContent("");
      setOriginal("");
      return;
    }
    setSaveState("idle");
    fetch(`${activeFile.href}?t=${Date.now()}`)
      .then((res) => res.text())
      .then((text) => {
        if (text.trim() === "[object Object]") {
          setSaveState("error: this file contains invalid object text; regenerate the package");
          setContent("");
          setOriginal("");
          return;
        }
        setContent(text);
        setOriginal(text);
      });
  }, [activeFile?.href]);

  async function saveFile() {
    if (!selectedPackage || !activeFile) return;
    if (typeof content !== "string" || content.trim() === "[object Object]") {
      setSaveState("error: refusing to save invalid object text");
      return;
    }
    setSaveState("saving");
    try {
      const response = await fetch("/api/save-package-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: selectedPackage.id, file: activeFile.name, content }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save file");
      setOriginal(content);
      setSaveState("saved");
    } catch (error) {
      setSaveState(`error: ${error.message}`);
    }
  }

  async function markApplied() {
    if (!selectedPackage) return;
    setApplyState("saving");
    try {
      const response = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: selectedPackage.number, status: "Applied" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not mark applied");
      setApplyState("done");
      onApplied?.(result);
    } catch (error) {
      setApplyState(`error: ${error.message}`);
    }
  }

  async function startApply() {
    if (!selectedPackage?.number) return;
    setAssistantState({ status: "loading", message: "Starting Playwright assistant..." });
    try {
      const response = await fetch("/api/start-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: selectedPackage.number }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start apply assistant");
      setAssistantState({
        status: "done",
        message: `${result.message} Review materials here, use the browser to fill, then stop before final submit.`,
      });
    } catch (error) {
      setAssistantState({ status: "error", message: error.message });
    }
  }

  return (
    <section className="workspace">
      <header className="topbar">
        <div>
          <p className="kicker">Generated materials</p>
          <h1>Packages</h1>
        </div>
        <div className="search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search package" />
        </div>
      </header>

      <section className="metrics" aria-label="Package metrics">
        <Metric icon={<FolderOpen />} label="Packages" value={data.summary.packageTotal || data.packages.length || 0} />
        <Metric icon={<FileText />} label="Documents" value={data.packages.reduce((sum, pkg) => sum + pkg.files.length, 0)} />
        <Metric icon={<Sparkles />} label="Ready" value={readyPackages.length} />
        <Metric icon={<CheckCircle2 />} label="Editable" value="Yes" />
      </section>

      <div className="packageGrid">
        <section className="jobList packageList" aria-label="Generated packages">
          {packages.length === 0 ? (
            <div className="emptyInline">No generated packages yet.</div>
          ) : (
            packages.map((pkg) => (
              <button
                key={pkg.id}
                className={`jobRow ${selectedPackage?.id === pkg.id ? "isActive" : ""}`}
                onClick={() => {
                  setSelectedPackageId(pkg.id);
                  setSelectedFile(pkg.files[0]?.name || "");
                }}
              >
                <span className={`score ${pkg.score ? scoreTone(pkg.score) : "unscored"}`}>{pkg.score ? pkg.score.toFixed(1) : "Pkg"}</span>
                <span className="jobText">
                  <strong>{pkg.company}</strong>
                  <span>{pkg.role}</span>
                </span>
                <span className="status">{pkg.files.length} files</span>
              </button>
            ))
          )}
        </section>

        <section className="documentWorkspace">
          {selectedPackage ? (
            <>
              <div className="documentHead">
                <div>
                  <p className="kicker">Application package #{selectedPackage.number}</p>
                  <h2>{selectedPackage.role}</h2>
                  <p>{selectedPackage.company}</p>
                </div>
                <span className={`bigScore ${scoreTone(selectedPackage.score || 0)}`}>
                  {selectedPackage.score ? selectedPackage.score.toFixed(1) : "Pkg"}
                </span>
              </div>

              <div className="docTabs">
                {files.map((file) => (
                  <button
                    key={file.name}
                    className={activeFile?.name === file.name ? "selected" : ""}
                    onClick={() => setSelectedFile(file.name)}
                  >
                    {file.name}
                  </button>
                ))}
              </div>

              <div className="editorToolbar">
                <span>{dirty ? "Unsaved changes" : "Saved"}</span>
                <div className="toolbarButtons">
                  <button onClick={saveFile} disabled={!dirty || saveState === "saving"}>
                    {saveState === "saving" ? "Saving..." : "Save"}
                  </button>
                  <button className="applyButton" onClick={startApply} disabled={dirty || assistantState.status === "loading"}>
                    {assistantState.status === "loading" ? "Starting..." : "Start apply"}
                  </button>
                  <button className="appliedButton" onClick={markApplied} disabled={dirty || applyState === "saving"}>
                    {applyState === "saving" ? "Marking..." : "Mark applied"}
                  </button>
                </div>
              </div>

              {String(saveState).startsWith("error") && <div className="saveError">{saveState}</div>}
              {String(applyState).startsWith("error") && <div className="saveError">{applyState}</div>}
              {assistantState.message && (
                <div className={`applyNotice ${assistantState.status}`}>
                  <strong>{assistantState.status === "error" ? "Assistant failed" : "Apply process started"}</strong>
                  <p>{assistantState.message}</p>
                </div>
              )}

              <div className="editorGrid">
                <label className="editorPane">
                  <span>Edit markdown</span>
                  <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck="true" />
                </label>
                <div className="previewPane">
                  <span>Preview</span>
                  <ReportMarkdown markdown={content} />
                </div>
              </div>
            </>
          ) : (
            <div className="emptyState">
              <strong>No packages yet.</strong>
              <p>Generate a package from an evaluated job, then it will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function TargetsWorkspace({ data, onRevert }) {
  const [query, setQuery] = useState("");
  const [revertState, setRevertState] = useState("idle"); // idle | working | error
  const targets = useMemo(() => {
    const packageByNumber = new Map(data.packages.map((pkg) => [pkg.number, pkg]));
    return data.applications
      .filter((app) => ["Applied", "Responded", "Interview", "Offer"].includes(app.status))
      .map((app) => ({ ...app, package: packageByNumber.get(app.number) }))
      .filter((app) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return true;
        return [app.company, app.role, app.status, app.notes].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => (daysSince(b.appliedDate) ?? -1) - (daysSince(a.appliedDate) ?? -1));
  }, [data.applications, data.packages, query]);
  const [selectedNumber, setSelectedNumber] = useState("");
  const selected = targets.find((target) => target.number === selectedNumber) || targets[0];

  useEffect(() => {
    if (!selectedNumber && targets[0]) setSelectedNumber(targets[0].number);
  }, [targets, selectedNumber]);

  return (
    <section className="workspace">
      <header className="topbar">
        <div>
          <p className="kicker">Applied roles and follow-up</p>
          <h1>Targets</h1>
        </div>
        <div className="search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search target" />
        </div>
      </header>

      <section className="metrics" aria-label="Target metrics">
        <Metric icon={<Target />} label="Active targets" value={targets.length} />
        <Metric icon={<CheckCircle2 />} label="Applied" value={targets.filter((target) => target.status === "Applied").length} />
        <Metric icon={<BriefcaseBusiness />} label="Interviews" value={targets.filter((target) => target.status === "Interview").length} />
        <Metric icon={<Sparkles />} label="Follow-up due" value={targets.filter((target) => nextFollowUp(target.appliedDate) === "Today" || nextFollowUp(target.appliedDate) === "Overdue").length} />
      </section>

      <div className="targetGrid">
        <section className="jobList" aria-label="Applied targets">
          {targets.length === 0 ? (
            <div className="emptyInline">No applied targets yet. Mark a package as applied after submitting it.</div>
          ) : (
            targets.map((target) => (
              <button
                key={target.number}
                className={`jobRow ${selected?.number === target.number ? "isActive" : ""}`}
                onClick={() => setSelectedNumber(target.number)}
              >
                <span className={`score ${scoreTone(target.score)}`}>{target.score.toFixed(1)}</span>
                <span className="jobText">
                  <strong>{target.company}</strong>
                  <span>{target.role}</span>
                </span>
                <span className="status">{target.status}</span>
              </button>
            ))
          )}
        </section>

        <section className="targetDetail">
          {selected ? (
            <>
              <div className="documentHead">
                <div>
                  <p className="kicker">{selected.status}</p>
                  <h2>{selected.role}</h2>
                  <p>{selected.company}</p>
                </div>
                <span className={`bigScore ${scoreTone(selected.score)}`}>{selected.score.toFixed(1)}</span>
              </div>

              <button
                className="revertButton"
                disabled={revertState === "working"}
                onClick={async () => {
                  setRevertState("working");
                  try {
                    await onRevert(selected.number);
                    setRevertState("idle");
                  } catch {
                    setRevertState("error");
                  }
                }}
              >
                {revertState === "working" ? "Reverting..." : "Wrong click? Revert to Evaluated"}
              </button>
              {revertState === "error" ? <p className="revertError">Could not revert -- try again.</p> : null}

              <div className="targetStats">
                <div>
                  <span>Applied</span>
                  <strong>{selected.appliedDate || "Unknown"}</strong>
                </div>
                <div>
                  <span>Days since</span>
                  <strong>{daysSince(selected.appliedDate) ?? "-"}</strong>
                </div>
                <div>
                  <span>Follow-up</span>
                  <strong>{nextFollowUp(selected.appliedDate)}</strong>
                </div>
              </div>

              <div className="actions">
                {selected.url && (
                  <a href={selected.url} target="_blank" rel="noreferrer">
                    Open job <ArrowUpRight size={16} />
                  </a>
                )}
                {selected.package?.files?.map((file) => (
                  <a key={file.name} href={file.href} target="_blank" rel="noreferrer">
                    {file.name}
                  </a>
                ))}
              </div>

              <div className="panel">
                <h3>Next action</h3>
                <p>
                  {nextFollowUp(selected.appliedDate) === "Overdue"
                    ? "Send or draft a follow-up now."
                    : nextFollowUp(selected.appliedDate) === "Today"
                      ? "Follow up today if there has been no response."
                      : `Follow up in ${nextFollowUp(selected.appliedDate)} if there has been no response.`}
                </p>
              </div>

              <div className="panel">
                <h3>Notes</h3>
                <p>{selected.notes || "No notes yet."}</p>
              </div>
            </>
          ) : (
            <div className="emptyState">
              <strong>No applied targets yet.</strong>
              <p>Submit externally, then mark a package as applied.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      <span>{React.cloneElement(icon, { size: 18 })}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function Detail({ app, mode, onPackageGenerated }) {
  const [view, setView] = useState("overview");
  const [packageState, setPackageState] = useState({ status: "idle", result: null, error: "" });
  const [assistantState, setAssistantState] = useState({ status: "idle", message: "" });

  if (!app) {
    return <section className="detail empty">No roles match the current filters.</section>;
  }

  async function generateSelectedPackage() {
    if (!app?.number) return;
    setPackageState({ status: "loading", result: null, error: "" });
    try {
      const response = await fetch("/api/generate-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: app.number }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not generate package");
      setPackageState({ status: "done", result, error: "" });
      onPackageGenerated?.(result, app);
    } catch (error) {
      setPackageState({ status: "error", result: null, error: error.message });
    }
  }

  async function startApply() {
    if (!app?.number) return;
    setAssistantState({ status: "loading", message: "Starting Playwright assistant..." });
    try {
      const response = await fetch("/api/start-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: app.number }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start apply assistant");
      setAssistantState({
        status: "done",
        message: `${result.message} I can help inspect and fill forms, but final Submit/Send/Apply stays with you.`,
      });
    } catch (error) {
      setAssistantState({ status: "error", message: error.message });
    }
  }

  return (
    <section className="detail" aria-label="Selected job details">
      <div className="detailHead">
        <div>
          <p className="kicker">{app.archetype || "Evaluated role"}</p>
          <h2>{app.role}</h2>
          <p>{app.company}</p>
        </div>
        {app.score ? (
          <span className={`bigScore ${scoreTone(app.score)}`}>{app.score.toFixed(1)}</span>
        ) : (
          <span className="bigScore unscored">New</span>
        )}
      </div>

      <div className="actions">
        {app.url && (
          <a href={app.url} target="_blank" rel="noreferrer">
            Open job <ArrowUpRight size={16} />
          </a>
        )}
        {app.reportPath && (
          <a href={`/${app.reportPath}`} target="_blank" rel="noreferrer">
            Open report <FileText size={16} />
          </a>
        )}
        {mode === "evaluated" && (
          <button onClick={generateSelectedPackage} disabled={packageState.status === "loading"}>
            {packageState.status === "loading" ? "Generating..." : "Generate package"} <FolderOpen size={16} />
          </button>
        )}
        {mode === "evaluated" && (
          <button className="applyButton" onClick={startApply} disabled={assistantState.status === "loading"}>
            {assistantState.status === "loading" ? "Starting..." : "Start apply"} <ArrowUpRight size={16} />
          </button>
        )}
      </div>

      {packageState.status === "done" && (
        <div className="packagePanel">
          <strong>Application package generated</strong>
          <div className="packageLinks">
            {packageState.result.files.map((file) => (
              <a key={file.name} href={file.href} target="_blank" rel="noreferrer">
                {file.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {packageState.status === "error" && (
        <div className="packagePanel error">
          <strong>Package generation failed</strong>
          <p>{packageState.error}</p>
        </div>
      )}

      {assistantState.message && (
        <div className={`applyNotice ${assistantState.status}`}>
          <strong>{assistantState.status === "error" ? "Assistant failed" : "Apply process started"}</strong>
          <p>{assistantState.message}</p>
        </div>
      )}

      {mode === "evaluated" && (
        <div className="viewSwitch" role="tablist" aria-label="Report view">
          <button className={view === "overview" ? "selected" : ""} onClick={() => setView("overview")}>
            Overview
          </button>
          <button className={view === "report" ? "selected" : ""} onClick={() => setView("report")}>
            Full report
          </button>
        </div>
      )}

      {mode === "discovered" ? (
        <>
          <div className="note">
            <strong>Not evaluated yet</strong>
            <p>This lead is in the raw inbox. It needs JD extraction and scoring before it becomes an application dashboard record.</p>
          </div>
          <div className="panel">
            <h3>Source</h3>
            <p>{[app.source, app.location].filter(Boolean).join(" - ") || compactUrl(app.url)}</p>
          </div>
          <div className="panel">
            <h3>Next action</h3>
            <p>Open the job, confirm it is still active, then evaluate it into a report if it looks worth applying to.</p>
          </div>
        </>
      ) : view === "overview" ? (
        <>
          <div className="note">
            <strong>Recommended next move</strong>
            <p>{app.notes || "Review the report, then prepare a tailored application package."}</p>
          </div>

          <div className="panel">
            <h3>Why it fits</h3>
            <p>{app.summary || "No report summary found yet."}</p>
          </div>

          <div className="panel">
            <h3>Positioning</h3>
            <p>{app.strategy || "Open the report for the full positioning notes."}</p>
          </div>

          <div className="keywords">
            {(app.keywords || []).map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </>
      ) : (
        <ReportMarkdown markdown={app.markdown} />
      )}

      <footer className="source">
        <span>{compactUrl(app.url)}</span>
        <span>{app.date}</span>
      </footer>
    </section>
  );
}

function ReportMarkdown({ markdown }) {
  const blocks = useMemo(() => parseMarkdown(markdown || ""), [markdown]);

  if (!markdown) {
    return <article className="fullReport empty">No report markdown found.</article>;
  }

  return (
    <article className="fullReport">
      {blocks.map((block, index) => {
        if (block.type === "h1") return <h1 key={index}>{block.text}</h1>;
        if (block.type === "h2") return <h2 key={index}>{block.text}</h2>;
        if (block.type === "h3") return <h3 key={index}>{block.text}</h3>;
        if (block.type === "hr") return <hr key={index} />;
        if (block.type === "meta") {
          return (
            <dl key={index} className="reportMeta">
              {block.items.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{renderInline(item.value)}</dd>
                </div>
              ))}
            </dl>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="reportTableWrap">
              <table className="reportTable">
                <thead>
                  <tr>
                    {block.headers.map((cell) => (
                      <th key={cell}>{renderInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="reportList">
              {block.items.map((item) => (
                <li key={item}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "keywords") {
          return (
            <div key={index} className="reportKeywords">
              {block.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          );
        }
        return (
          <p key={index} className="reportPara">
            {renderInline(block.text)}
          </p>
        );
      })}
    </article>
  );
}

function parseMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }
    if (line === "---") {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: line.replace(/^#\s+/, "") });
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.replace(/^##\s+/, "") });
      i += 1;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.replace(/^###\s+/, "") });
      i += 1;
      continue;
    }
    if (/^\*\*[^*]+:\*\*/.test(line)) {
      const items = [];
      while (i < lines.length && /^\*\*[^*]+:\*\*/.test(lines[i].trim())) {
        const match = lines[i].trim().match(/^\*\*([^*]+):\*\*\s*(.*)$/);
        if (match) items.push({ label: match[1], value: match[2] || "Pending" });
        i += 1;
      }
      blocks.push({ type: "meta", items });
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.trim().startsWith("|---")) {
      const headers = splitMarkdownRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitMarkdownRow(lines[i].trim()));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    if (line.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().replace(/^-\s+/, ""));
        i += 1;
      }
      if (items.length > 5 && blocks.at(-1)?.type === "h2" && /keywords/i.test(blocks.at(-1).text)) {
        blocks.push({ type: "keywords", items });
      } else {
        blocks.push({ type: "list", items });
      }
      continue;
    }

    const paras = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#|---|\||- |\*\*[^*]+:\*\*)/.test(lines[i].trim())
    ) {
      paras.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "p", text: paras.join(" ") });
  }

  return blocks;
}

function splitMarkdownRow(row) {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInline(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g);
  return parts.map((part, index) => {
    if (!part) return null;
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={index} href={part} target="_blank" rel="noreferrer">
          {compactUrl(part)}
        </a>
      );
    }
    return part;
  });
}

createRoot(document.getElementById("root")).render(<App />);
