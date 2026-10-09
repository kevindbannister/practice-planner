// Applies the saved light or dark choice before the page draws (see src/ui/theme.ts).
(function () {
  try {
    var t = localStorage.getItem("pp.theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
