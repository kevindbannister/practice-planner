// Practice branding: saved per practice, validated, contrast-checked, shown on the public config,
// applied to emails, audited, and restorable.
const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./portalKit.js");
const { ratio, contrastChecks, validate, DEFAULT_COLOURS, emailHtml } = require("../portal/lib/branding.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const good = (o = {}) => ({ practiceName: "Bannister & Co", welcome: "Welcome. We're here to help.", phone: "01234 567890", address: "1 High Street\nTown", hours: "Mon-Fri 9-5", supportEmail: "help@bannister.test", emailFooter: "Registered in England", logo: PNG, loginLogo: "", colours: { ...DEFAULT_COLOURS, primary: "#7a1f3d", button: "#7a1f3d" }, ...o });
const save = (h, b, pid) => h.staff("POST", "branding-save", { branding: b }, pid);
const config = async (h, pid = "default") => (await h.call(pid, "GET", "config")).body;

test("contrast maths matches the published WCAG values", () => {
  assert.equal(Math.round(ratio("#000000", "#ffffff")), 21);
  assert.equal(ratio("#ffffff", "#ffffff"), 1);
  assert.ok(Math.abs(ratio("#767676", "#ffffff") - 4.54) < 0.02, "the classic #767676 on white is just over 4.5");
  assert.ok(contrastChecks(DEFAULT_COLOURS).every((c) => c.pass), "the standard look passes every check");
});

test("with nothing saved the portal gets the standard look and the practice name", async () => {
  const h = setup();
  const c = await config(h);
  assert.equal(c.practiceName, "Bannister & Co");
  assert.deepEqual(c.branding.colours, DEFAULT_COLOURS);
  assert.equal(c.branding.logo, "");
  const o = (await h.call("default", "GET", "admin/branding", { headers: { "x-staff": "Kevin" } })).body;
  assert.equal(o.saved, false);
  assert.ok(o.checks.every((x) => x.pass));
});

test("saved branding appears on the public config, without the email footer", async () => {
  const h = setup();
  const r = await save(h, good());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = await config(h);
  assert.equal(c.branding.colours.primary, "#7a1f3d");
  assert.equal(c.branding.welcome, "Welcome. We're here to help.");
  assert.equal(c.branding.contact.phone, "01234 567890");
  assert.equal(c.branding.supportEmail, "help@bannister.test");
  assert.equal(c.branding.loginLogo, PNG, "the login logo falls back to the main logo");
  assert.ok(!JSON.stringify(c).includes("Registered in England"), "email footer isn't public");
  assert.ok(!JSON.stringify(c).includes("updatedBy"));
});

test("only signed-in staff can read or change branding", async () => {
  const h = setup();
  assert.equal((await h.call("default", "POST", "admin/branding-save", { body: { branding: good() } })).status, 401);
  assert.equal((await h.call("default", "GET", "admin/branding")).status, 401);
  assert.equal((await h.call("default", "POST", "admin/branding-reset", { body: {} })).status, 401);
  const portalUser = await h.asUser({ sub: "x", email: "x@example.com", name: "X" }, "admin/branding");
  assert.ok(portalUser.status === 401 || portalUser.status === 403, "a portal login isn't staff");
});

test("bad values are refused, field by field, and nothing is saved", async () => {
  const h = setup();
  for (const [name, b] of [
    ["colour word", good({ colours: { ...DEFAULT_COLOURS, primary: "red" } })],
    ["colour injection", good({ colours: { ...DEFAULT_COLOURS, primary: "#fff;}</style><script>" } })],
    ["script logo", good({ logo: "data:text/html;base64,PHNjcmlwdD4=" })],
    ["url logo", good({ logo: "https://evil.example/x.png" })],
    ["huge logo", good({ logo: "data:image/png;base64," + "A".repeat(61000) })],
    ["bad email", good({ supportEmail: "not an email" })],
  ]) {
    const r = await save(h, b);
    assert.equal(r.status, 400, name);
  }
  assert.equal((await config(h)).branding.colours.primary, DEFAULT_COLOURS.primary, "nothing changed");
  assert.equal(validate(good({ logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).logo.startsWith("data:image/svg"), true, "SVG logos are fine (shown as pictures only)");
});

test("unreadable colour combinations are refused with a plain reason", async () => {
  const h = setup();
  const r = await save(h, good({ colours: { ...DEFAULT_COLOURS, button: "#ffff00", buttonInk: "#ffffff" } }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Button text on the button colour/);
  assert.match(r.body.error, /needs at least 4\.5:1/);
  const pale = await save(h, good({ colours: { ...DEFAULT_COLOURS, background: "#222222" } }));
  assert.equal(pale.status, 400, "a dark page behind dark text is refused");
  assert.equal((await save(h, good({ colours: { ...DEFAULT_COLOURS, accent: "#eeeeee" } }))).status, 400, "an invisible focus outline is refused");
});

test("each practice has its own branding", async () => {
  const h = setup({ practices: ["one", "two"] });
  await save(h, good({ practiceName: "One & Co", colours: { ...DEFAULT_COLOURS, primary: "#7a1f3d", button: "#7a1f3d" } }), "one");
  await save(h, good({ practiceName: "Two Ltd", colours: { ...DEFAULT_COLOURS, primary: "#14532d", button: "#14532d" } }), "two");
  assert.equal((await config(h, "one")).branding.colours.primary, "#7a1f3d");
  assert.equal((await config(h, "two")).branding.colours.primary, "#14532d");
  assert.equal((await config(h, "two")).practiceName, "Two Ltd");
  await h.staff("POST", "branding-reset", {}, "one");
  assert.equal((await config(h, "one")).branding.colours.primary, DEFAULT_COLOURS.primary);
  assert.equal((await config(h, "two")).branding.colours.primary, "#14532d", "resetting one practice leaves the other alone");
});

test("restore defaults removes the saved look and is audited", async () => {
  const h = setup();
  await save(h, good());
  const r = await h.staff("POST", "branding-reset", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, false);
  assert.deepEqual((await config(h)).branding.colours, DEFAULT_COLOURS);
  assert.equal((await config(h)).branding.welcome, "");
  const ev = (await h.call("default", "GET", "admin/events", { headers: { "x-staff": "Kevin" }, query: { limit: "20" } })).body.events.filter((e) => /^branding\./.test(e.type));
  assert.deepEqual(ev.map((e) => e.type).sort(), ["branding.reset", "branding.updated"]);
  assert.ok(!JSON.stringify(ev).includes("data:image"), "the audit trail doesn't hold the logo");
  assert.ok(ev.find((e) => e.type === "branding.updated").meta.changed.includes("colour:primary"));
});

test("portal emails carry the practice's look and reply address, and never run anything", async () => {
  const h = setup();
  await save(h, good({ practiceName: "Smith <b>&</b> Co", welcome: "<img src=x onerror=alert(1)>" }));
  h.mailer.sent.length = 0;
  await h.staff("POST", "invite", { email: "ann@example.com", name: "Ann", businesses: [{ clientKey: "c-acme", level: "standard" }] });
  const m = h.mailer.sent.find((x) => x.to === "ann@example.com");
  assert.ok(m, "an invitation was sent");
  assert.ok(m.text && m.html, "plain text is kept alongside the styled version");
  assert.match(m.html, /#7a1f3d/, "uses the practice's colour");
  assert.equal(m.replyTo, "help@bannister.test");
  assert.ok(m.html.includes("Smith &lt;b&gt;&amp;&lt;/b&gt; Co"), "the practice name is escaped");
  assert.ok(!m.html.includes("<b>&</b>"));
  assert.ok(m.html.includes("Registered in England") && m.html.includes("01234 567890"), "footer and contact details");
  assert.ok(m.html.includes("cid:logo") && m.inlineLogo === PNG, "the logo is sent inside the email");
  assert.ok(!/onerror/.test(m.html), "the welcome message isn't in emails");
});

test("email text with links and line breaks is escaped and linked safely", () => {
  const html = emailHtml({ text: "Hello <script>alert(1)</script>\nsecond line\n\nSign in: https://pp.example/portal?a=1&b=2", branding: { ...validate(good()), practiceName: "P" } });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("second line") && html.includes("<br>"));
  assert.ok(html.includes('href="https://pp.example/portal?a=1&amp;b=2"'));
});

test("the email preview shows a draft without saving it", async () => {
  const h = setup();
  const r = await h.staff("POST", "branding-email", { branding: good({ colours: { ...DEFAULT_COLOURS, primary: "#14532d", button: "#14532d" } }) });
  assert.equal(r.status, 200);
  assert.match(r.body.html, /#14532d/);
  assert.equal((await config(h)).branding.colours.primary, DEFAULT_COLOURS.primary, "not saved");
});
