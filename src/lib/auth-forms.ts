// Shared wiring for the signup and login forms: POST JSON, show the server's
// error message inline, redirect to /rooms/ on success. Both pages also
// bounce an already-logged-in visitor straight to /rooms/ rather than showing
// a form they don't need.
import { fetchSession } from "./session";

interface AuthResponse {
  user?: { id: string; displayName: string };
  error?: string;
}

async function postJson(url: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as AuthResponse;
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function wireForm(formId: string, errorId: string, endpoint: string, buildBody: (form: HTMLFormElement) => unknown): void {
  const form = document.getElementById(formId);
  const errorEl = document.getElementById(errorId);
  if (!(form instanceof HTMLFormElement)) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (errorEl) errorEl.textContent = "";
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    postJson(endpoint, buildBody(form))
      .then(() => {
        window.location.href = "/rooms/";
      })
      .catch((err: Error) => {
        if (errorEl) errorEl.textContent = err.message;
        if (submitBtn) submitBtn.disabled = false;
      });
  });
}

export function initSignupForm(): void {
  wireForm("signup-form", "signup-error", "/api/signup", (form) => ({
    email: (form.elements.namedItem("email") as HTMLInputElement).value,
    displayName: (form.elements.namedItem("displayName") as HTMLInputElement).value,
    password: (form.elements.namedItem("password") as HTMLInputElement).value,
  }));
  void redirectIfLoggedIn();
}

export function initLoginForm(): void {
  wireForm("login-form", "login-error", "/api/login", (form) => ({
    email: (form.elements.namedItem("email") as HTMLInputElement).value,
    password: (form.elements.namedItem("password") as HTMLInputElement).value,
  }));
  void redirectIfLoggedIn();
}

async function redirectIfLoggedIn(): Promise<void> {
  const user = await fetchSession();
  if (user) window.location.href = "/rooms/";
}
