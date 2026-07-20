# Mode: pdf — ATS-Optimized PDF Generation

## Full pipeline

1. Read `cv.md` as the source of truth
2. Ask the user for the JD if it is not in context (text or URL)
3. Extract 15-20 keywords from the JD
4. Detect JD language → CV language (EN default)
5. Detect company location → paper format:
   - US/Canada → `letter`
   - Rest of the world → `a4`
6. Detect role archetype → adapt framing. **If the user has multiple distinct experience tracks in `cv.md`** (e.g. more than one `## Experience —` section), pick the track that matches the detected archetype as the lead: give it full bullets and keep it first; compress the non-matching track(s) to 1-2 line summaries (title, company, one outcome) rather than dropping them — this keeps the resume focused without erasing real experience. Read `modes/_profile.md` for the archetype → track mapping if one exists there.
7. Rewrite Professional Summary by injecting JD keywords + exit narrative bridge ("Built and sold a business. Now applying systems thinking to [JD domain].") — see **Anti-Generic Rules** below.
8. Select top 3-4 most relevant projects for the job
9. Reorder experience bullets by JD relevance
10. Build competency grid from JD requirements (6-8 keyword phrases)
11. Inject keywords naturally into existing achievements (NEVER invent)
12. Write `{{KICKER}}`: a short uppercase line above the name naming the detected archetype/role family (e.g. "Creative Director — Brand, Film & Content" or "AI Platform / LLMOps Engineer"). Changes per application — this is a tailoring signal, not decoration.
13. Generate full HTML from template + personalized content
14. Read `name` from `config/profile.yml` → normalize to kebab-case lowercase (e.g. "John Doe" → "john-doe") → `{candidate}`
15. Write HTML to `/tmp/cv-{candidate}-{company}.html`
16. Execute: `node generate-pdf.mjs /tmp/cv-{candidate}-{company}.html output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`
17. Report: PDF path, number of pages, keyword coverage %
18. **Generate the matching cover letter** — see "Cover Letter Generation" below. Skip only if the user explicitly declines one for this application.

## Anti-Generic Rules (tailoring quality gate)

These exist because a resume that reads the same across applications loses to one that reads like it was written for this job by someone who read the JD closely.

- **The Summary's first sentence must contain something that could only come from this JD** — the company's product/category, a named team, a specific outcome they're hiring for. Never open with a bare role title + years of experience; that sentence is reusable across any employer, which is the tell.
- **Never reuse a Summary verbatim across two different companies.** If tempted to copy the last one, that's a signal the JD wasn't actually used — reread it and find the specific angle.
- **Map JD requirements to proof points 1:1, not thematically.** If the JD lists 4 concrete asks, the tailored bullets/summary should visibly answer at least 3 of them with named specifics (metric, tool, project) — not a general "strong background in X" gesture at the theme.
- **Vary structure, not just nouns.** Swapping "Company A" for "Company B" in an otherwise identical paragraph is not tailoring. Reorder which proof point leads based on what the JD emphasizes first.

## Cover Letter Generation

Per `_shared.md` rule: always produce a cover letter alongside the CV, matching visual design, 1 page max.

1. Use `templates/cover-letter-template.html` (same font/color system as the CV template — do not invent a different look).
2. Structure: opening paragraph (`.lede`, italic) makes ONE specific claim connecting the candidate to something real in the JD or company — not "I am excited to apply." Middle 1-2 paragraphs map the JD's top requirements to specific, named proof points from `cv.md`/`article-digest.md` (numbers, projects, outcomes — never generic claims). Closing paragraph is a short, concrete ask (conversation, portfolio review), not a restatement of the opening.
3. Apply the **Anti-Generic Rules** above to the opening line specifically — it must not be reusable for a different company by swapping the name.
4. Apply `## Writing Style` from `_profile.md` if present (see `_shared.md` Writing Style Calibration).
5. Fill placeholders: `{{KICKER}}` (same as CV), `{{DATE}}` (today, long form), `{{HIRING_CONTACT}}` (named contact + line break if known from JD/research, else `"Hiring Team,<br>"`), `{{COMPANY}}`, `{{ROLE_TITLE}}` (`"Re: {role}"`), `{{SALUTATION}}`, `{{BODY_PARAGRAPHS}}` (HTML `<p>` tags; first one gets `class="lede"`), `{{CLOSING_LINE}}`, `{{SIGNOFF_TITLE}}` (candidate's current title/archetype framing from profile).
6. Write HTML to `/tmp/cover-letter-{candidate}-{company}.html`, then: `node generate-pdf.mjs /tmp/cover-letter-{candidate}-{company}.html output/cover-letter-{candidate}-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}` (same format rule as the CV).
7. Report the path alongside the CV path.

## ATS Rules (clean parsing)

- Single-column layout (no sidebars, no parallel columns)
- Standard headers: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- No text in images/SVGs
- No critical info in PDF headers/footers (ATS ignores them)
- UTF-8, selectable text (not rasterized)
- No nested tables
- Distributed JD keywords: Summary (top 5), first bullet of each role, Skills section

## PDF Design

Deliberately avoids the common AI-generated-resume tells: no Space Grotesk/DM Sans/Inter/Poppins pairing, no cyan-to-purple gradient bar, no rounded "pill" badge chips. The design reads as an edited, printed document — editorial, not templated.

- **Fonts**: Fraunces (editorial serif — name, italic Summary/cover-letter lede, dates) + Archivo (grotesk — everything else: section titles, job titles/companies, bullets, skills). Fraunces is used sparingly and only at sizes where its character reads well; the bulk of the document is Archivo, kept clean for ATS parsing.
- **Fonts self-hosted**: `fonts/` (`archivo-latin-{400,500,600,700}.woff2`, `fraunces-latin-{400,500,600,700}.woff2`, `fraunces-italic-latin-{400,500}.woff2`)
- **Header**: `{{KICKER}}` (uppercase, tracked-out, wine accent) above the name; name in Fraunces 700 32px; solid 1px ink rule beneath (no gradient); contact row below
- **Section headers**: Archivo 700 11px, uppercase, letter-spacing 0.12em, wine accent `#6E2430`, thin bottom border
- **Body**: Archivo 11px, line-height 1.5; Professional Summary rendered as an italic Fraunces "lede" (12.5px) for an editorial pull-quote feel
- **Company names**: ink black `#211D1A`; job title/role in wine accent `#6E2430`; dates in italic Fraunces `#7A756D`
- **Competencies**: plain text separated by a wine-colored middot — no colored background chips
- **Margins**: 0.6in
- **Background**: pure white
- **Palette**: ink `#211D1A` (text), body gray `#34302B`, muted `#7A756D` (dates/meta), wine accent `#6E2430` (single accent color — no gradients, no secondary hue)

## Section order (optimized "6-second recruiter scan")

1. Header (large name, gradient, contact, portfolio link)
2. Professional Summary (3-4 lines, keyword-dense)
3. Core Competencies (6-8 keyword phrases in flex-grid)
4. Work Experience (reverse chronological)
5. Projects (top 3-4 most relevant)
6. Education & Certifications
7. Skills (languages + technical)

## Keyword injection strategy (ethical, truth-based)

Examples of legitimate reformulation:
- JD says "RAG pipelines" and CV says "LLM workflows with retrieval" → change to "RAG pipeline design and LLM orchestration workflows"
- JD says "MLOps" and CV says "observability, evals, error handling" → change to "MLOps and observability: evals, error handling, cost monitoring"
- JD says "stakeholder management" and CV says "collaborated with team" → change to "stakeholder management across engineering, operations, and business"

**NEVER add skills that the candidate does not have. Only reword real experience using the exact JD vocabulary.**

## Template HTML

Use the template in `cv-template.html`. Replace the `{{...}}` placeholders with personalized content:

| Placeholder | Content |
|-------------|-----------|
| `{{LANG}}` | `en` or `es` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |
| `{{KICKER}}` | Uppercase archetype/role line, tailored per application (e.g. "Creative Director — Brand, Film & Content") — see step 12 above |
| `{{NAME}}` | (from profile.yml) |
| `{{PHONE}}` | (from profile.yml — include with its separator only when `profile.yml` has a non-empty `phone` value; omit both `<span>` and `<span class="separator">` otherwise) |
| `{{EMAIL}}` | (from profile.yml) |
| `{{LINKEDIN_URL}}` | [from profile.yml] |
| `{{LINKEDIN_DISPLAY}}` | [from profile.yml] |
| `{{PORTFOLIO_URL}}` | [from profile.yml] (or /es depending on language) |
| `{{PORTFOLIO_DISPLAY}}` | [from profile.yml] (or /es depending on language) |
| `{{LOCATION}}` | [from profile.yml] |
| `{{SECTION_SUMMARY}}` | Professional Summary |
| `{{SUMMARY_TEXT}}` | Personalized summary with keywords |
| `{{SECTION_COMPETENCIES}}` | Core Competencies |
| `{{COMPETENCIES}}` | `<span class="competency-tag">keyword</span>` × 6-8 |
| `{{SECTION_EXPERIENCE}}` | Work Experience |
| `{{EXPERIENCE}}` | HTML for each job with reordered bullets |
| `{{SECTION_PROJECTS}}` | Projects |
| `{{PROJECTS}}` | HTML for top 3-4 projects |
| `{{SECTION_EDUCATION}}` | Education |
| `{{EDUCATION}}` | Education HTML |
| `{{SECTION_CERTIFICATIONS}}` | Certifications |
| `{{CERTIFICATIONS}}` | Certifications HTML |
| `{{SECTION_SKILLS}}` | Skills |
| `{{SKILLS}}` | Skills HTML |

## Canva CV Generation (optional)

If `config/profile.yml` has `cv.canva_resume_design_id` set, offer the user a choice before generating:
- **"HTML/PDF (fast, ATS-optimized)"** — existing flow above
- **"Canva CV (visual, design-preserving)"** — new flow below

If the user has no `cv.canva_resume_design_id`, skip this prompt and use the HTML/PDF flow.

### Canva workflow

#### Step 1 — Duplicate the base design

a. `export-design` the base design (using `cv.canva_resume_design_id`) as PDF → get download URL
b. `import-design-from-url` using that download URL → creates a new editable design (the duplicate)
c. Note the new `design_id` for the duplicate

#### Step 2 — Read the design structure

a. `get-design-content` on the new design → returns all text elements (richtexts) with their content
b. Map text elements to CV sections by content matching:
   - Look for the candidate's name → header section
   - Look for "Summary" or "Professional Summary" → summary section
   - Look for company names from cv.md → experience sections
   - Look for degree/school names → education section
   - Look for skill keywords → skills section
c. If mapping fails, show the user what was found and ask for guidance

#### Step 3 — Generate tailored content

Same content generation as the HTML flow (Steps 1-11 above):
- Rewrite Professional Summary with JD keywords + exit narrative
- Reorder experience bullets by JD relevance
- Select top competencies from JD requirements
- Inject keywords naturally (NEVER invent)

**IMPORTANT — Character budget rule:** Each replacement text MUST be approximately the same length as the original text it replaces (within ±15% character count). If tailored content is longer, condense it. The Canva design has fixed-size text boxes — longer text causes overlapping with adjacent elements. Count the characters in each original element from Step 2 and enforce this budget when generating replacements.

#### Step 4 — Apply edits

a. `start-editing-transaction` on the duplicate design
b. `perform-editing-operations` with `find_and_replace_text` for each section:
   - Replace summary text with tailored summary
   - Replace each experience bullet with reordered/rewritten bullets
   - Replace competency/skills text with JD-matched terms
   - Replace project descriptions with top relevant projects
c. **Reflow layout after text replacement:**
   After applying all text replacements, the text boxes auto-resize but neighboring elements stay in place. This causes uneven spacing between work experience sections. Fix this:
   1. Read the updated element positions and dimensions from the `perform-editing-operations` response
   2. For each work experience section (top to bottom), calculate where the bullets text box ends: `end_y = top + height`
   3. The next section's header should start at `end_y + consistent_gap` (use the original gap from the template, typically ~30px)
   4. Use `position_element` to move the next section's date, company name, role title, and bullets elements to maintain even spacing
   5. Repeat for all work experience sections
d. **Verify layout before commit:**
   - `get-design-thumbnail` with the transaction_id and page_index=1
   - Visually inspect the thumbnail for: text overlapping, uneven spacing, text cut off, text too small
   - If issues remain, adjust with `position_element`, `resize_element`, or `format_text`
   - Repeat until layout is clean
e. Show the user the final preview and ask for approval
f. `commit-editing-transaction` to save (ONLY after user approval)

#### Step 5 — Export and download PDF

a. `export-design` the duplicate as PDF (format: a4 or letter based on JD location)
b. **IMMEDIATELY** download the PDF using Bash:
   ```bash
   curl -sL -o "output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf" "{download_url}"
   ```
   The export URL is a pre-signed S3 link that expires in ~2 hours. Download it right away.
c. Verify the download:
   ```bash
   file output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf
   ```
   Must show "PDF document". If it shows XML or HTML, the URL expired — re-export and retry.
d. Report: PDF path, file size, Canva design URL (for manual tweaking)

#### Error handling

- If `import-design-from-url` fails → fall back to HTML/PDF pipeline with message
- If text elements can't be mapped → warn user, show what was found, ask for manual mapping
- If `find_and_replace_text` finds no matches → try broader substring matching
- Always provide the Canva design URL so the user can edit manually if auto-edit fails

## Post-generation

Update tracker if the job is already registered: change PDF from ❌ to ✅.
