import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Compile the actual helpers, server pages, and login route in memory. Only
// session creation and Next's throwing redirect are replaced; HTTP responses
// use the installed NextResponse implementation. No server or network needed.
const require = createRequire(import.meta.url);
const dataModule = (source) => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const asModule = async (path, replacements = {}) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  for (const [specifier, url] of Object.entries(replacements)) {
    js = js.replaceAll('"' + specifier + '"', JSON.stringify(url));
  }
  return dataModule(js);
};

const domains = await asModule("../lib/mail-domains.ts");
const navigation = await asModule("../lib/navigation.ts", { "./mail-domains": domains });
const { notificationDestination, safeMailReturn, loginDestination } = await import(navigation);
const authModule = dataModule(`
  export const state = { authenticated: false, authenticationError: false, sessionError: false };
  export const SESSION_COOKIE = "vmail_session";
  export async function isAuthenticated() {
    if (state.authenticationError) throw new Error("test session configuration error");
    return state.authenticated;
  }
  export function makeSession() {
    if (state.sessionError) throw new Error("test missing session secret");
    return "test-session-value";
  }
`);
const { state } = await import(authModule);
const nextNavigation = dataModule(`
  export function redirect(destination) {
    const error = new Error("test redirect");
    error.destination = destination;
    throw error;
  }
`);
const pageReplacements = {
  "@/lib/navigation": navigation,
  "@/lib/auth": authModule,
  "next/navigation": nextNavigation,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
};
const { default: Home } = await import(await asModule("../app/page.tsx", {
  ...pageReplacements,
  "./mail-client": dataModule("export default function MailClient() { return null; }"),
}));
const { default: Login } = await import(await asModule("../app/login/page.tsx", pageReplacements));
const { POST } = await import(await asModule("../app/api/auth/login/route.ts", {
  "@/lib/navigation": navigation,
  "@/lib/auth": authModule,
  "next/server": pathToFileURL(require.resolve("next/server")).href,
}));

const origin = "https://mail.vyncuslim.com";
const personalId = "56761188-7520-42d8-8898-ff6fc54ce618";
const companyId = "vynalth:" + personalId;
const personalDestination = "/?notification=" + personalId;
const companyDestination = "/?notification=vynalth%3A" + personalId;
const password = "test-only-navigation-password";
const previousPassword = process.env.MAIL_APP_PASSWORD;
let count = 0;

async function test(name, fn) {
  state.authenticated = false;
  state.authenticationError = false;
  state.sessionError = false;
  process.env.MAIL_APP_PASSWORD = password;
  await fn();
  count++;
  console.log("PASS " + name);
}

function walk(element) {
  if (Array.isArray(element)) return element.flatMap(walk);
  if (!element || typeof element !== "object") return [];
  return [element, ...walk(element.props?.children)];
}

function formRequest(entries) {
  return new Request(origin + "/api/auth/login", {
    method: "POST",
    body: new URLSearchParams(entries),
  });
}

function assertDestination(response, expected) {
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, origin);
  assert.equal(location.pathname + location.search + location.hash, expected);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return location;
}

try {
  await test("personal and enterprise message IDs round-trip through login", () => {
    for (const [id, destination] of [[personalId, personalDestination], [companyId, companyDestination]]) {
      assert.equal(notificationDestination(id), destination);
      assert.equal(safeMailReturn(destination), destination);
      const login = new URL(loginDestination(destination), origin);
      assert.equal(login.pathname, "/login");
      assert.equal(login.searchParams.get("next"), destination);
      assert.equal(safeMailReturn(login.searchParams.get("next")), destination);
    }
  });

  await test("missing and non-string message values cannot become destinations", () => {
    for (const value of [undefined, null, false, 42, {}, [], [personalId], [personalId, companyId]]) {
      assert.equal(notificationDestination(value), "/");
      assert.equal(safeMailReturn(value), "/");
    }
  });

  await test("notification IDs reject paths, control characters and unsupported account prefixes", () => {
    for (const value of [
      "", ".", "..", "../private", "/private", "a/b", "a\\b", "a?next=x", "a#fragment",
      "a\rb", "a\nb", "a\tb", "a\u0000b", "a b", "vynalth:", "vynalth:vynalth:abc",
      "personal:abc", "https://attacker.invalid", "//attacker.invalid", "abc%2fdef",
    ]) assert.equal(notificationDestination(value), "/", JSON.stringify(value));
  });

  await test("message ID size bounds and overlong next values fail closed", () => {
    assert.notEqual(notificationDestination("a".repeat(160)), "/");
    assert.equal(notificationDestination("a".repeat(161)), "/");
    assert.equal(safeMailReturn("/?notification=" + "a".repeat(161)), "/");
    assert.equal(safeMailReturn("/?notification=" + "%61".repeat(201)), "/");
  });

  await test("arbitrary next URLs and encoded redirect attacks are rejected", () => {
    for (const value of [
      "https://attacker.invalid", "http://attacker.invalid", "//attacker.invalid", "///attacker.invalid",
      "/\\attacker.invalid", "\\\\attacker.invalid", "/login", "/private", "javascript:alert(1)",
      "data:text/html,redirect", "https://mail.vyncuslim.com/?notification=" + personalId,
      "/?notification=%2F%2Fattacker.invalid", "/?notification=%252F%252Fattacker.invalid",
      "/?notification=a%0d%0aLocation%3Ahttps%3A%2F%2Fattacker.invalid", "/?notification=a%00b",
      "/?notification=a\r\nLocation: https://attacker.invalid", "/?notification=a\\b",
      "/?notification=a#fragment", "/?next=https://attacker.invalid", "/?", " /?notification=a",
    ]) assert.equal(safeMailReturn(value), "/", JSON.stringify(value));
  });

  await test("duplicate query keys and additional parameters are rejected", () => {
    for (const value of [
      "/?notification=a&notification=b", "/?notification=a&%6eotification=b",
      "/?notification=a&next=//attacker.invalid", "/?notification=a&extra=", "/?notification=a&=b",
    ]) assert.equal(safeMailReturn(value), "/");
    assert.equal(safeMailReturn("/?notification=vynalth%3a" + personalId), companyDestination);
  });

  await test("login errors preserve only a sanitized mail destination", () => {
    const result = new URL(loginDestination(companyDestination, "incorrect"), origin);
    assert.equal(result.searchParams.get("error"), "incorrect");
    assert.equal(result.searchParams.get("next"), companyDestination);
    const unsafe = new URL(loginDestination("https://attacker.invalid", "incorrect"), origin);
    assert.equal(unsafe.pathname, "/login");
    assert.equal(unsafe.searchParams.has("next"), false);
    assert.equal(loginDestination("/"), "/login");
  });

  await test("unauthenticated Home carries personal and company notifications into login", async () => {
    for (const [id, destination] of [[personalId, personalDestination], [companyId, companyDestination]]) {
      await assert.rejects(Home({ searchParams: Promise.resolve({ notification: id }) }),
        (error) => error.destination === loginDestination(destination));
    }
  });

  await test("Home rejects repeated notification parameters rather than selecting one", async () => {
    await assert.rejects(Home({ searchParams: Promise.resolve({ notification: [personalId, companyId] }) }),
      (error) => error.destination === "/login");
  });

  await test("authenticated Home renders the mailbox without a login loop", async () => {
    state.authenticated = true;
    const page = await Home({ searchParams: Promise.resolve({ notification: companyId }) });
    assert.equal(typeof page.type, "function");
  });

  await test("Login form retains sanitized next as one hidden input", async () => {
    const page = await Login({ searchParams: Promise.resolve({ next: companyDestination, error: "incorrect" }) });
    const inputs = walk(page).filter((element) => element.type === "input" && element.props.name === "next");
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].props.type, "hidden");
    assert.equal(inputs[0].props.value, companyDestination);
    assert.ok(walk(page).some((element) => element.props?.children === "Incorrect password."));
  });

  await test("Login form rejects array next parameters and remains usable on session errors", async () => {
    state.authenticationError = true;
    const page = await Login({ searchParams: Promise.resolve({ next: [companyDestination, "//attacker.invalid"] }) });
    const input = walk(page).find((element) => element.type === "input" && element.props.name === "next");
    assert.equal(input.props.value, "/");
  });

  await test("authenticated Login redirects to only the safe notification route", async () => {
    state.authenticated = true;
    for (const [next, expected] of [[companyDestination, companyDestination], ["//attacker.invalid", "/"]]) {
      await assert.rejects(Login({ searchParams: Promise.resolve({ next }) }),
        (error) => error.destination === expected);
    }
  });

  await test("successful form login returns to both mailbox identities with protected session cookie", async () => {
    for (const next of [personalDestination, companyDestination]) {
      const response = await POST(formRequest({ password, next }));
      assertDestination(response, next);
      const cookie = response.headers.get("set-cookie");
      assert.match(cookie, /vmail_session=test-session-value/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /Secure/i);
      assert.match(cookie, /SameSite=lax/i);
    }
  });

  await test("incorrect form password keeps the notification through another login attempt", async () => {
    const response = await POST(formRequest({ password: "incorrect-test-password", next: companyDestination }));
    const location = assertDestination(response, loginDestination(companyDestination, "incorrect"));
    assert.equal(location.searchParams.get("next"), companyDestination);
    assert.equal(response.headers.has("set-cookie"), false);
    const retry = await POST(formRequest({ password, next: location.searchParams.get("next") }));
    assertDestination(retry, companyDestination);
  });

  await test("configuration and session errors also keep the safe destination", async () => {
    delete process.env.MAIL_APP_PASSWORD;
    let response = await POST(formRequest({ password, next: personalDestination }));
    assertDestination(response, loginDestination(personalDestination, "config"));
    assert.equal(response.headers.has("set-cookie"), false);
    process.env.MAIL_APP_PASSWORD = password;
    state.sessionError = true;
    response = await POST(formRequest({ password, next: companyDestination }));
    assertDestination(response, loginDestination(companyDestination, "session"));
    assert.equal(response.headers.has("set-cookie"), false);
  });

  await test("tampered hidden next cannot redirect a successful or failed login off site", async () => {
    for (const next of ["//attacker.invalid", "https://attacker.invalid", "/?notification=../../private"]) {
      assertDestination(await POST(formRequest({ password, next })), "/");
      assertDestination(await POST(formRequest({ password: "wrong", next })), "/login?error=incorrect");
    }
  });

  await test("duplicate submitted next fields never bypass target sanitization", async () => {
    for (const values of [["//attacker.invalid", companyDestination], [companyDestination, "//attacker.invalid"]]) {
      const response = await POST(formRequest([["password", password], ...values.map((value) => ["next", value])]));
      const location = new URL(response.headers.get("location"));
      assert.equal(location.origin, origin);
      assert.ok(["/", companyDestination].includes(location.pathname + location.search));
    }
  });

  await test("JSON login remains a non-redirecting API even when next is supplied", async () => {
    const response = await POST(new Request(origin + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, next: "https://attacker.invalid" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.has("location"), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
} finally {
  if (previousPassword === undefined) delete process.env.MAIL_APP_PASSWORD;
  else process.env.MAIL_APP_PASSWORD = previousPassword;
}

console.log(count + " navigation regression tests passed");
