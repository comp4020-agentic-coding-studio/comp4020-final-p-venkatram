import { expect, inject, it } from "vitest";

// Random per run so repeated local `pnpm check` runs (against a persistent
// dev DB, unlike CI's throwaway one) never collide on "email already exists".
const baseUrl = inject("baseUrl");
const uniqueEmail = () => `check-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

it("rejects /api/me with no session", async () => {
  const res = await fetch(new URL("/api/me", baseUrl));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: unknown };
  expect(body.user).toBeNull();
});

it("signs up, sees the session on /api/me, then logs out", async () => {
  const email = uniqueEmail();
  const signupRes = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName: "Check User", password: "correct-horse-battery" }),
  });
  expect(signupRes.status).toBe(201);
  const cookie = cookieFrom(signupRes);
  expect(cookie).not.toBe("");

  const meRes = await fetch(new URL("/api/me", baseUrl), { headers: { Cookie: cookie } });
  const me = (await meRes.json()) as { user: { email: string; displayName: string } | null };
  expect(me.user?.email).toBe(email);
  expect(me.user?.displayName).toBe("Check User");

  const logoutRes = await fetch(new URL("/api/logout", baseUrl), { method: "POST", headers: { Cookie: cookie } });
  expect(logoutRes.status).toBe(200);

  const afterLogout = await fetch(new URL("/api/me", baseUrl), { headers: { Cookie: cookie } });
  const afterBody = (await afterLogout.json()) as { user: unknown };
  expect(afterBody.user).toBeNull();
});

it("rejects a duplicate signup email", async () => {
  const email = uniqueEmail();
  const body = JSON.stringify({ email, displayName: "First", password: "correct-horse-battery" });
  const first = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  expect(first.status).toBe(201);

  const second = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName: "Second", password: "another-password" }),
  });
  expect(second.status).toBe(400);
});

it("logs in with the right password and rejects the wrong one", async () => {
  const email = uniqueEmail();
  await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName: "Login Check", password: "correct-horse-battery" }),
  });

  const wrong = await fetch(new URL("/api/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "not-the-password" }),
  });
  expect(wrong.status).toBe(401);

  const right = await fetch(new URL("/api/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery" }),
  });
  expect(right.status).toBe(200);
  expect(cookieFrom(right)).not.toBe("");
});
