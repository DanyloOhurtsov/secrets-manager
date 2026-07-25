import type { ApiInfo } from './app.service';

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };

  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function renderApiLandingPage(info: ApiInfo): string {
  const name = escapeHtml(info.name);
  const description = escapeHtml(info.description);
  const version = escapeHtml(info.version);
  const displayVersion =
    info.version === 'development' ? version : `v${version}`;
  const documentation = escapeHtml(info.documentation);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <title>${name}</title>
    <link rel="stylesheet" href="api.css" />
  </head>
  <body>
    <main class="page-shell">
      <nav class="topbar" aria-label="Primary navigation">
        <a class="brand" href="." aria-label="Secrets Manager API home">
          <span class="brand-mark" aria-hidden="true">SM</span>
          <span>${name}</span>
        </a>
        <a class="nav-link" href="${documentation}" target="_blank" rel="noreferrer">
          Documentation <span aria-hidden="true">&nearr;</span>
        </a>
      </nav>

      <section class="hero" aria-labelledby="hero-title">
        <div class="eyebrow"><span class="status-dot" aria-hidden="true"></span> API online</div>
        <h1 id="hero-title">Secrets, delivered<br /><span>without touching disk.</span></h1>
        <p class="hero-copy">${description}</p>
        <div class="actions">
          <a class="button button-primary" href="health">Check API health</a>
          <a class="button button-secondary" href="info">View JSON metadata</a>
        </div>
      </section>

      <section class="api-panel" aria-labelledby="api-title">
        <header class="panel-header">
          <div>
            <p class="section-kicker">Developer entry points</p>
            <h2 id="api-title">API surface</h2>
          </div>
          <span class="version">${displayVersion}</span>
        </header>

        <div class="endpoint-list">
          <a class="endpoint" href="health">
            <span class="method method-get">GET</span>
            <code>/health</code>
            <span class="endpoint-description">Public liveness status</span>
            <span class="arrow" aria-hidden="true">&rarr;</span>
          </a>
          <a class="endpoint" href="info">
            <span class="method method-get">GET</span>
            <code>/info</code>
            <span class="endpoint-description">Machine-readable API metadata</span>
            <span class="arrow" aria-hidden="true">&rarr;</span>
          </a>
          <div class="endpoint">
            <span class="method method-post">POST</span>
            <code>/signup</code>
            <span class="endpoint-description">Create an account and personal workspace</span>
          </div>
          <div class="endpoint">
            <span class="method method-post">POST</span>
            <code>/auth/login</code>
            <span class="endpoint-description">Start an authenticated session</span>
          </div>
          <div class="endpoint">
            <span class="method method-get">GET</span>
            <code>/projects</code>
            <span class="endpoint-description">List accessible projects and environments</span>
          </div>
        </div>
      </section>

      <section class="feature-grid" aria-label="Platform capabilities">
        <article class="feature-card">
          <span class="feature-number">01</span>
          <h3>Encrypted at rest</h3>
          <p>Envelope encryption keeps secret values separate from the keys that protect them.</p>
        </article>
        <article class="feature-card">
          <span class="feature-number">02</span>
          <h3>Scoped access</h3>
          <p>Service accounts receive only the project and environment access they need.</p>
        </article>
        <article class="feature-card">
          <span class="feature-number">03</span>
          <h3>Runtime injection</h3>
          <p>The CLI injects secrets into child processes without creating plaintext env files.</p>
        </article>
      </section>

      <footer>
        <span>Secrets Manager API</span>
        <span>Build ${version}</span>
      </footer>
    </main>
  </body>
</html>`;
}

export const API_LANDING_STYLES = `
:root {
  color-scheme: dark;
  --background: #07090d;
  --surface: rgba(17, 21, 28, 0.76);
  --surface-strong: #121720;
  --line: rgba(255, 255, 255, 0.1);
  --text: #f5f7fb;
  --muted: #9aa4b5;
  --accent: #9dffb0;
  --accent-strong: #5cf07a;
  --accent-ink: #07130a;
  --blue: #8db8ff;
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  background: var(--background);
}

body {
  min-height: 100vh;
  margin: 0;
  color: var(--text);
  background:
    radial-gradient(circle at 78% 8%, rgba(92, 240, 122, 0.13), transparent 28rem),
    radial-gradient(circle at 8% 42%, rgba(74, 120, 255, 0.1), transparent 30rem),
    var(--background);
}

a {
  color: inherit;
  text-decoration: none;
}

.page-shell {
  width: min(1120px, calc(100% - 40px));
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 84px;
  border-bottom: 1px solid var(--line);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(157, 255, 176, 0.3);
  border-radius: 10px;
  color: var(--accent);
  background: rgba(157, 255, 176, 0.08);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.nav-link {
  color: var(--muted);
  font-size: 13px;
  transition: color 160ms ease;
}

.nav-link:hover,
.nav-link:focus-visible {
  color: var(--text);
}

.hero {
  padding: 108px 0 96px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 28px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-strong);
  box-shadow: 0 0 0 5px rgba(92, 240, 122, 0.1), 0 0 20px rgba(92, 240, 122, 0.55);
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  max-width: 880px;
  margin-bottom: 28px;
  font-size: clamp(3rem, 8vw, 6.9rem);
  font-weight: 650;
  line-height: 0.94;
  letter-spacing: -0.065em;
}

h1 span {
  color: #717b8b;
}

.hero-copy {
  max-width: 650px;
  margin-bottom: 36px;
  color: var(--muted);
  font-size: clamp(1rem, 2vw, 1.18rem);
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.button {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  border: 1px solid transparent;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.button:hover,
.button:focus-visible {
  transform: translateY(-2px);
}

.button-primary {
  color: var(--accent-ink);
  background: var(--accent);
}

.button-primary:hover,
.button-primary:focus-visible {
  background: #c2ffce;
}

.button-secondary {
  border-color: var(--line);
  background: rgba(255, 255, 255, 0.035);
}

.button-secondary:hover,
.button-secondary:focus-visible {
  border-color: rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.065);
}

.api-panel {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(20px);
}

.panel-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 30px 32px;
  border-bottom: 1px solid var(--line);
}

.section-kicker {
  margin-bottom: 9px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

h2 {
  margin-bottom: 0;
  font-size: 28px;
  letter-spacing: -0.035em;
}

.version {
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.035);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.endpoint {
  display: grid;
  min-height: 70px;
  grid-template-columns: 58px minmax(150px, 0.85fr) minmax(220px, 1.4fr) 20px;
  gap: 18px;
  align-items: center;
  padding: 0 32px;
  border-bottom: 1px solid var(--line);
  transition: background 160ms ease;
}

.endpoint:last-child {
  border-bottom: 0;
}

a.endpoint:hover,
a.endpoint:focus-visible {
  background: rgba(255, 255, 255, 0.035);
}

.method {
  width: fit-content;
  padding: 5px 7px;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.method-get {
  color: var(--accent);
  background: rgba(92, 240, 122, 0.1);
}

.method-post {
  color: var(--blue);
  background: rgba(95, 149, 255, 0.12);
}

code {
  color: #e5e9f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}

.endpoint-description {
  color: var(--muted);
  font-size: 13px;
}

.arrow {
  color: var(--muted);
  font-size: 16px;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding: 64px 0;
}

.feature-card {
  min-height: 220px;
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.025);
}

.feature-number {
  display: block;
  margin-bottom: 58px;
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

h3 {
  margin-bottom: 10px;
  font-size: 17px;
  letter-spacing: -0.02em;
}

.feature-card p {
  margin-bottom: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
}

footer {
  display: flex;
  justify-content: space-between;
  padding: 26px 0 38px;
  border-top: 1px solid var(--line);
  color: #6f7887;
  font-size: 11px;
}

@media (max-width: 760px) {
  .page-shell {
    width: min(100% - 28px, 1120px);
  }

  .hero {
    padding: 76px 0 70px;
  }

  h1 {
    font-size: clamp(3rem, 15vw, 5.2rem);
  }

  .panel-header {
    padding: 24px 20px;
  }

  .endpoint {
    min-height: 84px;
    grid-template-columns: 54px 1fr 18px;
    gap: 10px;
    padding: 0 20px;
  }

  .endpoint-description {
    display: none;
  }

  .feature-grid {
    grid-template-columns: 1fr;
  }

  .feature-card {
    min-height: 180px;
  }

  .feature-number {
    margin-bottom: 36px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition: none !important;
  }
}
`;
