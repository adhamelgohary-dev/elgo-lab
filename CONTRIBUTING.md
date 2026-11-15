# Contributing to Elgo Lab

Thank you for helping improve **Elgo Lab**! This repository keeps runtime dependencies at zero and enforces strict Content Security Policy rules (`script-src 'self'`).

## Development Principles

1. **Zero external npm dependencies**: Front-end modules, build scripts, and tests run on Node.js >= 22 + browser Web APIs only.
2. **Strict CSP**: Never add inline `<script>` tags, `javascript:` URLs, `eval()`, `new Function()`, or inline HTML event handlers (`onclick="..."`). Attach event listeners with `addEventListener`.
3. **Balanced Quiz Content**:
   - Every course belongs in `content/subjects/<subjectId>.json`.
   - Prefer 4 balanced options (`A`–`D`) per question without distributing >40% to any single letter in a collection.
   - Escape user/question text before inserting into HTML (`textContent` or HTML entity escaping).
4. **Build Before Testing**:
   ```bash
   npm run build
   npm test
   npm run check
   ```

## Adding Content

### Add or Edit a Course Bank
1. Edit or create `content/subjects/<subject-id>.json` following the schema of existing files (with `id`, `name`, `nameAr`, `quizzes`, optional `lectures` with `generatedQuiz`, optional `sheets`).
2. Add optional lecture notes HTML under `content/lecture-pages/<subject-id>/<lecture-id>.html`.
3. Add printable PDFs or video links in `content/library/pdfs.json` and `content/library/videos.json`.
4. Run `npm run build` to compile `public/data/`, `/learn/` pages, and `backend/answer-key.js`.

## Pull Requests

- Keep changes focused and run `npm test` and `npm run check` before opening a PR.
- Do not commit `public/`, `.dev.vars`, `wrangler.toml`, or `.wrangler/` build artifacts.
