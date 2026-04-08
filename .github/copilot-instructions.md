# Copilot Instructions

- To build, test and run this project inside Github Copilot Agent env, packages needs to be installed with `npm install` before running any command. This is required to populate the `node_modules` folder with the necessary dependencies for the project to function correctly.
- This project runs locally with Docker. When you need the app running, use `docker compose up --build` and assume the app is served on `http://localhost:4109`.
- Do not start the app directly with `npm run dev` or `npm run start` unless the user explicitly asks for a non-Docker workflow.
- Keep terminal output bounded to avoid freezing or crashing VS Code.
- Never use streaming pipelines like `curl URL | rg ...`, `curl URL | head ...`, or `wget -qO- URL | ...`.
- For HTTP checks, always write to a temp file first: `curl --fail --silent --show-error --max-time 10 --connect-timeout 3 -o /tmp/page.html URL`.
- Keep content inspection, but do it with bounded, low-output checks only.
- Do **not** use `rg` or `grep` on large local HTML responses in this workspace; prefer a tiny Python snippet that prints only a few booleans, match labels, or a very small slice.
- Preferred local page inspection pattern:
  1. fetch once to `/tmp/page.html`
  2. inspect with a short Python snippet that prints only whether specific markers exist
  3. only if needed, print at most the first 20 lines or one small surrounding slice
- Prefer single-purpose commands over long `&&` chains for network checks to keep failures isolated and output small.
- For local page verification, never combine fetch + inspection + extra dumps in one terminal invocation; fetch first, then do one separate bounded inspection command.
- Run at most one follow-up inspection command per invocation, and stop as soon as the needed marker is confirmed.
- If a marker check already succeeded, stop there and avoid dumping extra HTML unless the markers are missing.
- If content inspection is needed after a fetch, prefer either a tiny Python snippet or the editor/file-reading tools over terminal-heavy text search.
- For headers/health checks, prefer `curl -I --fail --silent --show-error --max-time 10 URL | head -n 20`.
- For long-running logs, prefer bounded views like `docker compose logs --tail=200` and avoid unbounded streaming unless the user asks.
- For any potentially long-running terminal action, use bounded execution (tool timeout and output caps) instead of unbounded commands.
- When finishing a feature or refactor, run a verification command before handing off the work.
- Default verification is `npm run typecheck`.
- Run `npm run build` instead when the change affects production/runtime behavior, Next.js config, routing, PWA/service worker behavior, or deployment-facing code.
- If relevant tests exist for the changed area, run them in addition to the verification step.
- When you're testing or debugging, you should use the existing test flights (TEST1, TEST2 or TEST3). These flights have various data sources and histories that can be useful for testing different scenarios.