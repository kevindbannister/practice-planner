// Runs before the first paint (like theme.js). The app sets a few attributes on <html> once it has started: the sheet design, the
// full-width Practice bar, and which workspace the page is in. Until then a refresh showed a blank pale page and then the dark
// Work or Advisory bar popping in on top. This gives the first paint its final canvas colour and a bar-coloured band across the
// top, worked out the way the app works it out (modeOfSection and effectiveMode in src/lib/navAreas.ts: keep them in step); the
// app removes data-boot as soon as it has drawn its own bar.
(function () {
  try {
    var h = document.documentElement;
    var parts = (location.hash || "").replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
    var s = parts[0] || "home";
    // a client's Freedom Plan or tax plan, and the Development Hub, are full screens with no top bar
    if (s === "devhub" || ((s === "advisory" || s === "taxplan") && parts[1] && parts[1] !== "production")) return;

    // what this device remembers about the workspace you were last in (kept by the app as pp.nav.<account>)
    var prefs = null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("pp.nav.") !== 0) continue;
        var p = null;
        try { p = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }   // pp.nav.area and the like are not the prefs
        if (p && p.menuStyle && (!prefs || String(p.updated || "") > String(prefs.updated || ""))) prefs = p;
      }
    } catch (e) { /* none */ }
    var style = prefs ? prefs.menuStyle : "toggle-advisory";
    var switches = /^(toggle|toggle-advisory|three|modedrop)$/.test(style);   // other menu styles have no workspaces
    var three = style !== "toggle";                                            // the two-way switch keeps Advisory inside Work

    var mode;
    if (/^(home|plan|chase|sales|comms|practice|compliance|aml|client-copy)$/.test(s)) mode = "practice";
    else if (/^(work|papers|tax|payroll|cosec)$/.test(s)) mode = "work";
    else if (/^(advisory-overview|reporting|advisory|taxplan)$/.test(s)) mode = three ? "advisory" : "work";
    else {                                                                     // Clients, Settings and the like: the workspace you were last in
      mode = (prefs && prefs.lastMode) || "practice";
      if (!three && mode === "advisory") mode = prefs.lastPracticeWorkMode === "work" ? "work" : "practice";
    }
    if (!switches) mode = "practice";

    h.setAttribute("data-sheet", "");
    h.setAttribute("data-pflat", "");
    if (mode === "work") h.setAttribute("data-work", "");
    else if (mode === "advisory") h.setAttribute("data-advisory", "");
    h.setAttribute("data-boot", mode);
    // never leave the band behind if the app does not get as far as drawing a bar (sign-in, an error)
    window.setTimeout(function () { h.removeAttribute("data-boot"); }, 15000);
  } catch (e) { /* the app sets all of this itself a moment later */ }
})();
