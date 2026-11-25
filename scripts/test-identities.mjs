import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const asModule = async (path, replacements = {}) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [specifier, url] of Object.entries(replacements)) {
    js = js.replaceAll('"' + specifier + '"', JSON.stringify(url));
  }
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
};
const domains = await asModule("../lib/mail-domains.ts");
const m = await import(await asModule("../lib/mail-identities.ts", { "./mail-domains": domains }));
const samplePhotoUrl = "https://assets.example.com/profile.webp";
let n = 0;
function test(name, fn) { fn(); n++; console.log("PASS " + name); }

test("known personal and company identities use their own images", () => {
  for (const domain of ["vyncuslim.com", "mail.vyncuslim.com"]) {
    const profile = m.getMailIdentity(`Vyncus <VYNCUS@${domain.toUpperCase()}>`, { personalPhotoUrl: samplePhotoUrl });
    assert.equal(profile.email, `vyncus@${domain}`);
    assert.equal(profile.kind, "personal");
    assert.equal(profile.imageSrc, samplePhotoUrl);
  }
  for (const domain of ["vynalthai.com", "mail.vynalthai.com"]) {
    assert.equal(m.getMailIdentity({ email: `support@${domain}` }).imageSrc, "/brand/vynalth-logo.png");
  }
});

test("personal photo settings accept only HTTPS URLs without credentials or controls", () => {
  assert.equal(m.validatePhotoUrl(samplePhotoUrl), samplePhotoUrl);
  for (const value of [undefined, null, "", "http://assets.example.com/profile.webp", "javascript:alert(1)", "data:image/png;base64,abc", "https://user:password@assets.example.com/profile.webp", "https://assets.example.com/profile.webp\r\nInjected", "/profile.webp"]) {
    assert.equal(m.validatePhotoUrl(value), "");
  }
});

test("an unconfigured or invalid personal photo leaves the identity and text signature intact", () => {
  for (const personalPhotoUrl of [undefined, "http://assets.example.com/profile.webp"]) {
    const identity = m.getMailIdentity("vyncus@vyncuslim.com", { personalPhotoUrl });
    assert.equal(identity.kind, "personal");
    assert.equal(identity.imageSrc, "");
    assert.equal(identity.website, "https://vyncuslim.com");
    const result = m.buildSignedMessage({ from: identity.email, text: "Hello", personalPhotoUrl });
    assert.ok(result.text.includes("Vyncus Lim\nvyncus@vyncuslim.com\nhttps://vyncuslim.com"));
    assert.ok(!result.html.includes("<img"));
    assert.ok(result.html.includes("Vyncus Lim"));
  }
  assert.equal(m.formatBrandedSender("vyncus@vyncuslim.com"), "Vyncus Lim <vyncus@vyncuslim.com>");
});

test("all four legacy domains map to the correct new identity", () => {
  for (const domain of ["sleepsomno.com", "www.sleepsomno.com", "vitashield.sleepsomno.com"]) {
    assert.equal(m.getMailIdentity(`support@${domain}`).email, "support@vynalthai.com");
  }
  assert.equal(m.getMailIdentity("support@mail.sleepsomno.com").email, "support@mail.vynalthai.com");
});

test("unknown domains, suffix lookalikes and injected addresses have no image", () => {
  for (const address of ["p@friends.vyncuslim.com", "p@vynalthai.com.example.net", "p@fakevynalthai.com", "p@vynalthai.com\r\nBcc: victim@example.net", "invalid"]) {
    assert.equal(m.getMailIdentity(address), null);
  }
});

test("lists use the first valid address without borrowing another recipient's brand", () => {
  assert.equal(m.getMailIdentity([{ email: "customer@example.net" }, "support@vynalthai.com"]), null);
  assert.equal(m.getMailIdentity(["bad", { address: "support@mail.vynalthai.com" }]).email, "support@mail.vynalthai.com");
  assert.equal(m.getMailIdentity("vyncus@vyncuslim.com, support@vynalthai.com").kind, "personal");
});

test("sender formatting preserves names, migrates legacy mailboxes and blocks CRLF", () => {
  assert.equal(m.formatBrandedSender("support@vynalthai.com"), "Vynalth AI <support@vynalthai.com>");
  assert.equal(m.formatBrandedSender('"Support Team" <support@vynalthai.com>'), '"Support Team" <support@vynalthai.com>');
  assert.equal(m.formatBrandedSender('"Lim, Vyncus" <vyncus@vyncuslim.com>'), '"Lim, Vyncus" <vyncus@vyncuslim.com>');
  assert.equal(m.formatBrandedSender("Sleep Team <support@sleepsomno.com>"), "Sleep Team <support@vynalthai.com>");
  assert.equal(m.formatBrandedSender("person@example.net"), "person@example.net");
  assert.equal(m.formatBrandedSender("support@vynalthai.com\r\nBcc: someone@example.net"), "");
});

test("plain-text bodies are escaped and get accessible HTML with an absolute image URL", () => {
  const original = '<script>alert("x")</script> & "hello"\n你好';
  const result = m.buildSignedMessage({ from: "support@vynalthai.com", text: original });
  assert.ok(result.text.startsWith(original));
  assert.ok(result.text.includes("Vynalth AI\nsupport@vynalthai.com\nhttps://vynalthai.com"));
  assert.ok(!result.html.includes("<script>"));
  assert.ok(result.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;hello&quot;"));
  assert.ok(result.html.includes('src="https://mail.vyncuslim.com/brand/vynalth-logo.png"'));
  assert.ok(result.html.includes('alt="Vynalth AI logo"'));
  assert.ok(result.html.includes('<html lang="und" dir="auto">'));
  assert.ok(result.html.includes('role="presentation"'));
});

test("reply and forward signatures precede quoted content without dropping original text", () => {
  for (const suffix of ["\n\nOn Nov 25, Customer wrote:\n> Original\n> message", "\r\n\r\nOn Nov 25, Customer wrote:\r\n> Original", "\n\n---------- Forwarded message ----------\nFrom: customer@example.net\nOriginal"]) {
    const result = m.buildSignedMessage({ from: "support@vynalthai.com", text: "Thank you." + suffix });
    assert.ok(result.text.startsWith("Thank you.\n\n-- \nVynalth AI"));
    assert.ok(result.text.endsWith(suffix));
    assert.ok(result.html.indexOf("Vynalth AI logo") < result.html.indexOf("Original"));
  }
});

test("existing HTML survives and receives the trusted signature inside its body", () => {
  const html = '<html lang="zh"><body><p><b>Custom HTML</b> 内容</p></body></html>';
  const result = m.buildSignedMessage({ from: "vyncus@vyncuslim.com", text: "Different plain text", html, personalPhotoUrl: samplePhotoUrl });
  assert.ok(result.html.startsWith('<html lang="zh"><body><p><b>Custom HTML</b> 内容</p>'));
  assert.ok(!result.html.includes("Different plain text"));
  assert.ok(result.html.endsWith("</body></html>"));
  assert.ok(result.html.includes(samplePhotoUrl));
  assert.ok(result.html.includes('width="56" height="70"'));
  assert.ok(result.text.startsWith("Different plain text\n\n-- \nVyncus Lim"));
});

test("unknown sender signatures fail closed without changing either message version", () => {
  const input = { from: "external@example.net", text: "Original", html: "<p>Original HTML</p>" };
  assert.deepEqual(m.buildSignedMessage(input), { text: input.text, html: input.html });
});

console.log(n + " identity regression tests passed");
