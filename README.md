# 📘 Studify

Studify is a study planner and concept summarizer. It reads free, open-licensed learning sites and turns them into short, simple notes. It can also build you a study timetable with spaced reviews.

## Features

- **Search open sources:** Wikipedia, Simple English Wikipedia, Wikibooks and arXiv (paper abstracts), all through their public APIs.
- **Import pages by link** from MIT OpenCourseWare, OpenStax, LibreTexts, OpenLearn, Wikiversity and the sites above. Studify checks each site's `robots.txt` first and refuses pages that bots are asked not to read. Pages from any other site are refused too.
- **Lecture-note PDFs:** paste a PDF link, or an MIT OCW resource page that wraps a PDF, and Studify reads it. It finds headings from font sizes, skips the OCW cover page, running headers and page numbers, and builds notes from the text. Formulas in PDFs are just positioned characters and can't be turned back into LaTeX, so pages with figures or formulas are shown as page previews, drawn in your browser with pdf.js. PDFs up to 25 MB are supported, and the first 60 pages are read.
- **Course and book navigation:** importing an MIT OCW course page lists its sub-pages (syllabus, lecture notes and so on), and you can make notes from any of them in one click.
- **Simplified notes** for every page: a one-line summary, key ideas, bullet points per section, key definitions, key terms and flashcards. Every note links back to its source and names its license.
- **Formulas:** maths and science formulas are kept exactly as the source writes them and shown properly, not flattened into text like `a2+b2=c2`. Each one sits on a formula card with the sentence that explains it and the section it came from. Wikipedia and LibreTexts formulas render as LaTeX with KaTeX (bundled with the app, no CDN). OpenStax formulas render as MathML, which is cleaned to an allowlist of maths tags first, so nothing unsafe gets into the page.
- **Diagrams and pictures:** figures from the source appear next to the section they belong to, with their caption and a link to the image's own page and license. Small icons are skipped.
- **Concept map:** every note gets a generated diagram with the topic in the middle, its main parts around it, and key terms from each part.
- **Two ways to write notes:**
  - *Offline (default):* a built-in summarizer picks the most important sentences and rewrites them in plainer words. It needs no API key and costs nothing.
  - *AI (optional):* set `ANTHROPIC_API_KEY` and Claude writes the notes in simple language, including an everyday analogy and an explanation of each key formula and its symbols. It uses only facts from the source page. If the AI call fails, Studify falls back to offline notes.
- **My notes:** save notes in your browser, filter them, and export them as Markdown, copy them or print them.
- **Planner:** enter your topics, start date, exam date and daily minutes. Studify spreads the topics out, schedules reviews 1, 3, 7 and 14 days after you learn each one, and adds a final revision day. It warns you about overloaded days and lets you tick tasks off.

## Run it

You need Node.js 22.13 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000.

To turn on AI notes (optional):

```bash
ANTHROPIC_API_KEY=your-key npm start
```

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/JiveshKaushal/studify)

1. Click the button and sign in to Render. Connect GitHub if Render asks.
2. Render reads `render.yaml` and sets up a free web service called `studify`.
3. `ANTHROPIC_API_KEY` is optional. Leave it empty to use the free offline summarizer.
4. Click **Apply**. The app goes live at `https://studify-xxxx.onrender.com`, and every push to `main` redeploys it.

Optional: in the service's **Environment** settings, add `STUDIFY_CONTACT` with a URL or email. Wikimedia asks API clients to include contact info, and adding it lowers the chance of being rate-limited.

Free Render services go to sleep after 15 minutes without visits, so the first visit after that takes about a minute.

## Tests

```bash
npm test
```

The tests stub every outside website, so they run offline.

## API

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/search` | `?source=wikipedia\|simplewiki\|wikibooks\|arxiv&q=topic` |
| POST | `/api/notes` | `{ source, id }` or `{ source: "url", url }`, plus `detail: brief\|normal\|detailed` and `mode: auto\|offline` |
| POST | `/api/plan` | `{ topics: [], startDate, examDate, minutesPerDay, learnMinutes }` |
| GET | `/api/pdf` | `?url=` a PDF on an allowed site (used for page previews) |
| GET | `/api/sources`, `/api/status` | |

## Project layout

```
server.js          Express server and API routes
src/sources.js     Source adapters, the import allowlist and licenses
src/http.js        fetch with timeout, caching and robots.txt checks
src/extract.js     Turns HTML and wiki text into sections
src/pdf.js         PDF text, headings and figure/formula pages (pdf.js)
src/math.js        Formula extraction, MathML cleaning, LaTeX placeholders
src/summarize.js   Offline summarizer and simplifier, Markdown export
src/ai.js          Optional Claude-written notes
src/planner.js     Spaced-repetition study planner
public/            Frontend (plain HTML, CSS and JS); visuals.js draws formulas and the concept map
test/              node:test tests
```

## Content and licenses

Studify's code is MIT-licensed. Notes are derived from their sources and stay under those sources' licenses (for example, Wikipedia and Wikibooks are CC BY-SA 4.0, MIT OCW is CC BY-NC-SA 4.0 and OpenStax is CC BY 4.0). Every note shows its source link and license, and every picture links to its own license page (Wikimedia Commons images can have licenses different from the article). Keep that attribution when you share notes.
