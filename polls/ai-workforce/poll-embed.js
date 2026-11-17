/* BPC poll embeds: component library.
 *
 * One file, no dependencies. Reads poll data in the shape that
 * import_pf_crosstabs.py writes (window.BPCP_DATA, or data passed in), and
 * mounts a question card into any element:
 *
 *   BPCPoll.mount(el, { q: "Q40", view: "stack", rows: "items", ... })
 *
 * or declaratively, which is how the WordPress block uses it:
 *
 *   <div class="bpcp" data-bpcp='{"q":"Q40","view":"stack","rows":"items"}'></div>
 *   <script src=".../poll-embed.js" data-src=".../poll_data.json" defer>
 *
 * Views:
 *   stack   100% stacked bars; rows are groups (one question) or items (a grid,
 *           one group at a time). Optional diverging layout around a center line.
 *   rank    ranked bars for long or select-several lists, one group at a time,
 *           with a tick marking all respondents.
 *   hero    one headline number with a 10 x 10 waffle.
 *
 * Motion: bars grow in once when a card scrolls into view (every time, with
 * window.BPCP_REPLAY = true), the headline
 * number counts up, and filter changes animate widths. All of it is off
 * under prefers-reduced-motion (or the .bpcp-reduce class, for testing).
 */
(function () {
  "use strict";

  // Every WordPress block carries the same <script> tag, so the file can run
  // more than once on a page. Only the first copy does anything.
  if (window.BPCPoll) return;
  var SCRIPT = document.currentScript;

  var MIN_N_DEFAULT = 100;

  var DIM_LABELS = {
    "Age Group": "Age",
    "Time in Workforce": "Time in workforce",
    "Sector Group (placeholder)": "Sector"
  };

  /* Placeholder line icons, 24 x 24, stroke = currentColor. A final set from
     any one consistent source replaces these; swap the SVG strings here and every card follows. */
  var ICONS = {
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.8 5 5.8"/>',
    ballot: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>',
    path: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.spark) + "</svg>";
  }

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function pct(v) { return v == null ? "n/a" : Math.round(v * 100) + "%"; }
  function fmtN(n) { return Number(n).toLocaleString("en-US"); }
  function sum(vals, idx) {
    var s = 0;
    idx.forEach(function (i) { s += vals[i] || 0; });
    return s;
  }
  function dimLabel(d) { return DIM_LABELS[d] || String(d).replace(/\s*\(.*\)\s*/, ""); }
  function baseLabel(b) {
    if (!b || /^all respondents$/i.test(b)) return "All respondents";
    return b.replace(/\s*\(Q\d+\)\s*$/, "");
  }

  var reduceMQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() {
    if (document.documentElement.classList.contains("bpcp-reduce")) return true;
    return reduceMQ ? reduceMQ.matches : false;
  }

  /* ---------- the card shell ---------- */

  function mount(root, cfg, data) {
    data = data || window.BPCP_DATA;
    if (!root.classList.contains("bpcp")) root.classList.add("bpcp");
    var q = data.questions[cfg.q];
    if (!q) {
      root.textContent = "Question " + cfg.q + " is not in the data.";
      return null;
    }
    var view = VIEWS[cfg.view || "stack"];
    var banner = data.banner;
    var dims = (cfg.dims || data.dimensions).filter(function (d) { return d !== "Total"; });
    var ctx = {
      root: root, cfg: cfg, data: data, q: q, banner: banner, dims: dims, view: view,
      minN: (data.meta && data.meta.min_n) || MIN_N_DEFAULT,
      state: { dim: cfg.dim || dims[0], group: 0, expanded: false },
      played: false
    };
    ctx.colsFor = function (dim) {
      var out = [];
      banner.forEach(function (c, i) { if (c.dim === dim) out.push(i); });
      return out;
    };
    buildShell(ctx);
    view.render(ctx, false);
    renderTable(ctx);
    addDownload(ctx);
    arm(ctx);
    root.__bpcp = ctx;
    return ctx;
  }

  function buildShell(ctx) {
    var cfg = ctx.cfg, q = ctx.q, t0 = q.tables[0];
    var root = ctx.root;
    root.innerHTML = "";
    var card = h("figure", "bpcp-card");
    ctx.card = card;

    var num = q.id.replace(/^Q/, "");
    var head = h("header", "bpcp-head");
    head.innerHTML = '<span class="bpcp-icon">' + icon(cfg.icon) + "</span>" +
      '<div><p class="bpcp-eyebrow">Question ' + esc(num) + " · " + esc(baseLabel(t0.base)) + "</p>" +
      '<h3 class="bpcp-q">' + esc(cfg.title || q.title.replace(/^Q\d+\.\s*/, "")) + "</h3></div>";
    card.appendChild(head);

    if (cfg.know) {
      card.appendChild(h("p", "bpcp-know", icon("bulb") + "<span>" + esc(cfg.know) + "</span>"));
    }

    var filters = h("div", "bpcp-filters");
    var dimsRow = h("div", "bpcp-dims");
    dimsRow.setAttribute("role", "group");
    dimsRow.setAttribute("aria-label", "Break down results by");
    dimsRow.appendChild(h("span", "bpcp-filter-label", "Break down by"));
    ctx.dims.forEach(function (d) {
      var b = h("button", "bpcp-btn", esc(dimLabel(d)));
      b.type = "button";
      b.dataset.dim = d;
      b.setAttribute("aria-pressed", String(d === ctx.state.dim));
      b.addEventListener("click", function () {
        if (ctx.state.dim === d) return;
        ctx.state.dim = d;
        ctx.state.group = 0;
        syncFilters(ctx);
        ctx.view.render(ctx, true);
        renderTable(ctx);
      });
      dimsRow.appendChild(b);
    });
    filters.appendChild(dimsRow);
    if (ctx.view.oneGroup || ctx.cfg.rows === "items") {
      ctx.chips = h("div", "bpcp-chips");
      ctx.chips.setAttribute("role", "group");
      ctx.chips.setAttribute("aria-label", "Show one group");
      filters.appendChild(ctx.chips);
    }
    card.appendChild(filters);
    ctx.filters = filters;

    ctx.legend = h("ul", "bpcp-legend");
    card.appendChild(ctx.legend);
    ctx.plot = h("div", "bpcp-plot");
    card.appendChild(ctx.plot);

    ctx.foot = h("p", "bpcp-foot");
    card.appendChild(ctx.foot);

    var det = h("details", "bpcp-table");
    det.appendChild(h("summary", null, "Show the numbers"));
    ctx.tableWrap = h("div", "bpcp-scroll");
    det.appendChild(ctx.tableWrap);
    card.appendChild(det);

    ctx.tip = h("div", "bpcp-tip");
    ctx.tip.hidden = true;
    card.appendChild(ctx.tip);
    wireTip(ctx);

    root.appendChild(card);
    syncFilters(ctx);
  }

  function groupSmall(ctx, col) {
    /* a group is too small if any table it would draw falls under the floor */
    return ctx.q.tables.some(function (t) {
      return (t.n_unweighted[col] || 0) < ctx.minN && !(t.item && /major/i.test(t.item));
    });
  }

  function syncFilters(ctx) {
    ctx.filters.querySelectorAll(".bpcp-dims .bpcp-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.dim === ctx.state.dim));
    });
    if (!ctx.chips) return;
    ctx.chips.innerHTML = "";
    [0].concat(ctx.colsFor(ctx.state.dim)).forEach(function (col) {
      var label = col === 0 ? "All respondents" : ctx.banner[col].label;
      var small = col !== 0 && groupSmall(ctx, col);
      var b = h("button", "bpcp-btn bpcp-chip", esc(label));
      b.type = "button";
      b.setAttribute("aria-pressed", String(col === ctx.state.group));
      if (small) {
        b.disabled = true;
        b.title = "Fewer than " + ctx.minN + " respondents";
        b.innerHTML = esc(label) + ' <span aria-hidden="true">· n&lt;' + ctx.minN + "</span>";
      }
      b.addEventListener("click", function () {
        ctx.state.group = col;
        syncFilters(ctx);
        ctx.view.render(ctx, true);
        renderTable(ctx);
      });
      ctx.chips.appendChild(b);
    });
  }

  function setLegend(ctx, items) {
    ctx.legend.innerHTML = items.map(function (it) {
      var sw = it.tick ? '<span class="bpcp-sw bpcp-sw-tick"></span>' : '<span class="bpcp-sw c-' + it.color + '"></span>';
      return "<li>" + sw + esc(it.label) + "</li>";
    }).join("");
  }

  function setFoot(ctx, n, extra) {
    var t0 = ctx.q.tables[0];
    var lines = [
      "Asked of: " + esc(baseLabel(t0.base)) + ". " + (n != null ? "n = " + fmtN(n) + " (unweighted)." : ""),
      "Groups with fewer than " + ctx.minN + " respondents are not shown. Percentages may not add to 100 because of rounding."
    ];
    if (extra) lines.push(esc(extra));
    lines.push(esc(ctx.cfg.source || "Source: PF Global poll for the Bipartisan Policy Center. PLACEHOLDER DATA."));
    ctx.foot.innerHTML = lines.map(function (l) { return "<span>" + l + "</span>"; }).join("");
  }

  /* ---------- tooltip ---------- */

  function wireTip(ctx) {
    var card = ctx.card, tip = ctx.tip;
    function show(target, x, y) {
      tip.innerHTML = target.dataset.tip;
      tip.hidden = false;
      var r = card.getBoundingClientRect();
      var w = tip.offsetWidth, ht = tip.offsetHeight;
      var left = Math.min(Math.max(x - r.left - w / 2, 0), r.width - w);
      var top = y - r.top - ht - 12;
      if (top < 0) top = y - r.top + 16;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    card.addEventListener("pointermove", function (e) {
      var t = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (!t) { tip.hidden = true; return; }
      show(t, e.clientX, e.clientY);
    });
    card.addEventListener("pointerleave", function () { tip.hidden = true; });
    card.addEventListener("focusin", function (e) {
      var t = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      show(t, r.left + r.width / 2, r.top);
    });
    card.addEventListener("focusout", function () { tip.hidden = true; });
  }

  /* ---------- table view ---------- */

  function renderTable(ctx) {
    var td = ctx.view.table(ctx);
    var html = "<table><thead><tr>" + td.head.map(function (c) { return "<th scope=\"col\">" + esc(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + td.rows.map(function (r) {
        return "<tr>" + r.map(function (c, i) {
          return i === 0 ? "<th scope=\"row\">" + esc(c) + "</th>" : "<td>" + esc(c) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
    ctx.tableWrap.innerHTML = html;
  }

  /* ---------- motion ---------- */

  var observer = null;
  // Replay mode (window.BPCP_REPLAY = true; the workbench sets it for review):
  // a card resets when it leaves the screen and plays again when it returns.
  // Off on live pages, where each card animates once.
  function replayMode() { return window.BPCP_REPLAY === true; }
  function reset(ctx) {
    ctx.card.classList.add("bpcp-pre");
    if (ctx.view === hero) heroReset(ctx);
    ctx.waiting = true;
  }
  function arm(ctx) {
    if (reduced() || !("IntersectionObserver" in window)) { ctx.played = true; return; }
    var r = ctx.root.getBoundingClientRect();
    var onScreen = r.top < window.innerHeight && r.bottom > 0;
    if (onScreen) play(ctx);  /* already on screen: grow in right away */
    else { ctx.card.classList.add("bpcp-pre"); ctx.waiting = true; }
    if (onScreen && !replayMode()) return;
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var c = en.target.__bpcp;
          if (!c) return;
          if (en.isIntersecting && en.intersectionRatio >= 0.3 && c.waiting) {
            c.waiting = false;
            if (!replayMode()) observer.unobserve(en.target);
            play(c);
          } else if (!en.isIntersecting && replayMode() && !c.waiting) {
            reset(c);
          }
        });
      }, { threshold: [0, 0.3] });
    }
    observer.observe(ctx.root);
  }

  function play(ctx) {
    if (!ctx) return;
    ctx.played = true;
    if (reduced()) { ctx.card.classList.remove("bpcp-pre"); if (ctx.view.settle) ctx.view.settle(ctx); return; }
    ctx.card.classList.add("bpcp-pre");
    void ctx.card.offsetWidth;  /* commit the collapsed state before releasing it */
    requestAnimationFrame(function () {
      ctx.card.classList.remove("bpcp-pre");
      if (ctx.view.intro) ctx.view.intro(ctx);
    });
  }

  /* ---------- view: stack ---------- */

  function stackSpec(ctx) {
    var cfg = ctx.cfg, n = ctx.q.tables[0].answers.length;
    var side = cfg.side || [];
    var order = cfg.order;
    if (!order) {
      order = [];
      for (var i = 0; i < n; i++) if (side.indexOf(i) < 0) order.push(i);
    }
    var div = cfg.diverge || null;
    var colors = {};
    Object.keys(cfg.colors || {}).forEach(function (k) { colors[k] = cfg.colors[k]; });
    if (!div) {
      /* a plain 100% bar keeps "Don't know" inside, as a grey last segment, so every bar ends flush */
      side.forEach(function (a) { if (!colors[a]) colors[a] = "dk"; });
      order = order.concat(side);
      side = [];
    }
    var visual = div ? div.neg.slice().reverse().concat(div.pos) : order;
    return { side: side, order: order, div: div, visual: visual, colors: colors };
  }

  function stackRows(ctx) {
    var q = ctx.q, st = ctx.state, rows = [];
    if (ctx.cfg.rows === "items") {
      q.tables.forEach(function (t, i) {
        rows.push({ key: "i" + i, label: t.item, n: t.n_unweighted[st.group], small: t.n_unweighted[st.group] < ctx.minN,
                    values: t.answers.map(function (a) { return a.values[st.group]; }) });
      });
    } else {
      var t = q.tables[ctx.cfg.table || 0];
      [0].concat(ctx.colsFor(st.dim)).forEach(function (col) {
        rows.push({ key: "c" + col, label: col === 0 ? "All respondents" : ctx.banner[col].label, total: col === 0,
                    n: t.n_unweighted[col], small: t.n_unweighted[col] < ctx.minN,
                    values: t.answers.map(function (a) { return a.values[col]; }) });
      });
    }
    return rows;
  }

  function stackScale(ctx, sp) {
    /* fixed across every group and item, so the center line never jumps on a filter change */
    if (!sp.div) return { negMax: 0, posMax: 1, span: 1 };
    var negMax = 0, posMax = 0;
    ctx.q.tables.forEach(function (t) {
      t.n_unweighted.forEach(function (n, col) {
        if (n < ctx.minN) return;
        var vals = t.answers.map(function (a) { return a.values[col]; });
        negMax = Math.max(negMax, sum(vals, sp.div.neg));
        posMax = Math.max(posMax, sum(vals, sp.div.pos));
      });
    });
    return { negMax: negMax, posMax: posMax, span: negMax + posMax };
  }

  function segDenom(sp, scale, a) {
    /* each half of a diverging track spans its own maximum; a plain track spans 100% */
    if (!sp.div) return 1;
    return sp.div.neg.indexOf(a) >= 0 ? scale.negMax : scale.posMax;
  }

  function fitLabels(ctx) {
    /* show a value inside its segment only when it has room (about 30px) */
    ctx.plot.querySelectorAll(".bpcp-seg").forEach(function (seg) {
      var px = seg.parentNode.offsetWidth * parseFloat(seg.style.width) / 100;
      seg.textContent = px >= 30 ? seg.dataset.label : "";
    });
  }

  function segHTML(ctx, row, a, sp, scale, i) {
    var t0 = ctx.q.tables[0];
    var v = row.values[a] || 0;
    var w = (v / segDenom(sp, scale, a)) * 100;
    var label = t0.answers[a].label;
    var tip = segTip(label, row, v);
    return '<div class="bpcp-seg c-' + (sp.colors[a] || "s3") + '" data-a="' + a + '" data-label="' + pct(v) + '" style="width:' + w.toFixed(2) +
      '%;--i:' + i + '" data-tip="' + esc(tip) + '" tabindex="0" aria-label="' + esc(label + ", " + row.label + ": " + pct(v)) + '">' +
      "</div>";
  }

  /* The group's n sits in the tooltip and the numbers table, not under the label. */
  function segTip(label, row, v) {
    return esc(label) + "<br>" + esc(row.label) + ": <b>" + pct(v) + "</b><br>n = " + fmtN(row.n);
  }

  function rowInner(ctx, row, sp, scale, i) {
    var lab = '<div class="bpcp-rlab" data-tip="' + esc(esc(row.label) + "<br>n = " + fmtN(row.n)) + '"><span class="bpcp-name">' + esc(row.label) +
      '</span><span class="bpcp-n">n = ' + fmtN(row.n) + "</span></div>";
    if (row.small) {
      return lab + '<div class="bpcp-toofew">Too few respondents to report (n = ' + fmtN(row.n) + ")</div>";
    }
    var track;
    if (sp.div) {
      var c = (scale.negMax / scale.span) * 100;
      track = '<div class="bpcp-track is-div" style="--c:' + c.toFixed(2) + '%">' +
        '<div class="bpcp-half bpcp-neg" style="width:' + c.toFixed(2) + '%">' +
        sp.div.neg.slice().reverse().map(function (a) { return segHTML(ctx, row, a, sp, scale, i); }).join("") + "</div>" +
        '<div class="bpcp-half bpcp-pos" style="width:' + (100 - c).toFixed(2) + '%">' +
        sp.div.pos.map(function (a) { return segHTML(ctx, row, a, sp, scale, i); }).join("") + "</div></div>";
    } else {
      track = '<div class="bpcp-track"><div class="bpcp-half bpcp-pos" style="width:100%">' +
        sp.order.map(function (a) { return segHTML(ctx, row, a, sp, scale, i); }).join("") + "</div></div>";
    }
    var side = sp.side.length ? '<div class="bpcp-side" title="' + esc(sp.side.map(function (a) { return ctx.q.tables[0].answers[a].label; }).join(", ")) + '">' +
      '<span class="bpcp-sw c-dk"></span><span class="bpcp-side-v">' + (ctx.cfg.sideLabel || "DK") + " " + pct(sum(row.values, sp.side)) + "</span></div>" : "";
    return lab + track + side;
  }

  var stack = {
    render: function (ctx, animate) {
      var sp = stackSpec(ctx), scale = stackScale(ctx, sp), rows = stackRows(ctx);
      var t0 = ctx.q.tables[0];
      var legend = sp.visual.map(function (a) { return { label: t0.answers[a].label, color: sp.colors[a] || "s3" }; });
      if (sp.side.length) legend.push({ label: (ctx.cfg.sideLabel || "DK") + " = " + sp.side.map(function (a) { return t0.answers[a].label; }).join(", "), color: "dk" });
      setLegend(ctx, legend);

      var existing = {};
      Array.prototype.forEach.call(ctx.plot.children, function (el) { existing[el.dataset.key] = el; });
      var seen = {};
      rows.forEach(function (row, i) {
        seen[row.key] = true;
        var el = existing[row.key];
        var sameShape = el && el.dataset.small === String(!!row.small);
        if (sameShape && !row.small) {
          /* update in place so widths glide to their new values */
          el.querySelectorAll(".bpcp-seg").forEach(function (seg) {
            var a = +seg.dataset.a, v = row.values[a] || 0, w = (v / segDenom(sp, scale, a)) * 100;
            var label = t0.answers[a].label;
            seg.style.width = w.toFixed(2) + "%";
            seg.dataset.label = pct(v);
            seg.dataset.tip = segTip(label, row, v);
            seg.setAttribute("aria-label", label + ", " + row.label + ": " + pct(v));
          });
          el.querySelector(".bpcp-n").textContent = "n = " + fmtN(row.n);
          el.querySelector(".bpcp-rlab").dataset.tip = esc(row.label) + "<br>n = " + fmtN(row.n);
          var sd = el.querySelector(".bpcp-side");
          if (sd && sp.side.length) sd.querySelector(".bpcp-side-v").textContent = (ctx.cfg.sideLabel || "DK") + " " + pct(sum(row.values, sp.side));
          ctx.plot.appendChild(el);  /* keeps DOM order equal to row order */
        } else {
          if (el) el.remove();
          el = h("div", "bpcp-row" + (row.total ? " is-total" : "") + (sp.side.length ? "" : " no-side"), rowInner(ctx, row, sp, scale, i));
          el.dataset.key = row.key;
          el.dataset.small = String(!!row.small);
          ctx.plot.appendChild(el);
          if (animate && !reduced()) {
            var segs = el.querySelectorAll(".bpcp-seg");
            segs.forEach(function (s) { s.classList.add("is-enter"); });
            void el.offsetWidth;
            requestAnimationFrame(function () { segs.forEach(function (s) { s.classList.remove("is-enter"); }); });
          }
        }
      });
      Object.keys(existing).forEach(function (k) { if (!seen[k]) existing[k].remove(); });

      fitLabels(ctx);
      if (!ctx.ro && "ResizeObserver" in window) {
        ctx.ro = new ResizeObserver(function () { fitLabels(ctx); });
        ctx.ro.observe(ctx.plot);
      }
      var hidden = rows.filter(function (r) { return r.small; }).length;
      setFoot(ctx, ctx.q.tables[0].n_unweighted[ctx.cfg.rows === "items" ? ctx.state.group : 0]);
      ctx.plot.dataset.hidden = hidden;
    },
    table: function (ctx) {
      var sp = stackSpec(ctx), t0 = ctx.q.tables[0];
      var cols = sp.visual.concat(sp.side);
      var head = [ctx.cfg.rows === "items" ? "Item" : "Group"].concat(cols.map(function (a) { return t0.answers[a].label; }), ["n"]);
      var rows = stackRows(ctx).map(function (r) {
        return [r.label].concat(cols.map(function (a) { return r.small ? "—" : pct(r.values[a]); }), [fmtN(r.n)]);
      });
      return { head: head, rows: rows };
    }
  };

  /* ---------- view: rank ---------- */

  var rank = {
    oneGroup: true,
    render: function (ctx, animate) {
      var cfg = ctx.cfg, t = ctx.q.tables[cfg.table || 0], g = ctx.state.group;
      var hide = cfg.hide || [];
      var idx = t.answers.map(function (a, i) { return i; }).filter(function (i) { return hide.indexOf(i) < 0; });
      idx.sort(function (a, b) { return (t.answers[b].values[0] || 0) - (t.answers[a].values[0] || 0); });
      var max = 0;
      idx.forEach(function (i) { t.answers[i].values.forEach(function (v, col) { if (t.n_unweighted[col] >= ctx.minN) max = Math.max(max, v || 0); }); });
      max = Math.min(1, Math.ceil(max * 10) / 10);
      var top = cfg.top || idx.length;
      var shown = ctx.state.expanded ? idx : idx.slice(0, top);
      var gLabel = g === 0 ? "All respondents" : ctx.banner[g].label;
      ctx.rankDrawn = { t: t, g: g, shown: shown, max: max, gLabel: gLabel };

      setLegend(ctx, g === 0 ? [{ label: "All respondents", color: "s2" }]
        : [{ label: gLabel, color: "s2" }, { label: "All respondents", tick: true }]);

      var wrap = ctx.plot.querySelector(".bpcp-rank");
      var fresh = !wrap;
      if (fresh) { wrap = h("div", "bpcp-rank"); ctx.plot.innerHTML = ""; ctx.plot.appendChild(wrap); }
      var existing = {};
      Array.prototype.forEach.call(wrap.children, function (el) { existing[el.dataset.key] = el; });
      wrap.innerHTML = "";
      shown.forEach(function (i, k) {
        var a = t.answers[i], v = a.values[g] || 0, tot = a.values[0] || 0;
        var el = existing["a" + i];
        if (!el) {
          el = h("div", "bpcp-rrow",
            '<div class="bpcp-rlabel">' + esc(a.label) + "</div>" +
            '<div class="bpcp-rbar"><div class="bpcp-rtrack"><div class="bpcp-rfill" style="width:0;--i:' + k + '"></div>' +
            '<div class="bpcp-rtick"></div></div><div class="bpcp-rval"></div></div>');
          el.dataset.key = "a" + i;
        }
        var fill = el.querySelector(".bpcp-rfill"), tick = el.querySelector(".bpcp-rtick");
        el.querySelector(".bpcp-rval").textContent = pct(v);
        var tip = esc(a.label) + "<br>" + esc(gLabel) + ": <b>" + pct(v) + "</b>" + (g ? "<br>All respondents: " + pct(tot) : "") + "<br>n = " + fmtN(t.n_unweighted[g]);
        el.querySelector(".bpcp-rbar").dataset.tip = tip;
        wrap.appendChild(el);
        requestAnimationFrame(function () {
          fill.style.width = (v / max * 100).toFixed(2) + "%";
          tick.style.left = (tot / max * 100).toFixed(2) + "%";
          tick.style.opacity = g === 0 ? "0" : "1";
        });
      });
      var btn = ctx.plot.querySelector(".bpcp-more");
      if (idx.length > top) {
        if (!btn) {
          btn = h("button", "bpcp-btn bpcp-chip bpcp-more");
          btn.type = "button";
          btn.addEventListener("click", function () {
            ctx.state.expanded = !ctx.state.expanded;
            rank.render(ctx, true);
            renderTable(ctx);
          });
          ctx.plot.appendChild(btn);
        }
        btn.textContent = ctx.state.expanded ? "Show the top " + top : "Show all " + idx.length + " answers";
      }
      var note = ctx.q.kind === "multi" ? "Respondents could choose more than one answer, so totals add to more than 100%." : null;
      setFoot(ctx, t.n_unweighted[g], note);
    },
    image: function (ctx) {
      var d = ctx.rankDrawn, t = d.t, g = d.g;
      var notes = [];
      if (ctx.q.kind === "multi") notes.push("Respondents could choose more than one answer, so totals add to more than 100%.");
      notes.push("Asked of: " + baseLabel(t.base) + ". n = " + fmtN(t.n_unweighted[g]) + " (unweighted).");
      notes.push(ctx.cfg.source || "Source: PF Global poll for the Bipartisan Policy Center. PLACEHOLDER DATA.");
      return {
        eyebrow: "Question " + ctx.q.id.replace(/^Q/, "") + " \u00b7 " + baseLabel(ctx.q.tables[0].base),
        title: ctx.cfg.title || ctx.q.title.replace(/^Q\d+\.\s*/, ""),
        group: d.gLabel, tickLabel: g ? "All respondents" : null, max: d.max,
        rows: d.shown.map(function (i) {
          var a = t.answers[i];
          return { label: a.label, value: a.values[g] || 0, text: pct(a.values[g] || 0), tick: g ? (a.values[0] || 0) : null };
        }),
        notes: notes,
        file: "bpc-ai-workforce-poll-" + ctx.q.id.toLowerCase() + "-" + d.gLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      };
    },
    table: function (ctx) {
      var t = ctx.q.tables[ctx.cfg.table || 0], g = ctx.state.group;
      var head = ["Answer", "All respondents"];
      if (g) head.push(ctx.banner[g].label);
      var rows = t.answers.map(function (a) {
        var r = [a.label, pct(a.values[0])];
        if (g) r.push(pct(a.values[g]));
        return r;
      });
      rows.push(["n"].concat(g ? [fmtN(t.n_unweighted[0]), fmtN(t.n_unweighted[g])] : [fmtN(t.n_unweighted[0])]));
      return { head: head, rows: rows };
    }
  };

  /* ---------- view: hero (headline number + waffle) ---------- */

  /* cfg.items: [{table, sum, says, label}, ...] puts two or three headline
     numbers side by side under one set of filters; without it, the card's own
     table/sum/says make a single one. */
  function heroParts(ctx) {
    var c = ctx.cfg;
    return c.items || [{ table: c.table, sum: c.sum, says: c.says }];
  }

  function heroValue(ctx, col, part) {
    part = part || heroParts(ctx)[0];
    var t = ctx.q.tables[part.table || 0];
    return sum(t.answers.map(function (a) { return a.values[col]; }), part.sum || [0]);
  }

  var hero = {
    oneGroup: true,
    render: function (ctx, animate) {
      var g = ctx.state.group, parts = heroParts(ctx), multi = parts.length > 1;
      if (!ctx.heroBoxes) {
        var wrap = h("div", "bpcp-heroes" + (multi ? " is-multi" : ""));
        ctx.heroBoxes = parts.map(function (part) {
          var box = h("div", "bpcp-hero",
            '<div><div class="bpcp-big" aria-live="polite"></div><p class="bpcp-says"></p><p class="bpcp-compare"></p></div>' +
            '<div class="bpcp-waffle" role="img"></div>');
          var waffle = box.querySelector(".bpcp-waffle");
          for (var i = 0; i < 100; i++) waffle.appendChild(h("span", "bpcp-cell"));
          wrap.appendChild(box);
          return { el: box, part: part, shown: 0, target: 0, raf: 0 };
        });
        ctx.plot.innerHTML = "";
        ctx.plot.appendChild(wrap);
      }
      setLegend(ctx, []);
      ctx.legend.hidden = true;
      var gLabel = g === 0 ? "All respondents" : ctx.banner[g].label;
      ctx.heroBoxes.forEach(function (b) {
        var v = heroValue(ctx, g, b.part);
        b.el.querySelector(".bpcp-says").textContent = b.part.says || "";
        b.el.querySelector(".bpcp-compare").textContent = g === 0 ? "Among all respondents" :
          "Among " + gLabel + " (all respondents: " + pct(heroValue(ctx, 0, b.part)) + ")";
        b.el.querySelector(".bpcp-waffle").setAttribute("aria-label", Math.round(v * 100) + " of 100 squares filled");
        b.target = v;
        if (animate && ctx.played && !reduced()) countTo(b, v); else setHero(b, v);
      });
      setFoot(ctx, ctx.q.tables[parts[0].table || 0].n_unweighted[g]);
    },
    intro: function (ctx) { ctx.heroBoxes.forEach(function (b) { countTo(b, b.target, 0); }); },
    settle: function (ctx) { ctx.heroBoxes.forEach(function (b) { setHero(b, b.target); }); },
    table: function (ctx) {
      var parts = heroParts(ctx);
      var head = ["Group"].concat(parts.map(function (p) {
        return p.label || (parts.length > 1 ? ctx.q.tables[p.table || 0].item : ctx.cfg.tableLabel || "Share");
      }), ["n"]);
      var rows = [0].concat(ctx.colsFor(ctx.state.dim)).map(function (col) {
        var t = ctx.q.tables[parts[0].table || 0];
        var small = t.n_unweighted[col] < ctx.minN;
        return [col === 0 ? "All respondents" : ctx.banner[col].label]
          .concat(parts.map(function (p) { return small ? "—" : pct(heroValue(ctx, col, p)); }), [fmtN(t.n_unweighted[col])]);
      });
      return { head: head, rows: rows };
    }
  };

  function heroReset(ctx) { (ctx.heroBoxes || []).forEach(function (b) { setHero(b, 0); }); }

  function setHero(b, v) {
    b.el.querySelector(".bpcp-big").textContent = pct(v);
    var on = Math.round(v * 100);
    b.el.querySelectorAll(".bpcp-cell").forEach(function (c, i) {
      c.style.transitionDelay = "0s";
      c.classList.toggle("on", i < on);
    });
    b.shown = v;
  }

  function countTo(b, v, from) {
    var big = b.el.querySelector(".bpcp-big");
    var start = from != null ? from : (b.shown || 0);
    var t0 = null, dur = 900;
    if (b.raf) cancelAnimationFrame(b.raf);
    var cells = b.el.querySelectorAll(".bpcp-cell"), on = Math.round(v * 100), prev = Math.round(start * 100);
    cells.forEach(function (c, i) {
      var lo = Math.min(on, prev), d = Math.abs(i - lo);
      c.style.transitionDelay = (i >= Math.min(on, prev) && i < Math.max(on, prev) ? d * 8 : 0) + "ms";
      c.classList.toggle("on", i < on);
    });
    if (from === 0) cells.forEach(function (c, i) { c.style.transitionDelay = i * 8 + "ms"; });
    function step(ts) {
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      big.textContent = pct(start + (v - start) * e);
      if (p < 1) b.raf = requestAnimationFrame(step);
    }
    b.raf = requestAnimationFrame(step);
    b.shown = v;
  }

  /* ---------- view: flow (AP VoteCast-style flow chart) ----------
   * Each group of the chosen breakdown is a bar along the top, as wide as its
   * weighted share of respondents. The bar splits into ribbons that run down to
   * the answers, so the answer nodes at the bottom add up to the topline.
   * Ported from the chart options page (work/2026-11_ai-poll-viz-examples).
   *
   * cfg: order (answer indices, left to right), colors ({answer: token}),
   *      phrases ({answer: "trust the Democratic Party more"}),
   *      sentence ("{pct} of {noun} {phrase} with {item}."),
   *      nouns ({dimension: "respondents ages {g}"}), color ("group" | "answer")
   */
  var SVGNS = "http://www.w3.org/2000/svg";
  var GROUP_HUES = 5;  /* five validated group hues; more groups switch to answer colors */

  function svgEl(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function splitLabel(s, max) {
    if (s.length <= max) return [s];
    var mid = s.length / 2, best = -1;
    for (var i = 0; i < s.length; i++) if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
  }
  function spreadLabels(items, W, pad) {
    /* keep a row of labels from overlapping: push right, then pull back inside the width */
    var left = [];
    items.forEach(function (it) { it.w = it.el.getBBox().width; left.push(it.cx - it.w / 2); });
    for (var i = 0; i < items.length; i++) {
      var minL = i === 0 ? 0 : left[i - 1] + items[i - 1].w + pad;
      if (left[i] < minL) left[i] = minL;
    }
    for (var k = items.length - 1; k >= 0; k--) {
      var maxL = k === items.length - 1 ? W - items[k].w : left[k + 1] - pad - items[k].w;
      if (left[k] > maxL) left[k] = maxL;
    }
    items.forEach(function (it, j) {
      var dx = left[j] + it.w / 2 - it.cx;
      if (Math.abs(dx) > 0.5) it.el.setAttribute("transform", "translate(" + r1(dx) + ",0)");
    });
  }

  function flowNoun(ctx, col) {
    if (col < 0) return "all respondents";
    var g = ctx.banner[col].label, tpl = (ctx.cfg.nouns || {})[ctx.banner[col].dim] || "respondents in the {g} group";
    return tpl.replace("{g}", g).replace("{glc}", g.toLowerCase());
  }
  function flowRow(ctx, col) {
    var t = ctx.q.tables[ctx.state.item];
    return t.answers.map(function (a) { return a.values[col < 0 ? 0 : col] || 0; });
  }
  function flowSentence(ctx, col, a) {
    var t = ctx.q.tables[ctx.state.item], cfg = ctx.cfg;
    var item = t.item ? t.item.charAt(0).toLowerCase() + t.item.slice(1) : "";
    return (cfg.sentence || "{pct} of {noun} {phrase}.")
      .replace("{pct}", pct(flowRow(ctx, col)[a]))
      .replace("{noun}", flowNoun(ctx, col))
      .replace("{phrase}", (cfg.phrases || {})[a] || "answered “" + t.answers[a].label + "”")
      .replace("{item}", item);
  }
  function answerFill(ctx, a) { return "var(--bpcp-" + ((ctx.cfg.colors || {})[a] || "mid") + ")"; }

  function buildFlowUI(ctx) {
    var cfg = ctx.cfg, q = ctx.q, st = ctx.state;
    var ui = h("div", "bpcp-flow-ui");
    if (q.tables.length > 1) {
      var id = "bpcp-item-" + Math.random().toString(36).slice(2, 8);
      var wrap = h("div", "bpcp-flow-item", '<label class="bpcp-filter-label" for="' + id + '">Area</label>');
      var sel = h("select", "bpcp-select");
      sel.id = id;
      q.tables.forEach(function (t, i) {
        var o = h("option", null, esc((cfg.itemLabels || [])[i] || t.item));
        o.value = i;
        sel.appendChild(o);
      });
      sel.value = st.item;
      sel.addEventListener("change", function () { st.item = +sel.value; st.sel = -1; flow.render(ctx, true); renderTable(ctx); });
      wrap.appendChild(sel);
      ui.appendChild(wrap);
    }
    var seg = h("div", "bpcp-seg-ctl");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Ribbon color");
    seg.appendChild(h("span", "bpcp-filter-label", "Ribbon color"));
    [["group", "By group"], ["answer", "By answer"]].forEach(function (o) {
      var b = h("button", "bpcp-btn bpcp-chip", o[1]);
      b.type = "button";
      b.dataset.color = o[0];
      b.addEventListener("click", function () { st.color = o[0]; flow.render(ctx, false); });
      seg.appendChild(b);
    });
    ui.appendChild(seg);
    var ro = h("div", "bpcp-flow-ro",
      '<p class="bpcp-ro-who"></p><p class="bpcp-ro-line"></p><p class="bpcp-ro-vals"></p><p class="bpcp-ro-hint"></p>');
    var chart = h("div", "bpcp-flow-chart");
    var svg = svgEl("svg", { role: "img" });
    chart.appendChild(svg);
    ctx.plot.innerHTML = "";
    ctx.plot.appendChild(ui);
    ctx.plot.appendChild(ro);
    ctx.plot.appendChild(chart);
    ctx.flowUI = { ui: ui, seg: seg, ro: ro, chart: chart, svg: svg, lastW: 0 };

    svg.addEventListener("pointerover", function (e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains("bpcp-rib")) return;
      chart.querySelectorAll(".is-hov").forEach(function (n) { n.classList.remove("is-hov"); });
      t.classList.add("is-hov");
      chart.setAttribute("data-hov", "");
    });
    svg.addEventListener("pointerout", function (e) {
      if (e.target.classList && e.target.classList.contains("bpcp-rib")) {
        e.target.classList.remove("is-hov");
        chart.removeAttribute("data-hov");
      }
    });
    svg.addEventListener("click", function (e) {
      var g = e.target.closest ? e.target.closest("[data-col]") : null;
      if (g) { var c = +g.getAttribute("data-col"); flowSelect(ctx, st.sel === c ? -1 : c); }
      else flowSelect(ctx, -1);
    });
    ctx.card.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && st.sel >= 0) flowSelect(ctx, -1);
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(function () {
        var w = Math.floor(chart.clientWidth);
        if (w !== ctx.flowUI.lastW) drawFlow(ctx, false);
      }).observe(chart);
    }
  }

  function flowSelect(ctx, col) {
    ctx.state.sel = col;
    var chart = ctx.flowUI.chart;
    if (col < 0) chart.removeAttribute("data-sel"); else chart.setAttribute("data-sel", "");
    chart.querySelectorAll("[data-col]").forEach(function (n) {
      var on = +n.getAttribute("data-col") === col;
      n.classList.toggle("is-on", on);
      if (n.classList.contains("bpcp-grp")) n.setAttribute("aria-pressed", String(on));
    });
    flowReadout(ctx);
  }

  function flowReadout(ctx) {
    var ro = ctx.flowUI.ro, col = ctx.state.sel, fd = ctx.flowData, row = flowRow(ctx, col);
    var lead = fd.order[0];
    fd.order.forEach(function (a) { if (row[a] > row[lead]) lead = a; });
    ro.querySelector(".bpcp-ro-who").textContent = col < 0 ? "All respondents" : ctx.banner[col].label;
    ro.querySelector(".bpcp-ro-line").textContent = flowSentence(ctx, col, lead);
    ro.querySelector(".bpcp-ro-vals").innerHTML = fd.order.map(function (a) {
      return '<span><i style="background:' + answerFill(ctx, a) + '"></i>' + esc(fd.t.answers[a].label) + " <b>" + pct(row[a]) + "</b></span>";
    }).join("");
    ro.querySelector(".bpcp-ro-hint").textContent = col < 0
      ? "Select a group, or hover over a ribbon, to see its numbers."
      : "Select the group again, or press Escape, to return to all respondents.";
  }

  function drawFlow(ctx, animate) {
    var fd = ctx.flowData, ui = ctx.flowUI, svg = ui.svg;
    var W = Math.floor(ui.chart.clientWidth);
    if (W < 200) return;  /* hidden or not laid out yet; the ResizeObserver draws it later */
    ui.lastW = W;
    var t = fd.t, A = fd.order, G = fd.shown;
    var narrow = W < 560, fs = narrow ? 12 : 13, lh = fs + 3;
    var gapT = narrow ? 8 : 20, gapB = narrow ? 10 : 24;
    var maxLines = 1;
    var gLines = G.map(function (c) { var l = splitLabel(ctx.banner[c].label, narrow ? 10 : 16); maxLines = Math.max(maxLines, l.length); return l; });
    var yBar = maxLines * lh + 10, capH = 8, yT = yBar + capH, flowH = narrow ? 200 : 260, yB = yT + flowH, nodeH = 8;
    var H = yB + nodeH + 2 * lh + 14;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("aria-label", "Flow chart: each group's answers, sized by the group's share of respondents. The table below lists every value.");

    var shares = G.map(function (c) { return t.n_weighted ? t.n_weighted[c] : t.n_unweighted[c]; });
    var tot = shares.reduce(function (a, b) { return a + b; }, 0) || 1;
    var flows = G.map(function (c, i) {
      var row = flowRow(ctx, c), s = sum(row, A) || 1;
      return A.map(function (a) { return (shares[i] / tot) * (row[a] / s); });
    });
    var uT = W - gapT * (G.length - 1), uB = W - gapB * (A.length - 1);
    var gx = [], nx = [], x = 0;
    G.forEach(function (c, i) { var w = (shares[i] / tot) * uT; gx.push([x, x + w]); x += w + gapT; });
    x = 0;
    A.forEach(function (a, j) {
      var s = 0;
      flows.forEach(function (f) { s += f[j]; });
      nx.push([x, x + s * uB]);
      x += s * uB + gapB;
    });

    var ribs = svgEl("g", { "class": "bpcp-ribs" }, svg), caps = svgEl("g", {}, svg);
    var tc = gx.map(function (q) { return q[0]; }), bc = nx.map(function (q) { return q[0]; }), ym = (yT + yB) / 2;
    G.forEach(function (c, i) {
      var gFill = "var(--bpcp-g" + (i + 1) + ")";
      A.forEach(function (a, j) {
        var f = flows[i][j];
        if (!(f > 0)) return;
        var a0 = tc[i], a1 = a0 + f * uT, b0 = bc[j], b1 = b0 + f * uB;
        tc[i] = a1;
        bc[j] = b1;
        var fill = fd.colorMode === "group" ? gFill : answerFill(ctx, a);
        var d = "M" + r1(a0) + "," + yT + "C" + r1(a0) + "," + r1(ym) + " " + r1(b0) + "," + r1(ym) + " " + r1(b0) + "," + yB +
          "L" + r1(b1) + "," + yB + "C" + r1(b1) + "," + r1(ym) + " " + r1(a1) + "," + r1(ym) + " " + r1(a1) + "," + yT + "Z";
        var p = svgEl("path", { "class": "bpcp-fl bpcp-rib", "data-col": c, d: d, "data-tip": esc(flowSentence(ctx, c, a)) }, ribs);
        p.style.fill = fill;
        p.style.setProperty("--i", i);
        if (fd.colorMode === "answer") {
          var cp = svgEl("rect", { "class": "bpcp-fl bpcp-cap", "data-col": c, x: r1(a0), y: yBar, width: r1(a1 - a0), height: capH }, caps);
          cp.style.fill = fill;
          cp.style.setProperty("--i", i);
        }
      });
      if (fd.colorMode === "group") {
        var bar = svgEl("rect", { "class": "bpcp-fl bpcp-cap", "data-col": c, x: r1(gx[i][0]), y: yBar, width: r1(gx[i][1] - gx[i][0]), height: capH }, caps);
        bar.style.fill = gFill;
        bar.style.setProperty("--i", i);
      }
    });

    var nodes = svgEl("g", {}, svg);
    var aItems = A.map(function (a, j) {
      var n = svgEl("rect", { x: r1(nx[j][0]), y: yB, width: r1(Math.max(1, nx[j][1] - nx[j][0])), height: nodeH }, nodes);
      n.style.fill = answerFill(ctx, a);
      var cx = (nx[j][0] + nx[j][1]) / 2;
      var tx = svgEl("text", { "class": "bpcp-albl", x: r1(cx), y: yB + nodeH + lh + 3, "text-anchor": "middle" }, svg);
      tx.style.fontSize = fs + "px";
      splitLabel(t.answers[a].label, 12).forEach(function (ln, li) {
        svgEl("tspan", { x: r1(cx), dy: li ? lh : 0 }, tx).textContent = ln;
      });
      return { el: tx, cx: cx };
    });
    spreadLabels(aItems, W, 8);

    var gItems = G.map(function (c, i) {
      var cx = (gx[i][0] + gx[i][1]) / 2, hw = Math.max(gx[i][1] - gx[i][0], 32);
      var row = flowRow(ctx, c);
      var grp = svgEl("g", {
        "class": "bpcp-grp", tabindex: 0, role: "button", "data-col": c, "aria-pressed": String(ctx.state.sel === c),
        "aria-label": ctx.banner[c].label + ": " + A.map(function (a) { return pct(row[a]) + " " + t.answers[a].label; }).join(", ")
      }, svg);
      svgEl("rect", { "class": "bpcp-hit", x: r1(cx - hw / 2), y: 0, width: r1(hw), height: yT + 6 }, grp);
      svgEl("rect", { "class": "bpcp-ring", x: r1(gx[i][0] - 3), y: yBar - 3, width: r1(gx[i][1] - gx[i][0] + 6), height: capH + 6, rx: 3 }, grp);
      var tx = svgEl("text", { "class": "bpcp-glbl", x: r1(cx), y: yBar - 8 - (gLines[i].length - 1) * lh, "text-anchor": "middle" }, grp);
      tx.style.fontSize = fs + "px";
      gLines[i].forEach(function (ln, li) { svgEl("tspan", { x: r1(cx), dy: li ? lh : 0 }, tx).textContent = ln; });
      grp.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flowSelect(ctx, ctx.state.sel === c ? -1 : c); }
      });
      return { el: tx, cx: cx };
    });
    spreadLabels(gItems, W, 8);
    flowSelect(ctx, ctx.state.sel);

    if (animate && !reduced()) {
      svg.classList.add("bpcp-enter");
      void svg.getBoundingClientRect();
      requestAnimationFrame(function () { svg.classList.remove("bpcp-enter"); });
    }
  }

  var flow = {
    render: function (ctx, animate) {
      var cfg = ctx.cfg, st = ctx.state;
      if (st.item == null) st.item = cfg.table || 0;
      if (!st.color) st.color = cfg.color || "group";
      if (st.sel == null) st.sel = -1;
      if (!ctx.flowUI) buildFlowUI(ctx);
      var t = ctx.q.tables[st.item];
      var cols = ctx.colsFor(st.dim);
      var shown = cols.filter(function (c) { return t.n_unweighted[c] >= ctx.minN; });
      var dropped = cols.filter(function (c) { return t.n_unweighted[c] < ctx.minN; });
      var many = shown.length > GROUP_HUES;
      if (shown.indexOf(st.sel) < 0) st.sel = -1;
      ctx.flowData = { t: t, order: cfg.order || t.answers.map(function (a, i) { return i; }),
                       shown: shown, dropped: dropped, colorMode: many ? "answer" : st.color };
      ctx.flowUI.seg.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.color === ctx.flowData.colorMode));
        b.disabled = many && b.dataset.color === "group";
        b.title = b.disabled ? "More than " + GROUP_HUES + " groups: colored by answer" : "";
      });
      setLegend(ctx, []);
      ctx.legend.hidden = true;
      drawFlow(ctx, animate);
      flowReadout(ctx);
      var notes = ["Bar widths show each group's weighted share of respondents."];
      if (dropped.length) notes.push("Not shown, fewer than " + ctx.minN + " respondents: " +
        dropped.map(function (c) { return ctx.banner[c].label + " (n = " + fmtN(t.n_unweighted[c]) + ")"; }).join(", ") + ".");
      setFoot(ctx, t.n_unweighted[0], notes.join(" "));
    },
    intro: function (ctx) {
      var svg = ctx.flowUI.svg;
      svg.classList.add("bpcp-enter");
      void svg.getBoundingClientRect();
      requestAnimationFrame(function () { svg.classList.remove("bpcp-enter"); });
    },
    table: function (ctx) {
      var fd = ctx.flowData, t = fd.t;
      var head = ["Group"].concat(fd.order.map(function (a) { return t.answers[a].label; }), ["n"]);
      var rows = [0].concat(fd.shown, fd.dropped).map(function (c) {
        var small = t.n_unweighted[c] < ctx.minN;
        return [c === 0 ? "All respondents" : ctx.banner[c].label]
          .concat(fd.order.map(function (a) { return small ? "—" : pct(t.answers[a].values[c]); }), [fmtN(t.n_unweighted[c])]);
      });
      return { head: head, rows: rows };
    }
  };

  var VIEWS = { stack: stack, rank: rank, hero: hero, flow: flow };

  /* ---------- scrollytelling ----------
   * A sticky stage beside (or, in a narrow column, above) a list of text steps.
   * As each step crosses the middle of the screen, the stage redraws.
   * It runs in the page, never in an iframe, so the page's own scroll drives it.
   *
   * Stage modes, one per step:
   *   dots       100 squares (1% each); `table` + `ans` fills a share in `color`
   *   bars       ranked bars for one question (`q`, `table`, `top`, `hide`, `color`)
   *   partition  100 squares split across a question's answers (`colors`, `order`)
   *
   * Step text is a template: {pct} the highlighted share, {n} the step's base,
   * {top1} / {top1pct} the leading answer, {pct:2} answer 2's share.
   * Every number a reader needs is in the text, so the story reads without the graphic.
   */

  function largestRemainder(vals, total) {
    var raw = vals.map(function (v) { return v * total; });
    var out = raw.map(Math.floor);
    var left = total - out.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; })
      .sort(function (a, b) { return b.f - a.f; })
      .slice(0, Math.max(0, left)).forEach(function (o) { out[o.i] += 1; });
    return out;
  }

  function stepFacts(data, s) {
    var q = data.questions[s.q], t = q.tables[s.table || 0];
    var vals = t.answers.map(function (a) { return a.values[0] || 0; });
    var hide = s.hide || [];
    var ranked = vals.map(function (v, i) { return i; }).filter(function (i) { return hide.indexOf(i) < 0; })
      .sort(function (a, b) { return vals[b] - vals[a]; });
    return { q: q, t: t, vals: vals, ranked: ranked, n: t.n_unweighted[0],
             pct: s.ans != null ? vals[s.ans] : null };
  }

  function fillText(tpl, f) {
    return tpl.replace(/\{(\w+)(?::(\d+))?\}/g, function (m, key, arg) {
      if (key === "pct") return pct(arg != null ? f.vals[+arg] : f.pct);
      if (key === "n") return fmtN(f.n);
      if (key === "top1") return f.t.answers[f.ranked[0]].label;
      if (key === "top1pct") return pct(f.vals[f.ranked[0]]);
      return m;
    });
  }

  function mountScrolly(root, cfg, data) {
    data = data || window.BPCP_DATA;
    root.classList.add("bpcp", "bpcp-scrolly");
    root.innerHTML = "";
    var steps = cfg.steps.map(function (s) { return { s: s, f: stepFacts(data, s) }; });

    var grid = h("div", "bpcp-sc-grid");
    var stage = h("div", "bpcp-sc-stage");
    stage.setAttribute("aria-hidden", "true");  /* the step text carries every number */
    stage.innerHTML =
      '<p class="bpcp-eyebrow bpcp-sc-label"></p>' +
      '<div class="bpcp-sc-views"><div class="bpcp-sc-dots"></div><div class="bpcp-sc-bars bpcp-rank"></div></div>' +
      '<ul class="bpcp-legend bpcp-sc-legend"></ul>';
    var dots = stage.querySelector(".bpcp-sc-dots");
    for (var i = 0; i < 100; i++) dots.appendChild(h("span", "bpcp-sc-dot"));
    var list = h("ol", "bpcp-sc-steps");
    steps.forEach(function (st, k) {
      var li = h("li", "bpcp-sc-step");
      li.dataset.i = k;
      li.innerHTML = '<div class="bpcp-sc-card">' + (st.s.kicker ? '<p class="bpcp-eyebrow">' + esc(st.s.kicker) + "</p>" : "") +
        "<p>" + esc(fillText(st.s.text, st.f)) + "</p></div>";
      list.appendChild(li);
    });
    grid.appendChild(stage);
    grid.appendChild(list);
    root.appendChild(grid);

    /* a plain table of every figure in the story, for screen readers and skimmers */
    var det = h("details", "bpcp-table bpcp-sc-table");
    det.appendChild(h("summary", null, "Show the numbers"));
    var rows = [];
    steps.forEach(function (st) {
      var s = st.s, f = st.f;
      if (s.mode === "dots") rows.push([f.t.item || f.q.title, pct(f.pct), fmtN(f.n)]);
      else f.ranked.forEach(function (i) { rows.push([f.q.id + ": " + f.t.answers[i].label, pct(f.vals[i]), fmtN(f.n)]); });
    });
    det.innerHTML += '<div class="bpcp-scroll"><table><thead><tr><th scope="col">Answer</th><th scope="col">Share</th><th scope="col">n</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + "</th><td>" + r[1] + "</td><td>" + r[2] + "</td></tr>"; }).join("") +
      "</tbody></table></div>";
    root.appendChild(det);
    root.appendChild(h("p", "bpcp-foot", "<span>" + esc(cfg.source || "Source: PF Global poll for the Bipartisan Policy Center. PLACEHOLDER DATA.") + "</span>"));

    var ctx = { root: root, stage: stage, dots: dots, steps: steps, list: list, cur: -1 };
    root.__bpcpScrolly = ctx;
    setStep(ctx, 0);

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) setStep(ctx, +en.target.dataset.i); });
      }, { rootMargin: "-48% 0px -48% 0px" });  /* a step is current while it crosses the screen's middle */
      list.querySelectorAll(".bpcp-sc-step").forEach(function (li) { io.observe(li); });
    }
    return ctx;
  }

  function setStep(ctx, k) {
    if (k === ctx.cur) return;
    ctx.cur = k;
    var s = ctx.steps[k].s, f = ctx.steps[k].f, stage = ctx.stage;
    ctx.list.querySelectorAll(".bpcp-sc-step").forEach(function (li) {
      li.classList.toggle("is-current", +li.dataset.i === k);
    });
    stage.querySelector(".bpcp-sc-label").textContent = fillText(s.label || "", f);
    var legend = stage.querySelector(".bpcp-sc-legend");
    var cells = ctx.dots.children;
    var mode = s.mode === "bars" ? "bars" : "dots";
    stage.dataset.mode = mode;

    if (s.mode === "dots") {
      var on = Math.round((f.pct || 0) * 100);
      Array.prototype.forEach.call(cells, function (c, i) {
        c.className = "bpcp-sc-dot" + (i < on ? " c-" + (s.color || "p1") : "");
        c.style.transitionDelay = (reduced() ? 0 : i * 6) + "ms";
      });
      legend.innerHTML = on ? '<li><span class="bpcp-sw c-' + (s.color || "p1") + '"></span>' + esc(s.legend || "") + "</li>" +
        '<li><span class="bpcp-sw bpcp-sw-off"></span>Everyone else</li>' : '<li><span class="bpcp-sw bpcp-sw-off"></span>Each square is 1% of respondents</li>';
    } else if (s.mode === "partition") {
      var order = s.order || f.vals.map(function (v, i) { return i; });
      var counts = largestRemainder(order.map(function (i) { return f.vals[i]; }), 100);
      var flat = [];
      order.forEach(function (a, j) { for (var c = 0; c < counts[j]; c++) flat.push(a); });
      Array.prototype.forEach.call(cells, function (c, i) {
        var a = flat[i];
        c.className = "bpcp-sc-dot" + (a != null ? " c-" + (s.colors[a] || "mid") : "");
        c.style.transitionDelay = (reduced() ? 0 : i * 6) + "ms";
      });
      legend.innerHTML = order.map(function (a) {
        return '<li><span class="bpcp-sw c-' + (s.colors[a] || "mid") + '"></span>' + esc((s.short || {})[a] || f.t.answers[a].label) + "</li>";
      }).join("");
    } else {
      var bars = stage.querySelector(".bpcp-sc-bars");
      var top = f.ranked.slice(0, s.top || 5);
      var max = Math.min(1, Math.ceil(f.vals[top[0]] * 10) / 10) || 1;
      bars.innerHTML = top.map(function (i, j) {
        return '<div class="bpcp-rrow"><div class="bpcp-rlabel">' + esc(f.t.answers[i].label) + "</div>" +
          '<div class="bpcp-rbar"><div class="bpcp-rtrack"><div class="bpcp-rfill c-' + (s.color || "p1") + '" style="width:0;--i:' + j + '"></div></div>' +
          '<div class="bpcp-rval">' + pct(f.vals[i]) + "</div></div></div>";
      }).join("");
      var fills = bars.querySelectorAll(".bpcp-rfill");
      void bars.offsetWidth;
      requestAnimationFrame(function () {
        fills.forEach(function (el, j) { el.style.width = (f.vals[top[j]] / max * 100).toFixed(2) + "%"; });
      });
      legend.innerHTML = "";
    }
  }

  /* ---------- download image (cfg.download) ----------
   * Draws the card's current view onto a canvas from the data, not from the
   * page, so it works the same in every browser and needs no library. Only
   * views with an image() method offer it (rank, for now). The PNG carries
   * the question, the group shown, the bars, and the source line.
   */
  function addDownload(ctx) {
    if (!ctx.cfg.download || !ctx.view.image || !window.HTMLCanvasElement) return;
    var b = h("button", "bpcp-btn bpcp-dl", icon("download") + "<span>Download image</span>");
    b.type = "button";
    b.addEventListener("click", function () {
      var go = function () { saveImage(ctx); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
    });
    ctx.card.insertBefore(b, ctx.foot);  /* right under the chart, above the notes */
  }

  function wrapText(c, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function cssVar(ctx, name) { return getComputedStyle(ctx.root).getPropertyValue(name).trim(); }

  function saveImage(ctx) {
    var spec = ctx.view.image(ctx);
    var W = 1200, PAD = 56, S = 1;
    var sans = cssVar(ctx, "--bpcp-sans") || "Arial, sans-serif";
    var serif = cssVar(ctx, "--bpcp-serif") || "Georgia, serif";
    var ink = cssVar(ctx, "--bpcp-ink") || "#16202b", muted = cssVar(ctx, "--bpcp-muted") || "#566372";
    var bar = cssVar(ctx, "--bpcp-bar") || "#2f6299", track = cssVar(ctx, "--bpcp-track") || "#eef1f4";
    var navy = cssVar(ctx, "--bpcp-navy") || "#1f476c";
    var cv = document.createElement("canvas"), c = cv.getContext("2d");
    var labelW = 430, barX = PAD + labelW + 24, valW = 80, barW = W - PAD - valW - barX;

    // measure pass, then draw pass, so the canvas is exactly as tall as the content
    function layout(draw) {
      var y = PAD;
      c.textBaseline = "top";
      c.font = "600 20px " + sans;
      if (draw) { c.fillStyle = muted; c.fillText(spec.eyebrow.toUpperCase(), PAD, y); }
      y += 34;
      c.font = "700 34px " + serif;
      wrapText(c, spec.title, W - 2 * PAD).forEach(function (l) { if (draw) { c.fillStyle = ink; c.fillText(l, PAD, y); } y += 44; });
      y += 10;
      c.font = "600 22px " + sans;
      if (draw) {
        c.fillStyle = bar; c.fillRect(PAD, y + 4, 18, 18);
        c.fillStyle = ink; c.fillText(spec.group, PAD + 28, y + 2);
        if (spec.tickLabel) {
          var x = PAD + 28 + c.measureText(spec.group).width + 36;
          c.fillStyle = ink; c.fillRect(x + 8, y, 3, 26);
          c.fillText(spec.tickLabel, x + 24, y + 2);
        }
      }
      y += 48;
      spec.rows.forEach(function (r) {
        c.font = "400 22px " + sans;
        var lines = wrapText(c, r.label, labelW);
        var rowH = Math.max(36, lines.length * 28) + 14;
        if (draw) {
          c.fillStyle = ink;
          lines.forEach(function (l, i) { c.fillText(l, PAD, y + i * 28 + (rowH - 14 - lines.length * 28) / 2 + 2); });
          var by = y + (rowH - 14 - 30) / 2;
          c.fillStyle = track; c.fillRect(barX, by, barW, 30);
          c.fillStyle = bar; c.fillRect(barX, by, Math.max(2, barW * r.value / spec.max), 30);
          if (r.tick != null) { c.fillStyle = ink; c.fillRect(barX + barW * r.tick / spec.max - 1.5, by - 5, 3, 40); }
          c.font = "700 22px " + sans; c.textAlign = "right";
          c.fillText(r.text, W - PAD, by + 4);
          c.textAlign = "left";
        }
        y += rowH;
      });
      y += 18;
      c.font = "400 17px " + sans;
      spec.notes.forEach(function (n) {
        wrapText(c, n, W - 2 * PAD).forEach(function (l) { if (draw) { c.fillStyle = muted; c.fillText(l, PAD, y); } y += 24; });
      });
      y += 16;
      if (draw) { c.fillStyle = navy; c.fillRect(PAD, y, W - 2 * PAD, 3); }
      y += 16;
      c.font = "700 19px " + sans;
      if (draw) { c.fillStyle = navy; c.fillText("Bipartisan Policy Center", PAD, y); }
      y += 28 + PAD - 16;
      return y;
    }
    var H = layout(false);
    cv.width = W * S; cv.height = H * S;
    c.scale(S, S);
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    layout(true);
    cv.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = spec.file + ".png";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, "image/png");
  }

  /* ---------- public API ---------- */

  function mountAll(scope, data) {
    (scope || document).querySelectorAll("[data-bpcp]").forEach(function (el) {
      if (el.__bpcp || el.__bpcpScrolly) return;
      try {
        var cfg = JSON.parse(el.getAttribute("data-bpcp"));
        if (cfg.view === "scrolly") mountScrolly(el, cfg, data); else mount(el, cfg, data);
      }
      catch (err) { el.textContent = "Chart could not load: " + err.message; }
    });
  }

  function replayAll() {
    document.querySelectorAll(".bpcp").forEach(function (el) {
      var ctx = el.__bpcp;
      if (!ctx) return;
      if (ctx.view === hero) heroReset(ctx);
      play(ctx);
    });
  }

  /* ---------- WordPress boot ----------
   * <script src=".../poll-embed.js" data-src=".../poll_data.json" defer>
   * fetches the data once, then mounts every [data-bpcp] element on the page.
   * Without data-src (the workbench, which inlines its data) nothing auto-mounts.
   */
  function boot() {
    var src = SCRIPT ? SCRIPT.getAttribute("data-src") : null;
    if (!src) return;
    var els = document.querySelectorAll("[data-bpcp]");
    if (!els.length) return;
    fetch(src, { credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("data file returned " + r.status);
        return r.json();
      })
      .then(function (d) {
        window.BPCP_DATA = d;
        mountAll(document, d);
      })
      .catch(function (err) {
        els.forEach(function (el) {
          el.classList.add("bpcp", "is-error");
          el.textContent = "This chart could not load. The figures are in the text of this page.";
        });
        if (window.console) console.error("BPCPoll:", err);
      });
  }

  // Closed <details> print empty, so open every numbers table for printing.
  window.addEventListener("beforeprint", function () {
    document.querySelectorAll(".bpcp details").forEach(function (d) { d.open = true; });
  });

  window.BPCPoll = { mount: mount, mountScrolly: mountScrolly, mountAll: mountAll, replayAll: replayAll, icons: ICONS, version: "0.5.0" };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
