// Integration docs: copy buttons, quick-start tabs, and the contents highlight.
// A separate file because the site's CSP allows no inline scripts. Everything degrades: without JS the
// tabs render as labelled sections and the code is still selectable.
(function () {
  "use strict";

  // Copy buttons on every code block.
  document.querySelectorAll("pre").forEach(function (pre) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.addEventListener("click", function () {
      var code = pre.querySelector("code") || pre;
      var done = function (label) {
        btn.textContent = label;
        btn.classList.toggle("done", label === "Copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("done");
        }, 1400);
      };
      if (!navigator.clipboard) return done("Select it");
      navigator.clipboard.writeText(code.innerText.replace(/\n$/, "")).then(
        function () { done("Copied"); },
        function () { done("Select it"); }
      );
    });
    pre.appendChild(btn);
  });

  // Tabs.
  document.querySelectorAll("[data-tabs]").forEach(function (box, n) {
    var tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
    var panels = Array.prototype.slice.call(box.querySelectorAll('[role="tabpanel"]'));
    box.classList.add("js");
    var select = function (i, focus) {
      tabs.forEach(function (t, j) {
        t.setAttribute("aria-selected", String(i === j));
        t.tabIndex = i === j ? 0 : -1;
      });
      panels.forEach(function (p, j) { p.hidden = i !== j; });
      if (focus) tabs[i].focus();
    };
    tabs.forEach(function (t, i) {
      t.id = "tab-" + n + "-" + i;
      panels[i].id = "panel-" + n + "-" + i;
      t.setAttribute("aria-controls", panels[i].id);
      panels[i].setAttribute("aria-labelledby", t.id);
      t.addEventListener("click", function () { select(i, false); });
      t.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight") select((i + 1) % tabs.length, true);
        else if (e.key === "ArrowLeft") select((i - 1 + tabs.length) % tabs.length, true);
      });
    });
    select(0, false);
  });

  // Contents: highlight the section in view.
  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
  var visible = {};
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
    var first = links.map(function (a) { return a.getAttribute("href").slice(1); }).filter(function (id) { return visible[id]; })[0];
    if (!first) return;
    links.forEach(function (a) { a.classList.toggle("on", a === byId[first]); });
  }, { rootMargin: "0px 0px -70% 0px" });
  Object.keys(byId).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();
