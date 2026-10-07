// Theme toggle: the inline snippet in Layout.astro's <head> applies any saved
// choice before first paint (avoids a flash of the wrong theme); this module
// just wires up the toggle button and keeps its label in sync.
type Theme = "dark" | "light";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateLabel(theme: Theme): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
    btn.textContent = theme === "dark" ? "Switch to light" : "Switch to dark";
    btn.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // private browsing / blocked storage: the toggle still works for this load
  }
  updateLabel(theme);
}

export function initThemeToggle(): void {
  updateLabel(currentTheme());
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
    btn.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  }
}
