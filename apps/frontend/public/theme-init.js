// Runs before first paint. Keep MARKETING in sync with src/lib/theme.ts.
(function () {
  try {
    var MARKETING = /^\/(?:$|login|register|checkout|mitra)/;
    var path = location.pathname;
    var el = document.documentElement;
    var t = localStorage.getItem("siskop.theme");
    var dark =
      !MARKETING.test(path) &&
      (t === "dark" || (!t && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches));
    el.classList.toggle("dark", dark);
    el.style.colorScheme = dark ? "dark" : "light";
    // #root holds the prerendered landing page; hide it on other routes until main.tsx clears it.
    if (path !== "/") el.setAttribute("data-boot", "");
  } catch (e) {}
})();
