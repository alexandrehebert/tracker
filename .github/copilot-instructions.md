# Copilot Instructions

- This project runs locally with Docker. When you need the app running, use `docker compose up --build` and assume the app is served on `http://localhost:4109`.
- Do not start the app directly with `npm run dev` or `npm run start` unless the user explicitly asks for a non-Docker workflow.
- Keep terminal output bounded to avoid freezing VS Code.
- Never use streaming pipelines like `curl URL | rg ...`, `curl URL | head ...`, or `wget -qO- URL | ...`.
- For HTTP checks, always write to a temp file first: `curl --fail --silent --show-error --max-time 10 --connect-timeout 3 -o /tmp/page.html URL`.
- After fetching a page, inspect only bounded slices: `rg -n -m 20 PATTERN /tmp/page.html`, `head -n 50 /tmp/page.html`, or `sed -n '1,50p' /tmp/page.html`.
- Prefer single-purpose commands over long `&&` chains for network checks to keep failures isolated and output small.
- If the response could be large, prefer targeted checks (specific regex patterns) over dumping HTML.
- For headers/health checks, prefer `curl -I --fail --silent --show-error --max-time 10 URL | head -n 20`.
- For long-running logs, prefer bounded views like `docker compose logs --tail=200` and avoid unbounded streaming unless the user asks.
- For any potentially long-running terminal action, use bounded execution (tool timeout and output caps) instead of unbounded commands.
- When finishing a feature or refactor, run a verification command before handing off the work.
- Default verification is `npm run typecheck`.
- Run `npm run build` instead when the change affects production/runtime behavior, Next.js config, routing, PWA/service worker behavior, or deployment-facing code.
- If relevant tests exist for the changed area, run them in addition to the verification step.