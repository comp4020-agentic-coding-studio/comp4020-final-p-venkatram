// Renders README.md at /readme/ — the spec's fixed contract (spec/invariants.test.ts)
// only checks that the README's headings appear on the page, in order, so any
// renderer is fine; this one keeps the page visually consistent with the rest
// of the site (same theme CSS, inlined rather than imported) since markers and
// visitors land here first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

let cachedCss: string | undefined;

function themeCss(repoRoot: string): string {
  if (cachedCss) return cachedCss;
  const theme = readFileSync(join(repoRoot, "src/styles/theme.css"), "utf8");
  const global = readFileSync(join(repoRoot, "src/styles/global.css"), "utf8").replace(
    /@import\s+"\.\/theme\.css";?\n?/,
    "",
  );
  cachedCss = `${theme}\n${global}`;
  return cachedCss;
}

export function renderReadmePage(repoRoot: string): string {
  const markdown = readFileSync(join(repoRoot, "README.md"), "utf8");
  const body = marked.parse(markdown, { async: false });
  const css = themeCss(repoRoot);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>README · WaveForge</title>
<script>
try {
  var saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
} catch (e) {}
</script>
<style>${css}</style>
</head>
<body>
<header class="site-header">
  <a class="brand" href="/">Wave<span class="brand-accent">Forge</span></a>
  <nav class="nav">
    <a href="/rooms/">Rooms</a>
    <button type="button" class="theme-toggle" id="theme-toggle">Switch to dark</button>
  </nav>
</header>
<article class="readme-body">${body}</article>
<script>
(function () {
  function current() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function label(theme) {
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "Switch to light" : "Switch to dark";
  }
  label(current());
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    label(next);
  });
})();
</script>
</body>
</html>`;
}
