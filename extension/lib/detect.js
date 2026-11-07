// Runs inside the web page (Chrome injects it): collects what the page says about who it is for. It has to stand alone.
export function pageInfo() {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const texts = [];
  const add = (s) => { s = clean(s); if (s && s.length <= 90 && !texts.includes(s)) texts.push(s); };
  const selectors = [
    '[data-automationid*="org" i]', '[data-testid*="org" i]', 'button[class*="organisation" i]',
    '[class*="OrganisationName" i]', '[class*="orgName" i]', '[class*="org-name" i]', '[class*="organization" i]',
  ];
  for (const s of selectors) { try { document.querySelectorAll(s).forEach((e) => add(e.textContent)); } catch (e) { /* skip a selector the page can't use */ } }
  const h1 = document.querySelector("h1");
  if (h1) add(h1.textContent);
  return { url: location.href, title: document.title, texts: texts.slice(0, 14) };
}
