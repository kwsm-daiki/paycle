// Paycle の画面。計算は calc.js（PaycleCalc）。
// 文字はすべて textContent で出す（innerHTML は使わない）。style は CSSOM で入れる（CSP のため）。
"use strict";

(function () {
  var C = window.PaycleCalc;
  var APP_VERSION = "0.1.0";
  var KEY = "paycle:data";
  var KEY_PLANS = "paycle:plans";
  var KEY_SORT = "paycle:sort";
  var KEY_HINT = "paycle:hintUsage";
  var KEY_EXPORT_HIDE = "paycle:exportHide";
  var DEV = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var params = new URLSearchParams(location.search);

  // ---------- 小さな道具 ----------

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "text") n.textContent = v;
        else if (k === "cls") n.className = v;
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
        else if (k === "value") n.value = v;
        else if (k === "checked") n.checked = !!v;
        else n.setAttribute(k, v === true ? "" : v);
      }
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function yen(v) { return "¥" + Math.round(v).toLocaleString("ja-JP"); }
  var DOW = ["日", "月", "火", "水", "木", "金", "土"];
  function md(s) { return +s.slice(5, 7) + "/" + +s.slice(8, 10); }
  function mdw(s) {
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    return m + "/" + d + "(" + DOW[new Date(y, m - 1, d).getDay()] + ")";
  }
  function rid() {
    var a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  // 今日。試験用サーバー（localhost）のときだけ ?today=YYYY-MM-DD を読む
  function today() {
    if (DEV && C.isDate(params.get("today"))) return params.get("today");
    return C.todayStr();
  }

  // 小さな絵（線の絵）
  function iconSvg(name, size) {
    var paths = {
      home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
      cal: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5",
      chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
      gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
      clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
      warn: "M12 3 2 20h20zM12 10v4M12 17v.5"
    };
    var s = size || 24;
    return svg("svg", { viewBox: "0 0 24 24", width: s, height: s, fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      [svg("path", { d: paths[name] })]);
  }

  // ---------- データ ----------

  var state = {
    data: null,
    broken: false,     // paycle:data が読めない。保存を止める
    plans: null,
    today: today(),
    calMonth: null,
    calSel: null,
    barSel: null,
    pieBy: "service",
    showCancelled: false,
    form: null,        // 追加・編集の中身
    formDirty: false,
    sheet: null,       // 開いているシートを閉じる関数
    trialAsked: {}     // この起動で聞いた体験
  };

  function emptyData() {
    return { app: "paycle", version: C.CURRENT_VERSION, lastOpened: null, lastExport: null, notice: null, items: [] };
  }

  // 最後に保存できた中身。保存に失敗したら、画面の中のデータをこれに戻す（保存されていない変更を残さない）
  var lastSaved = null;
  function loadData() {
    var raw = lsGet(KEY);
    if (raw === null) { state.data = emptyData(); lastSaved = JSON.stringify(state.data); return; }
    try {
      var obj = JSON.parse(raw);
      var err = C.validateData(obj);
      if (err) throw new Error(err);
      state.data = C.migrate(obj);
      lastSaved = JSON.stringify(state.data);
    } catch (e) {
      // 空で始めると次の保存で消えるので、退避して保存を止める
      lsSet(KEY + ".broken", raw);
      state.broken = true;
      state.data = emptyData();
      lastSaved = JSON.stringify(state.data);
    }
  }

  function save() {
    if (state.broken) {
      state.data = JSON.parse(lastSaved);
      toast("データが読めないため、保存を止めています");
      return false;
    }
    var json = JSON.stringify(state.data);
    try {
      if (DEV && params.get("failsave") === "1") throw new Error("test");
      localStorage.setItem(KEY, json);
      lastSaved = json;
      return true;
    } catch (e) {
      state.data = JSON.parse(lastSaved);
      toast("保存できませんでした（スマホの保存場所がいっぱいかもしれません）");
      return false;
    }
  }

  function findItem(id) {
    for (var i = 0; i < state.data.items.length; i++) if (state.data.items[i].id === id) return state.data.items[i];
    return null;
  }

  // ---------- プランの表 ----------

  function plansOk(p) {
    return p && typeof p === "object" && p.version === 1 && Array.isArray(p.services);
  }
  function loadPlans() {
    try {
      var p = JSON.parse(lsGet(KEY_PLANS));
      if (plansOk(p)) state.plans = p;
    } catch (e) { /* なければ null のまま */ }
    fetch("./plans.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (p) {
        if (!plansOk(p)) return; // 知らない版なら保存してあるものを使う
        var changed = JSON.stringify(p) !== JSON.stringify(state.plans);
        state.plans = p;
        lsSet(KEY_PLANS, JSON.stringify(p));
        if (changed && !state.form) render();
      })
      .catch(function () { /* 読めなければ保存してあるもの */ });
  }
  function services() {
    if (!state.plans) return [];
    return state.plans.services.slice().sort(function (a, b) { return a.kana < b.kana ? -1 : a.kana > b.kana ? 1 : 0; });
  }
  function serviceOf(id) {
    var list = services();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function planOf(svc, planId) {
    if (!svc) return null;
    for (var i = 0; i < svc.plans.length; i++) if (svc.plans[i].id === planId) return svc.plans[i];
    return null;
  }

  // サービスのアイコン。プリセットは svc/ の PNG、なければ・読めなければ頭文字の四角
  function avatar(item, size) {
    var cls = "ic" + (size ? " " + size : "");
    var svc = item.kind !== "saving" && item.presetId ? serviceOf(item.presetId) : null;
    var letter = el("span", { cls: cls + " cat-" + (item.category || "other"), text: (item.name || "?").trim().charAt(0).toUpperCase(), "aria-hidden": "true" });
    if (!svc || !svc.icon) return letter;
    var box = el("span", { cls: cls, "aria-hidden": "true" });
    var img = el("img", { src: svc.icon, alt: "", loading: "lazy" });
    img.addEventListener("error", function () { if (box.parentNode) box.parentNode.replaceChild(letter, box); });
    box.appendChild(img);
    return box;
  }

  // ---------- 画面の切り替え（URL の # と「戻る」） ----------

  var TABS = [
    { id: "home", label: "ホーム", icon: "home" },
    { id: "calendar", label: "カレンダー", icon: "cal" },
    { id: "analysis", label: "分析", icon: "chart" },
    { id: "settings", label: "設定", icon: "gear" }
  ];
  function route() {
    var h = location.hash.replace(/^#/, "") || "home";
    var parts = h.split("/");
    return { name: parts[0], arg: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  function go(hash) {
    var cur = route().name;
    var isTab = TABS.some(function (t) { return "#" + t.id === hash; });
    // タブどうしの移動はホームから出るときだけ積む（どのタブでも「戻る」でホーム → もう一度でアプリを閉じる）
    if (isTab && cur !== "home" && (cur === "savings" || TABS.some(function (t) { return t.id === cur; }))) {
      if (hash === "#home") { history.back(); return; }
      history.replaceState(null, "", hash);
      render();
    } else {
      location.hash = hash;
    }
  }

  function closeSheetUI() {
    var root = document.getElementById("sheet-root");
    root.textContent = "";
    state.sheet = null;
  }

  // シートを開く。「戻る」で閉じるよう、history に1つ積む
  function openSheet(title, build) {
    if (state.sheet) closeSheetUI();
    var root = document.getElementById("sheet-root");
    var sheet = el("div", { cls: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title });
    var overlay = el("div", { cls: "overlay" }, [sheet]);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSheet(); });
    if (title) sheet.appendChild(el("h2", { text: title }));
    build(sheet);
    root.appendChild(overlay);
    state.sheet = true;
    history.pushState({ sheet: true }, "", location.hash || "#home");
  }
  // シートを閉じる。シートの分の履歴を戻し、戻り終わってから then を呼ぶ
  // （すぐ次のシートを開くと、あとから来る「戻る」でそれが閉じてしまうため）
  var afterBack = null;
  function closeSheet(then) {
    closeSheetUI();
    if (history.state && history.state.sheet) {
      afterBack = then || null;
      history.back();
    } else if (then) {
      then();
    }
  }

  // 「戻る」・# の変化。Chrome は # の変化で popstate と hashchange の両方を出すので、描いた # と同じなら何もしない
  var lastHash = null;
  function onNav(e) {
    if (afterBack && e.type === "popstate") { var f = afterBack; afterBack = null; f(); return; }
    if (state.sheet) { if (e.type === "popstate") closeSheetUI(); return; }
    if (location.hash === lastHash) return;
    var r = route();
    if (state.form && state.formDirty && r.name !== "edit" && r.name !== "new") {
      if (!confirm("入力した内容を破棄しますか？")) {
        history.pushState(null, "", state.form.hash);
        return;
      }
    }
    render();
  }
  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);

  // ---------- 知らせ（下に出る） ----------

  var toastTimer = null;
  function toast(msg, actionLabel, action, ms) {
    var t = document.getElementById("toast");
    t.textContent = "";
    t.appendChild(el("span", { text: msg }));
    if (actionLabel) {
      t.appendChild(el("button", { text: actionLabel, onclick: function () { t.hidden = true; action(); } }));
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3000);
  }

  // ---------- 描く ----------

  function render() {
    state.today = today();
    lastHash = location.hash;
    var r = route();
    var app = document.getElementById("app");
    app.textContent = "";
    var editing = r.name === "edit" || r.name === "new";
    document.body.classList.toggle("no-tabs", editing);
    if (!editing) { state.form = null; state.formDirty = false; pendingCommit = null; }
    renderTabs(r.name);
    if (r.name === "calendar") renderCalendar(app);
    else if (r.name === "analysis") renderAnalysis(app);
    else if (r.name === "settings") renderSettings(app);
    else if (r.name === "savings") renderSavings(app);
    else if (editing) renderEdit(app, r);
    else renderHome(app);
    window.scrollTo(0, 0);
  }

  function renderTabs(cur) {
    var nav = document.getElementById("tabs");
    nav.textContent = "";
    TABS.forEach(function (t) {
      nav.appendChild(el("button", {
        "aria-current": (cur === t.id || (cur === "savings" && t.id === "home")) ? "page" : null,
        onclick: function () { if (cur !== t.id) go("#" + t.id); }
      }, [iconSvg(t.icon), el("span", { text: t.label })]));
    });
  }

  function brokenBanner(app) {
    if (!state.broken) return;
    app.appendChild(el("div", { cls: "banner", text: "データが読めません。設定の「読み込む」で控えから戻してください。（読めなかったデータは消さずに残しています。今は保存を止めています）" }));
  }

  // ---------- ホーム ----------

  function renderHome(app) {
    var items = state.data.items;
    var t = state.today;
    var s = C.summary(items, t);
    brokenBanner(app);

    // 合計
    var card = el("div", { cls: "card" }, [
      el("div", { cls: "total-label", text: "サブスク 月あたり" }),
      el("div", { cls: "total-big", text: yen(s.monthly) }),
      el("div", { cls: "total-sub", text: "年 " + yen(s.yearly) + " ・ " + s.count + "件 ・ 今月あと " + yen(s.restOfMonth) +
        (s.missing ? " ・ 金額未入力 " + s.missing + "件" : "") })
    ]);
    if (s.unusedMonthly > 0) card.appendChild(el("div", { cls: "total-unused", text: "使っていない " + yen(s.unusedMonthly) + "/月" }));
    if (s.savingCount) {
      var savings = items.filter(function (it) { return it.kind === "saving" && !it.cancelled; });
      card.appendChild(el("button", {
        cls: "saving-row",
        onclick: function () { go(savings.length === 1 ? "#edit/" + encodeURIComponent(savings[0].id) : "#savings"); }
      }, [el("span", { text: "積立（別枠）" }), el("strong", { text: "月 " + yen(s.savingMonthly) })]));
    }
    app.appendChild(card);

    // 期限が近いものの帯
    C.alerts(items, t).forEach(function (a) {
      var when = a.days === 0 ? "今日" : a.days === 1 ? "明日" : "あと" + a.days + "日";
      var what = a.type === "trial"
        ? a.item.name + " の無料体験が終わる（" + md(a.date) + "）"
        : a.item.name + " の" + (a.item.kind === "saving" ? "引き落とし" : "請求") + "（" + md(a.date) + "）" + priceText(a.item, a.date);
      app.appendChild(el("button", {
        cls: "alert " + a.level,
        onclick: function () { go("#edit/" + encodeURIComponent(a.item.id)); }
      }, [iconSvg(a.level === "red" ? "warn" : "clock", 22), el("span", { cls: "when", text: when }), el("span", { cls: "what", text: what })]));
    });

    // 1行の知らせ（前回から○件・書き出し）
    var notices = el("div", { cls: "notices" });
    var n = state.data.notice;
    if (n && n.count) {
      notices.appendChild(noticeBox("前回（" + md(n.from) + "）から " + n.count + "件 の請求日が過ぎました", null, function () {
        state.data.notice = null; save(); render();
      }));
    }
    var ex = C.exportDue(state.data, t);
    var hide = lsGet(KEY_EXPORT_HIDE);
    if (ex && !(hide && C.isDate(hide) && C.diffDays(hide, t) < 7)) {
      notices.appendChild(noticeBox("控えを" + ex.days + "日書き出していません", function () { go("#settings"); }, function () {
        lsSet(KEY_EXPORT_HIDE, t); render();
      }));
    }
    if (notices.childNodes.length) app.appendChild(notices);

    var subs = items.filter(function (it) { return it.kind !== "saving"; });
    var active = subs.filter(function (it) { return !it.cancelled; });
    var cancelled = subs.filter(function (it) { return it.cancelled; });

    if (!active.length) {
      renderEmptyHome(app);
    } else {
      var sortKey = lsGet(KEY_SORT) || "next";
      var SORTS = { next: "請求日", high: "高い順", low: "安い順", "new": "新しい順" };
      if (!SORTS[sortKey]) sortKey = "next";
      app.appendChild(el("div", { cls: "list-head" }, [
        el("div", { cls: "section-title", text: "サブスク" }),
        el("button", { cls: "chip-btn", text: "並べ替え: " + SORTS[sortKey] + " ▾", onclick: function () {
          openSheet("並べ替え", function (sh) {
            Object.keys(SORTS).forEach(function (k) {
              sh.appendChild(el("button", { cls: "opt", role: "menuitemradio", "aria-checked": k === sortKey ? "true" : "false", text: SORTS[k],
                onclick: function () { lsSet(KEY_SORT, k); closeSheet(render); } }));
            });
          });
        } })
      ]));
      var list = el("div", { cls: "list" });
      C.sortItems(active, sortKey, t).forEach(function (it) { list.appendChild(itemRow(it)); });
      app.appendChild(list);
      if (!lsGet(KEY_HINT)) {
        app.appendChild(el("p", { cls: "small", text: "行を長押しすると、使う頻度を付けられます" }));
        lsSet(KEY_HINT, "1");
      }
    }

    if (cancelled.length) {
      var sv = C.saved(items);
      app.appendChild(el("button", {
        cls: "fold", "aria-expanded": state.showCancelled ? "true" : "false",
        text: (state.showCancelled ? "▾ " : "▸ ") + "解約済み " + cancelled.length + "件（月 " + yen(sv.monthly) + " 浮いた）",
        onclick: function () { state.showCancelled = !state.showCancelled; render(); }
      }));
      if (state.showCancelled) {
        var cl = el("div", { cls: "list" });
        cancelled.forEach(function (it) { cl.appendChild(itemRow(it)); });
        app.appendChild(cl);
      }
    }

    app.appendChild(el("button", { cls: "fab", "aria-label": "追加", text: "+", onclick: function () { go("#new"); } }));
    askPendingTrial();
  }

  function priceText(item, date) {
    var y = C.priceOn(item, date);
    return y === null ? "" : " " + yen(y);
  }

  function noticeBox(msg, onTap, onClose) {
    return el("div", { cls: "notice" }, [
      el("button", { cls: "msg", text: msg, onclick: onTap || null }),
      el("button", { cls: "x", "aria-label": "閉じる", text: "×", onclick: onClose })
    ]);
  }

  function renderEmptyHome(app) {
    var list = services();
    if (list.length) {
      app.appendChild(el("div", { cls: "section-title", text: "サービスから追加" }));
      var grid = el("div", { cls: "preset-grid" });
      list.forEach(function (svc) {
        grid.appendChild(el("button", { cls: "preset", onclick: function () { go("#new/" + encodeURIComponent(svc.id)); } },
          [avatar({ name: svc.name, presetId: svc.id, category: svc.category, kind: "sub" }), el("span", { text: svc.name })]));
      });
      app.appendChild(grid);
    }
    app.appendChild(el("button", { cls: "btn block", text: "自分で入れる", onclick: function () { go("#new/_custom"); } }));
    app.lastChild.style.marginTop = "12px";
  }

  function itemRow(it) {
    var t = state.today;
    var meta = el("div", { cls: "meta" });
    if (it.cancelled) {
      meta.appendChild(el("span", { text: it.lastPaid ? "最後に払った日 " + md(it.lastPaid) : "解約済み" }));
      if (it.restartedTo) meta.appendChild(el("span", { cls: "tag", text: "再開済み" }));
    } else if (it.trial && !it.trialResolved && t <= it.anchor) {
      meta.appendChild(el("span", { text: "体験 ～" + md(it.anchor) }));
    } else {
      var nb = C.nextBill(it, t);
      // 今年でない日は年も出す（年払いの「11/23」を今月と読み違えないように）
      meta.appendChild(el("span", { text: nb ? "次 " + (nb.slice(0, 4) !== t.slice(0, 4) ? nb.slice(0, 4) + "/" : "") + mdw(nb) : "" }));
    }
    var y = C.priceOn(it, t);
    if (y === null) meta.appendChild(el("span", { cls: "tag warn", text: "金額未入力" }));
    if (!it.cancelled) {
      var f = C.usageFlag(it, t);
      if (f === "never") meta.appendChild(el("span", { cls: "tag", text: "使っていない" }));
      if (f === "stale") meta.appendChild(el("button", { cls: "tag warn", text: "まだ使っていない？", onclick: function (e) { e.stopPropagation(); usageSheet(it); } }));
      if (f === "unset") meta.appendChild(el("button", { cls: "tag", text: "頻度？", onclick: function (e) { e.stopPropagation(); usageSheet(it); } }));
    }
    var price = el("div", { cls: "price" });
    if (y !== null) {
      if (it.cycle === "year") {
        price.appendChild(document.createTextNode(yen(y) + "/年"));
        price.appendChild(el("span", { cls: "per", text: "月 " + yen(y / 12) }));
      } else {
        price.appendChild(document.createTextNode(yen(y)));
      }
    }
    var plan = it.presetId && it.planId ? planOf(serviceOf(it.presetId), it.planId) : null;
    var row = el("button", { cls: "row" }, [avatar(it), el("div", { cls: "main" }, [
      el("div", { cls: "name", text: it.name }),
      plan ? el("div", { cls: "plan", text: plan.name }) : null,
      meta
    ]), price]);
    longPress(row, function () { go("#edit/" + encodeURIComponent(it.id)); }, it.cancelled ? null : function () { usageSheet(it); });
    return row;
  }

  // タップと長押し（0.5秒）を分ける
  function longPress(node, onTap, onLong) {
    var timer = null, fired = false, sx = 0, sy = 0;
    node.addEventListener("pointerdown", function (e) {
      fired = false; sx = e.clientX; sy = e.clientY;
      if (!onLong) return;
      timer = setTimeout(function () { fired = true; timer = null; if (navigator.vibrate) navigator.vibrate(20); onLong(); }, 500);
    });
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    node.addEventListener("pointermove", function (e) { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
    node.addEventListener("pointerup", cancel);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("pointerleave", cancel);
    node.addEventListener("contextmenu", function (e) { if (onLong) e.preventDefault(); });
    node.addEventListener("click", function (e) {
      if (fired) { e.preventDefault(); fired = false; return; }
      onTap();
    });
  }

  var USAGE = [["often", "よく使う"], ["sometimes", "たまに"], ["never", "使っていない"], [null, "未設定"]];
  function usageSheet(it) {
    openSheet(it.name + " を使う頻度", function (sh) {
      USAGE.forEach(function (u) {
        sh.appendChild(el("button", { cls: "opt", role: "menuitemradio", "aria-checked": (it.usage || null) === u[0] ? "true" : "false", text: u[1],
          onclick: function () {
            it.usage = u[0];
            it.usageSetOn = u[0] ? state.today : null;
            save(); closeSheet(render);
          } }));
      });
    });
  }

  function renderSavings(app) {
    app.appendChild(el("div", { cls: "screen-title", text: "積立（別枠）" }));
    var list = el("div", { cls: "list" });
    state.data.items.filter(function (it) { return it.kind === "saving"; }).forEach(function (it) { list.appendChild(itemRow(it)); });
    app.appendChild(list);
  }

  // ---------- 開いたとき: 体験が終わったものを聞く ----------

  function askPendingTrial() {
    if (state.sheet) return;
    var list = C.pendingTrials(state.data.items, state.today).filter(function (it) { return !state.trialAsked[it.id]; });
    if (!list.length) return;
    var it = list[0];
    openSheet(it.name + " の無料体験が終わりました", function (sh) {
      sh.appendChild(el("p", { text: md(it.anchor) + " に体験が終わる予定でした。どうしましたか？" }));
      sh.appendChild(el("button", { cls: "btn block", text: "解約した", onclick: function () {
        it.cancelled = true; it.lastPaid = null; it.trialResolved = true;
        save(); closeSheet(render);
      } }));
      sh.appendChild(el("button", { cls: "btn primary block", text: "有料で続ける", onclick: function () {
        it.trialResolved = true;
        if (!save()) { closeSheet(render); return; }
        if (C.priceOn(it, state.today) === null) {
          // シートの分の履歴を編集の画面に置きかえる（戻るとホーム）
          closeSheetUI();
          history.replaceState(null, "", "#edit/" + encodeURIComponent(it.id));
          toast("金額を入れてください");
          render();
        } else { closeSheet(render); }
      } }));
      sh.appendChild(el("button", { cls: "btn block", text: "あとで", onclick: function () {
        state.trialAsked[it.id] = true; closeSheet(render);
      } }));
    });
  }

  // ---------- 追加・編集 ----------

  function formFromItem(it, hash) {
    var t = state.today;
    var nb = it.cancelled ? it.anchor : (it.trial && !it.trialResolved ? it.anchor : (C.nextBill(it, t) || it.anchor));
    var y = C.priceOn(it, t);
    return {
      hash: hash, id: it.id, kind: it.kind, presetId: it.presetId || null, planId: it.planId || null,
      custom: !it.presetId, name: it.name, yen: y === null ? "" : String(y), cycle: it.cycle,
      nextDate: nb, origNext: nb, origYen: y, origCycle: it.cycle,
      trial: it.trial && !it.trialResolved, usage: it.usage || null, payMethod: it.payMethod || "",
      startedOn: it.startedOn || "", category: it.category || "other", memo: it.memo || "", errors: {}
    };
  }
  function newForm(hash, presetId) {
    var f = {
      hash: hash, id: null, kind: "sub", presetId: null, planId: null, custom: false, name: "", yen: "", cycle: "month",
      nextDate: "", trial: false, usage: null, payMethod: "", startedOn: "", category: "other", memo: "", errors: {}
    };
    if (presetId === "_custom" || !services().length) f.custom = true;
    else if (presetId) applyPreset(f, serviceOf(presetId));
    return f;
  }
  function applyPreset(f, svc) {
    if (!svc) { f.custom = true; return; }
    f.custom = false;
    f.presetId = svc.id;
    f.name = svc.name;
    f.category = svc.category || "other";
    f.planId = null;
    if (svc.plans.length === 1) applyPlan(f, svc.plans[0]);
  }
  function applyPlan(f, plan) {
    f.planId = plan ? plan.id : null;
    if (plan) {
      f.cycle = plan.cycle;
      f.yen = plan.yen === null || plan.yen === undefined ? "" : String(plan.yen);
    }
  }

  function renderEdit(app, r) {
    var hash = location.hash;
    if (!state.form || state.form.hash !== hash) {
      if (r.name === "edit") {
        var it = findItem(r.arg);
        if (!it) { history.replaceState(null, "", "#home"); render(); return; }
        state.form = formFromItem(it, hash);
      } else {
        state.form = newForm(hash, r.arg);
      }
      state.formDirty = false;
    }
    var f = state.form;
    var item = f.id ? findItem(f.id) : null;

    function dirty() { state.formDirty = true; }
    function rerender() { var y = window.scrollY; render(); window.scrollTo(0, y); }

    app.appendChild(el("div", { cls: "topbar" }, [
      el("button", { cls: "x", "aria-label": "閉じる", text: "×", onclick: function () { history.back(); } }),
      el("div", { cls: "t", text: item ? (item.cancelled ? "解約済み" : "編集") : "追加" })
    ]));

    if (!item) {
      app.appendChild(el("div", { cls: "seg", role: "group" }, [["sub", "サブスク"], ["saving", "積立"]].map(function (k) {
        return el("button", { "aria-pressed": f.kind === k[0] ? "true" : "false", text: k[1], onclick: function () {
          f.kind = k[0];
          if (k[0] === "saving") { f.custom = true; f.presetId = null; f.planId = null; f.trial = false; }
          dirty(); rerender();
        } });
      })));
    }

    var form = el("div");
    app.appendChild(form);

    if (f.kind === "sub") {
      // サービス
      var svc = f.presetId ? serviceOf(f.presetId) : null;
      if (!item || item.presetId) {
        form.appendChild(field("サービス", el("button", { cls: "pick", onclick: function () { servicePicker(f, rerender); } }, [
          svc ? avatar({ name: svc.name, presetId: svc.id, category: svc.category, kind: "sub" }, "md") : null,
          el("span", { cls: "grow", text: svc ? svc.name : (f.custom ? "自分で入れる" : "選んでください") }),
          el("span", { cls: "muted", text: "▾" })
        ]), f.errors.service));
      }
      // プラン
      if (svc) {
        var sel = el("select", { onchange: function () {
          f.planTouched = true;
          applyPlan(f, this.value === "_none" ? null : planOf(svc, this.value));
          if (this.value === "_none") f.planId = null;
          dirty(); rerender();
        } });
        if (!f.planId) sel.appendChild(el("option", { value: "", text: "選んでください" }));
        svc.plans.forEach(function (p) {
          var o = el("option", { value: p.id, text: p.name + "　" + (p.yen === null || p.yen === undefined ? "金額は明細で" : yen(p.yen) + (p.cycle === "year" ? "/年" : "/月")) });
          if (p.id === f.planId) o.selected = true;
          sel.appendChild(o);
        });
        var none = el("option", { value: "_none", text: "表にない（自分で入れる）" });
        if (!f.planId && f.planTouched) none.selected = true;
        sel.appendChild(none);
        form.appendChild(field("プラン", sel, null, state.plans ? "プランの表: " + md(state.plans.updated) + " 更新" : null));
        // 表の金額と違うとき
        var plan = planOf(svc, f.planId);
        if (item && plan && plan.yen !== null && plan.yen !== undefined && String(plan.yen) !== f.yen) {
          form.appendChild(el("p", { cls: "hint", text: "表では " + yen(plan.yen) + " になっています（" + md(state.plans.updated) + " 更新）" }));
        }
      }
      if (f.custom) form.appendChild(textField("名前", f, "name", f.errors.name));
    } else {
      form.appendChild(textField("名前", f, "name", f.errors.name));
    }

    // 金額
    var yenIn = el("input", { type: "text", inputmode: "numeric", value: f.yen, placeholder: "空でもよい（あとで入れる）",
      oninput: function () { f.yen = this.value.replace(/[^0-9０-９]/g, "").replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); this.value = f.yen; dirty(); } });
    var yenHint = null;
    if (svc && planOf(svc, f.planId) && planOf(svc, f.planId).yen === null) yenHint = "ドル払いのものは、カードの明細に出た円の金額を入れてください";
    else if (svc && svc.estimate && f.planId) yenHint = "表の金額は目安です（公式で確かめられていません）。明細の金額と違えば直してください";
    form.appendChild(field("金額（円）", yenIn, f.errors.yen, yenHint));

    // 周期: 表のプランを選んだときは出さない
    var planChosen = f.kind === "sub" && f.presetId && f.planId;
    if (!planChosen) {
      form.appendChild(field("周期", el("div", { cls: "seg" }, [["month", "月払い"], ["year", "年払い"]].map(function (c) {
        return el("button", { "aria-pressed": f.cycle === c[0] ? "true" : "false", text: c[1], onclick: function () { f.cycle = c[0]; dirty(); rerender(); } });
      }))));
      form.lastChild.querySelector(".seg").style.marginBottom = "0";
    }

    // 次の請求日
    if (!item || !item.cancelled) {
      var dateLabel = f.kind === "saving" ? "引き落とし日（次）" : f.trial ? "体験が終わる日（最初の請求日）" : "次の請求日";
      var dIn = el("input", { type: "date", value: f.nextDate, min: state.today, oninput: function () { f.nextDate = this.value; dirty(); } });
      form.appendChild(field(dateLabel, dIn, f.errors.nextDate));
    }

    // 無料体験
    if (f.kind === "sub" && (!item || (item.trial && !item.trialResolved))) {
      form.appendChild(el("label", { cls: "check" }, [
        el("input", { type: "checkbox", checked: f.trial, onchange: function () { f.trial = this.checked; dirty(); rerender(); } }),
        el("span", { text: "無料体験中" })
      ]));
    }

    // くわしく
    var more = el("details", { cls: "more" });
    if (f.moreOpen) more.open = true;
    more.addEventListener("toggle", function () { f.moreOpen = more.open; });
    more.appendChild(el("summary", { text: f.kind === "saving" ? "メモ" : "くわしく" }));
    if (f.kind === "sub") {
      if (!f.custom) more.appendChild(textField("名前", f, "name", f.errors.name));
      var us = el("select", { onchange: function () { f.usage = this.value || null; dirty(); } });
      USAGE.forEach(function (u) {
        var o = el("option", { value: u[0] || "", text: u[1] });
        if ((f.usage || null) === u[0]) o.selected = true;
        us.appendChild(o);
      });
      more.appendChild(field("使う頻度", us));
      more.appendChild(textField("支払い方法", f, "payMethod", null, "例: カード、d払い"));
      var st = el("input", { type: "date", value: f.startedOn, max: state.today, oninput: function () { f.startedOn = this.value; dirty(); } });
      more.appendChild(field("始めた日", st, f.errors.startedOn, "入れると、アプリを使う前の月も棒グラフに推定で出ます（最大12か月）"));
      var cs = el("select", { onchange: function () { f.category = this.value; dirty(); } });
      C.CATEGORIES.forEach(function (c) {
        var o = el("option", { value: c.id, text: c.label });
        if (f.category === c.id) o.selected = true;
        cs.appendChild(o);
      });
      more.appendChild(field("カテゴリ", cs));
    }
    var memo = el("textarea", { value: f.memo, oninput: function () { f.memo = this.value; dirty(); } });
    memo.value = f.memo;
    more.appendChild(field("メモ", memo));
    form.appendChild(more);

    // 解約・再開・消す
    if (item) {
      var zone = el("div", { cls: "danger-zone" });
      if (!item.cancelled) {
        zone.appendChild(el("button", { cls: "btn block danger", text: "解約済みにする", onclick: function () { cancelFlow(item); } }));
      } else {
        if (!item.restartedTo) zone.appendChild(el("button", { cls: "btn block", text: "再開する", onclick: function () { restartFlow(item); } }));
        zone.appendChild(el("button", { cls: "btn block danger", text: "消す（間違えて入れたもの）", onclick: function () { deleteItem(item); } }));
      }
      app.appendChild(zone);
    }

    // 保存（下に固定）
    var bar = el("div", { cls: "save-bar" }, [el("button", { cls: "btn primary", text: "保存", onclick: function () { submit(item); } })]);
    app.appendChild(bar);
  }

  function field(label, input, err, hint) {
    var id = "f" + rid();
    if (input.tagName === "INPUT" || input.tagName === "SELECT" || input.tagName === "TEXTAREA") input.id = id;
    return el("div", { cls: "field" }, [
      el(input.id === id ? "label" : "div", { cls: input.id === id ? null : "label", "for": input.id === id ? id : null, text: label }),
      input,
      hint ? el("div", { cls: "hint", text: hint }) : null,
      err ? el("div", { cls: "err", text: err }) : null
    ]);
  }
  function textField(label, f, key, err, placeholder) {
    var inp = el("input", { type: "text", value: f[key], placeholder: placeholder || null, maxlength: "200",
      oninput: function () { f[key] = this.value; state.formDirty = true; } });
    return field(label, inp, err);
  }

  function servicePicker(f, rerender) {
    openSheet("サービスを選ぶ", function (sh) {
      services().forEach(function (svc) {
        sh.appendChild(el("button", { cls: "opt", "aria-checked": f.presetId === svc.id ? "true" : "false", onclick: function () {
          applyPreset(f, svc); state.formDirty = true; closeSheet(rerender);
        } }, [avatar({ name: svc.name, presetId: svc.id, category: svc.category, kind: "sub" }, "md"), el("span", { text: svc.name })]));
      });
      sh.appendChild(el("button", { cls: "opt", "aria-checked": f.custom ? "true" : "false", text: "自分で入れる（一覧にない）", onclick: function () {
        f.custom = true; f.presetId = null; f.planId = null; f.name = ""; state.formDirty = true; closeSheet(rerender);
      } }));
    });
  }

  function checkForm(f, item) {
    var e = {};
    if (f.kind === "sub" && !f.custom && !f.presetId) e.service = "サービスを選んでください";
    if (!f.name.trim()) e.name = "名前を入れてください";
    if (f.yen !== "" && !/^\d{1,9}$/.test(f.yen)) e.yen = "金額は数字で入れてください";
    var needDate = !item || !item.cancelled;
    if (needDate) {
      if (!C.isDate(f.nextDate)) e.nextDate = "日付を入れてください";
      else if (f.nextDate < state.today && (!item || f.nextDate !== f.origNext)) e.nextDate = "今日以降の日を入れてください";
    }
    if (f.startedOn && !C.isDate(f.startedOn)) e.startedOn = "日付の形が違います";
    return e;
  }

  function submit(item) {
    pendingCommit = null;
    var f = state.form;
    f.errors = checkForm(f, item);
    if (Object.keys(f.errors).length) { f.moreOpen = f.moreOpen || !!f.errors.name && !f.custom; render(); toast("入力を確かめてください"); return; }
    var yenVal = f.yen === "" ? null : parseInt(f.yen, 10);
    var t = state.today;
    if (!item) {
      var it = {
        id: rid(), kind: f.kind, name: f.name.trim(),
        presetId: f.kind === "sub" && !f.custom ? f.presetId : null,
        planId: f.kind === "sub" && !f.custom ? f.planId : null,
        category: f.kind === "sub" ? f.category : "other",
        cycle: f.cycle, anchor: f.nextDate, prices: [{ from: f.nextDate, yen: yenVal }],
        trial: f.kind === "sub" && f.trial, trialResolved: !(f.kind === "sub" && f.trial),
        usage: f.kind === "sub" ? f.usage : null, usageSetOn: f.kind === "sub" && f.usage ? t : null,
        payMethod: f.payMethod.trim(), startedOn: f.startedOn || null, memo: f.memo,
        addedOn: t, cancelled: false, lastPaid: null, restartedTo: null
      };
      state.data.items.push(it);
      finishSave();
      return;
    }
    // 編集: 写しを直し、保存するときに入れかえる（金額のシートでやめても元のまま）
    var orig = item;
    item = JSON.parse(JSON.stringify(orig));
    pendingCommit = { orig: orig, next: item };
    item.name = f.name.trim();
    if (item.kind === "sub") {
      if (f.custom) { item.presetId = null; item.planId = null; }
      else { item.presetId = f.presetId; item.planId = f.planId; }
      if (item.usage !== f.usage) { item.usage = f.usage; item.usageSetOn = f.usage ? t : null; }
      item.category = f.category;
    }
    item.payMethod = f.payMethod.trim();
    item.startedOn = f.startedOn || null;
    item.memo = f.memo;
    if (!item.cancelled) {
      // 日付か周期を変えたら、欄に出ていた（直した）次の請求日を基準日にする
      if (f.nextDate !== f.origNext || f.cycle !== f.origCycle) item.anchor = f.nextDate;
      item.cycle = f.cycle;
      if (item.trial && !item.trialResolved && !f.trial) item.trialResolved = true;
      if (!item.trial && f.trial) { item.trial = true; item.trialResolved = false; }
    }
    var cur = C.priceOn(item, t);
    if (yenVal !== cur) {
      if (cur === null || item.cancelled) {
        // 未入力の金額を入れるとき・解約済みは履歴に足さない
        setLatestYen(item, yenVal);
        finishSave();
      } else {
        priceChangeSheet(item, yenVal);
      }
      return;
    }
    finishSave();
  }

  // 今日の時点で使われている行の金額を直す（先の日付の値上げの行は残す）
  function setLatestYen(item, v) {
    var ps = item.prices.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var idx = 0;
    for (var i = 0; i < ps.length; i++) if (ps[i].from <= state.today) idx = i;
    ps[idx].yen = v;
    item.prices = ps;
  }

  function priceChangeSheet(item, v) {
    var def = C.nextBill(item, state.today) || state.today;
    openSheet("金額を変える: " + (v === null ? "未入力" : yen(v)), function (sh) {
      sh.appendChild(el("p", { text: "いつの請求から変わりますか？（それより前の月は前の金額のまま残ります）" }));
      var d = el("input", { type: "date", value: def });
      sh.appendChild(field("この日の請求から", d));
      sh.appendChild(el("button", { cls: "btn primary block", text: "この日から変える", onclick: function () {
        if (!C.isDate(d.value)) { toast("日付を入れてください"); return; }
        item.prices = item.prices.filter(function (p) { return p.from !== d.value; });
        item.prices.push({ from: d.value, yen: v });
        item.prices.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
        closeSheetUI(); finishSave(true);
      } }));
      sh.appendChild(el("button", { cls: "btn block", text: "入力の間違いを直す（履歴に残さない）", onclick: function () {
        setLatestYen(item, v); closeSheetUI(); finishSave(true);
      } }));
    });
  }

  // 保存して前の画面へ。fromSheet: シートの分の history も戻す
  var pendingCommit = null;
  function finishSave(fromSheet) {
    var pc = pendingCommit;
    pendingCommit = null;
    if (pc) {
      var i = state.data.items.indexOf(pc.orig);
      if (i >= 0) state.data.items[i] = pc.next;
    }
    if (!save()) {
      // シートの分の履歴だけ戻す（編集の画面に残る）
      if (fromSheet && history.state && history.state.sheet) history.back();
      render();
      return;
    }
    state.formDirty = false;
    state.form = null;
    history.go(fromSheet ? -2 : -1);
  }

  function cancelFlow(item) {
    pendingCommit = null;
    var t = state.today;
    if (item.trial && !item.trialResolved && t <= item.anchor) {
      openSheet("解約済みにする", function (sh) {
        sh.appendChild(el("p", { text: "無料体験中に解約したものとして記録します（1回も払っていない）。" }));
        sh.appendChild(el("button", { cls: "btn danger block", text: "解約済みにする", onclick: function () {
          item.cancelled = true; item.lastPaid = null; item.trialResolved = true;
          closeSheetUI(); finishSave(true);
        } }));
      });
      return;
    }
    var def = C.defaultLastPaid(item, t);
    openSheet("解約済みにする", function (sh) {
      sh.appendChild(el("p", { text: "最後に払った日を入れてください。これより後の請求は数えません。" }));
      var d = el("input", { type: "date", value: def || "", max: t });
      sh.appendChild(field("最後に払った日（払っていなければ空）", d));
      sh.appendChild(el("button", { cls: "btn danger block", text: "解約済みにする", onclick: function () {
        if (d.value && !C.isDate(d.value)) { toast("日付の形が違います"); return; }
        item.cancelled = true; item.lastPaid = d.value || null; item.trialResolved = true;
        closeSheetUI(); finishSave(true);
      } }));
    });
  }

  function restartFlow(item) {
    pendingCommit = null;
    openSheet("再開する", function (sh) {
      sh.appendChild(el("p", { text: "新しい項目として作り直します。前の分の支出は残ります。次の請求日を入れてください。" }));
      var d = el("input", { type: "date", min: state.today, value: "" });
      sh.appendChild(field("次の請求日", d));
      sh.appendChild(el("button", { cls: "btn primary block", text: "再開する", onclick: function () {
        if (!C.isDate(d.value) || d.value < state.today) { toast("今日以降の日を入れてください"); return; }
        var n = {
          id: rid(), kind: item.kind, name: item.name, presetId: item.presetId || null, planId: item.planId || null,
          category: item.category || "other", cycle: item.cycle, anchor: d.value,
          prices: [{ from: d.value, yen: C.lastYen(item) }], trial: false, trialResolved: true,
          usage: null, usageSetOn: null, payMethod: item.payMethod || "", startedOn: null, memo: item.memo || "",
          addedOn: state.today, cancelled: false, lastPaid: null, restartedTo: null
        };
        state.data.items.push(n);
        item.restartedTo = n.id;
        closeSheetUI(); finishSave(true);
      } }));
    });
  }

  function deleteItem(item) {
    var idx = state.data.items.indexOf(item);
    if (idx < 0) return;
    state.data.items.splice(idx, 1);
    // 再開したもの（B）を消したら、元（A）の restartedTo を外す（元に戻すときは付け直す）
    var pointing = state.data.items.filter(function (x) { return x.restartedTo === item.id; });
    pointing.forEach(function (x) { x.restartedTo = null; });
    if (!save()) { render(); return; }
    state.formDirty = false; state.form = null;
    history.back();
    toast(item.name + " を消しました", "元に戻す", function () {
      state.data.items.splice(Math.min(idx, state.data.items.length), 0, item);
      pointing.forEach(function (x) {
        var cur = findItem(x.id);
        if (cur) cur.restartedTo = item.id;
      });
      save(); render();
    }, 5000);
  }

  // ---------- カレンダー ----------

  function renderCalendar(app) {
    var t = state.today;
    var items = state.data.items;
    app.appendChild(el("div", { cls: "screen-title", text: "カレンダー" }));
    if (!items.length) { app.appendChild(el("p", { cls: "muted", text: "サブスクを追加すると出ます" })); return; }
    var key = state.calMonth || C.ymOf(t);
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    var mb = C.monthBills(items, key, t);

    app.appendChild(el("div", { cls: "cal-head" }, [
      el("button", { "aria-label": "前の月", text: "‹", onclick: function () { state.calMonth = C.addMonthsYm(key, -1); state.calSel = null; render(); } }),
      el("div", { cls: "m", text: y + "年" + m + "月" }),
      el("button", { "aria-label": "次の月", text: "›", onclick: function () { state.calMonth = C.addMonthsYm(key, 1); state.calSel = null; render(); } })
    ]));

    var byDay = {};
    mb.list.forEach(function (b) { (byDay[b.date] = byDay[b.date] || []).push(b); });
    var grid = el("div", { cls: "cal card" });
    DOW.forEach(function (d, i) { grid.appendChild(el("div", { cls: "dow" + (i === 0 ? " sun" : ""), text: d })); });
    var first = new Date(y, m - 1, 1).getDay();
    for (var i = 0; i < first; i++) grid.appendChild(el("div", { cls: "day out" }));
    var dim = C.daysInMonth(y, m);
    for (var d = 1; d <= dim; d++) {
      var ds = key + "-" + (d < 10 ? "0" : "") + d;
      var list = byDay[ds] || [];
      var icons = el("div", { cls: "icons" });
      var show = list.length >= 3 ? 2 : list.length;
      for (var k = 0; k < show; k++) icons.appendChild(avatar(list[k].item, "sm"));
      if (list.length > show) icons.appendChild(el("span", { text: "+" + (list.length - show) }));
      var cls = "day" + (ds === t ? " today" : "") + (ds === state.calSel ? " sel" : "");
      (function (ds) {
        grid.appendChild(el("button", { cls: cls, "aria-label": md(ds) + (list.length ? " " + list.length + "件" : ""),
          onclick: function () { state.calSel = state.calSel === ds ? null : ds; render(); } },
          [el("span", { cls: "n" + ((first + d - 1) % 7 === 0 ? " sun" : ""), text: String(d) }), icons]));
      })(ds);
    }
    app.appendChild(grid);

    app.appendChild(el("div", { cls: "month-total" }, [
      el("div", { text: m + "月に払う額（" + mb.subCount + "件）" }),
      el("div", { cls: "v", text: yen(mb.subTotal) })
    ]));
    if (mb.savingCount) app.appendChild(el("div", { cls: "small", text: "積立 " + yen(mb.savingTotal) + "（" + mb.savingCount + "件、上の額には入れていません）" }));
    if (mb.missing) app.appendChild(el("div", { cls: "small", text: "金額未入力 " + mb.missing + "件" }));
    if (!mb.list.length) { app.appendChild(el("p", { cls: "muted", text: "この月の請求はありません" })); return; }
    var lst = el("div", { cls: "list" });
    lst.style.marginTop = "8px";
    var selRow = null;
    mb.list.forEach(function (b) {
      var row = el("button", { cls: "row" + (b.date < t ? " past" : "") + (b.date === state.calSel ? " hl" : ""),
        onclick: function () { go("#edit/" + encodeURIComponent(b.item.id)); } }, [
        el("div", { text: mdw(b.date) }),
        avatar(b.item, "md"),
        el("div", { cls: "main" }, [el("div", { cls: "name", text: b.item.name + (b.item.kind === "saving" ? "（積立）" : "") })]),
        el("div", { cls: "price", text: b.yen === null ? "金額未入力" : yen(b.yen) })
      ]);
      row.firstChild.style.minWidth = "64px";
      if (b.date === state.calSel && !selRow) selRow = row;
      lst.appendChild(row);
    });
    app.appendChild(lst);
    if (selRow) setTimeout(function () { selRow.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 0);
  }

  // ---------- 分析 ----------

  var PIE_COLORS = ["#2e8b62", "#4f5fb0", "#b04a80", "#2a7a96", "#9a6430", "#8a4fa8"];
  var CAT_COLORS = { video: "#4f5fb0", music: "#8a4fa8", ai: "#2a7a96", social: "#b04a80", shopping: "#9a6430", tools: "#5a7380", other: "#6e6e6e" };

  function renderAnalysis(app) {
    var t = state.today;
    var items = state.data.items;
    app.appendChild(el("div", { cls: "screen-title", text: "分析" }));
    var rank = C.ranking(items, t);
    if (!items.some(function (it) { return it.kind !== "saving"; })) {
      app.appendChild(el("p", { cls: "muted", text: "サブスクを追加すると出ます" }));
      return;
    }

    // 高い順
    var rc = el("div", { cls: "card" }, [el("div", { cls: "section-title", text: "高い順（月あたり）" })]);
    rc.firstChild.style.marginTop = "0";
    if (!rank.length) rc.appendChild(el("p", { cls: "muted", text: "金額が入っているサブスクがありません" }));
    rank.forEach(function (r, i) {
      var bar = el("div", { cls: "bar" }, [el("i")]);
      bar.firstChild.style.width = Math.round(r.share * 100) + "%";
      rc.appendChild(el("div", { cls: "rank" }, [
        el("div", { cls: "no", text: String(i + 1) }),
        avatar(r.item, "md"),
        el("div", { cls: "main" }, [
          el("div", { cls: "name" }, [r.item.name, r.top ? el("span", { cls: "tag top", text: "特に高い" }) : null]),
          bar
        ]),
        el("div", { cls: "v" }, [yen(r.monthly), el("small", { text: Math.round(r.share * 100) + "%" })])
      ]));
      var tg = rc.lastChild.querySelector(".tag");
      if (tg) tg.style.marginLeft = "6px";
    });
    app.appendChild(rc);

    // 棒グラフ
    var hist = C.history(items, t, 12);
    var bc = el("div", { cls: "card" }, [el("div", { cls: "section-title", text: "支出の推移（払った月）" })]);
    bc.firstChild.style.marginTop = "0";
    bc.appendChild(barChart(hist));
    var selTxt = state.barSel !== null && hist[state.barSel] ? hist[state.barSel] : null;
    bc.appendChild(el("div", { cls: "small", text: selTxt
      ? (+selTxt.ym.slice(5) + "月: " + yen(selTxt.actual + selTxt.est) + (selTxt.est ? "（うち推定 " + yen(selTxt.est) + "）" : ""))
      : "棒をタップすると、その月の金額が出ます" }));
    bc.appendChild(el("div", { cls: "small", text: "年払いのものは、払った月だけ高くなります。薄い色は、アプリに入れる前の推定（始めた日を入れたものだけ）です。" }));
    app.appendChild(bc);

    // 円グラフ
    var pc = el("div", { cls: "card" });
    pc.appendChild(el("div", { cls: "seg", role: "group" }, [["service", "サービス"], ["category", "カテゴリ"]].map(function (k) {
      return el("button", { "aria-pressed": state.pieBy === k[0] ? "true" : "false", text: k[1], onclick: function () { state.pieBy = k[0]; render(); } });
    })));
    var p = C.pie(items, t, state.pieBy);
    if (p.total > 0) {
      var colors = p.slices.map(function (s, i) {
        if (s.key === "_rest") return "#8a8f8c";
        return state.pieBy === "category" ? (CAT_COLORS[s.key] || "#6e6e6e") : PIE_COLORS[i % PIE_COLORS.length];
      });
      var legend = el("div", { cls: "legend" });
      p.slices.forEach(function (s, i) {
        var sw = el("i");
        sw.style.background = colors[i];
        legend.appendChild(el("div", null, [sw, el("span", { text: s.label }), el("span", { cls: "p", text: Math.round(s.share * 100) + "%" })]));
      });
      pc.appendChild(el("div", { cls: "pie-wrap" }, [pieChart(p.slices, colors), legend]));
    }
    app.appendChild(pc);

    var sv = C.saved(items);
    if (sv.count) app.appendChild(el("div", { cls: "card" }, [el("div", { text: "解約で浮いた 月 " + yen(sv.monthly) + "（" + sv.count + "件）" })]));
  }

  function barChart(hist) {
    var W = 340, H = 180, top = 16, bottom = 22, left = 4;
    var max = 0;
    hist.forEach(function (m) { max = Math.max(max, m.actual + m.est); });
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "過去12か月の支出の棒グラフ" });
    s.setAttribute("class", "chart");
    var ch = H - top - bottom;
    var bw = (W - left * 2) / hist.length;
    s.appendChild(svg("line", { x1: 0, x2: W, y1: top + ch, y2: top + ch, "class": "grid" }));
    hist.forEach(function (m, i) {
      var x = left + i * bw + bw * 0.18, w = bw * 0.64;
      var ha = max ? (m.actual / max) * ch : 0, he = max ? (m.est / max) * ch : 0;
      var g = svg("g", { role: "button", tabindex: "0" });
      g.appendChild(svg("rect", { x: left + i * bw, y: 0, width: bw, height: H, fill: "transparent" }));
      if (he > 0) g.appendChild(svg("rect", { x: x, y: top + ch - ha - he, width: w, height: he, rx: 2, "class": "b-est" }));
      if (ha > 0) g.appendChild(svg("rect", { x: x, y: top + ch - ha, width: w, height: ha, rx: 2, "class": state.barSel === i ? "b-sel" : "b-actual" }));
      var lab = svg("text", { x: left + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" });
      lab.textContent = +m.ym.slice(5) + "月";
      g.appendChild(lab);
      g.addEventListener("click", function () { state.barSel = state.barSel === i ? null : i; render(); });
      s.appendChild(g);
    });
    if (max) {
      var mx = svg("text", { x: W - 2, y: 11, "text-anchor": "end" });
      mx.textContent = "最大 " + yen(max);
      s.appendChild(mx);
    }
    return s;
  }

  function pieChart(slices, colors) {
    var s = svg("svg", { viewBox: "-1 -1 2 2", role: "img", "aria-label": "内訳の円グラフ" });
    s.style.transform = "rotate(-90deg)";
    var acc = 0;
    slices.forEach(function (sl, i) {
      if (sl.share >= 0.9999) {
        s.appendChild(svg("circle", { cx: 0, cy: 0, r: 1, fill: colors[i] }));
        return;
      }
      var a0 = acc * 2 * Math.PI, a1 = (acc + sl.share) * 2 * Math.PI;
      acc += sl.share;
      var large = sl.share > 0.5 ? 1 : 0;
      s.appendChild(svg("path", { fill: colors[i],
        d: "M0 0 L" + Math.cos(a0) + " " + Math.sin(a0) + " A1 1 0 " + large + " 1 " + Math.cos(a1) + " " + Math.sin(a1) + " Z" }));
    });
    var hole = svg("circle", { cx: 0, cy: 0, r: 0.55 });
    hole.style.fill = "var(--surface)";
    s.appendChild(hole);
    return s;
  }

  // ---------- 設定 ----------

  function renderSettings(app) {
    var t = state.today;
    app.appendChild(el("div", { cls: "screen-title", text: "設定" }));
    brokenBanner(app);

    var c = el("div", { cls: "card" }, [el("div", { cls: "section-title", text: "控え（データのバックアップ）" })]);
    c.firstChild.style.marginTop = "0";
    var last = state.data.lastExport;
    c.appendChild(el("p", { cls: "small", text: last ? "最後に書き出した日: " + md(last) + "（" + C.diffDays(last, t) + "日前）" : "まだ書き出していません" }));
    c.appendChild(el("p", { cls: "small", text: "データはこのスマホの中だけにあります。ブラウザのデータを消すと消えるので、ときどき書き出してください。" }));
    c.appendChild(el("button", { cls: "btn primary block", text: "書き出す（ファイルに保存）", onclick: exportFile }));
    var probe = null;
    try { probe = new File(["{}"], "p.json", { type: "application/json" }); } catch (e) { probe = null; }
    if (probe && navigator.canShare && navigator.canShare({ files: [probe] })) {
      c.appendChild(el("button", { cls: "btn block", text: "共有する（Google ドライブなどへ送る）", onclick: shareFile }));
    }
    var fileIn = el("input", { type: "file", hidden: true, onchange: function () { if (this.files[0]) importFile(this.files[0]); this.value = ""; } });
    c.appendChild(fileIn);
    c.appendChild(el("button", { cls: "btn block", text: "読み込む（控えから戻す）", onclick: function () { fileIn.click(); } }));
    app.appendChild(c);

    var p = el("div", { cls: "card" }, [
      el("div", { cls: "set-row" }, [el("span", { text: "プランの表" }), el("span", { cls: "muted", text: state.plans ? md(state.plans.updated) + " 更新" : "まだ読めていません" })]),
      el("div", { cls: "set-row" }, [el("span", { text: "このアプリ" }), el("span", { cls: "muted", text: "Paycle " + APP_VERSION })])
    ]);
    app.appendChild(p);
  }

  function backupBlob() {
    var json = JSON.stringify(state.data, null, 1);
    return { name: "paycle-backup-" + state.today + ".json", text: json };
  }
  function markExported() {
    state.data.lastExport = state.today;
    save();
    render();
  }
  function exportFile() {
    if (state.broken) { toast("データが読めないため、書き出せません"); return; }
    var b = backupBlob();
    var url = URL.createObjectURL(new Blob([b.text], { type: "application/json" }));
    var a = el("a", { href: url, download: b.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    markExported();
    toast("書き出しました（" + b.name + "）");
  }
  function shareFile() {
    if (state.broken) { toast("データが読めないため、書き出せません"); return; }
    var b = backupBlob();
    var file = new File([b.text], b.name, { type: "application/json" });
    navigator.share({ files: [file], title: "Paycle の控え" })
      .then(function () { markExported(); toast("共有しました"); })
      .catch(function (e) { if (e && e.name !== "AbortError") toast("共有できませんでした"); });
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); } catch (e) { toast("ファイルが読めません（JSON ではありません）"); return; }
      var err = C.validateData(obj);
      if (err) { toast(err, null, null, 5000); return; }
      obj = C.migrate(obj);
      openSheet("控えを読み込む", function (sh) {
        sh.appendChild(el("p", { text: obj.items.length + "件 を読み込みます。今のデータ（" + state.data.items.length + "件）は上書きされます。" }));
        sh.appendChild(el("button", { cls: "btn primary block", text: "上書きして読み込む", onclick: function () {
          var cur = lsGet(KEY);
          if (cur !== null) lsSet(KEY + ".bak", cur);
          obj.lastOpened = state.today;
          obj.notice = null;
          var wasBroken = state.broken;
          state.data = obj;
          state.broken = false;
          if (save()) toast(obj.items.length + "件 を読み込みました");
          else state.broken = wasBroken;
          closeSheet(render);
        } }));
        sh.appendChild(el("button", { cls: "btn block", text: "やめる", onclick: function () { closeSheet(); } }));
      });
    };
    reader.onerror = function () { toast("ファイルが読めません"); };
    reader.readAsText(file);
  }

  // ---------- 開いたときの処理 ----------

  function onOpen() {
    var t = state.today = today();
    if (state.broken) return;
    var d = state.data;
    if (d.lastOpened !== t) {
      var since = d.notice && d.notice.from ? d.notice.from : d.lastOpened;
      var ps = C.passedSince(d.items, since, t);
      if (ps) d.notice = ps;
      d.lastOpened = t;
      save();
    }
  }

  // 0時をまたいで開いたままにしたとき、画面に戻ったら今日を計算し直す
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (today() !== state.today) {
      state.trialAsked = {};
      onOpen();
      if (!state.form) render();
    }
  });

  // ---------- 始める ----------

  loadData();
  loadPlans();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (p) { if (!p) navigator.storage.persist(); }).catch(function () {});
  }
  onOpen();
  // オフライン用。試験用サーバーでは ?sw=1 のときだけ（直しながら試すとき古い版が出ないように）
  if ("serviceWorker" in navigator && (!DEV || params.get("sw") === "1")) {
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  }
  // ホームを最初の履歴にする（ホームで「戻る」→ アプリを閉じる）
  var startHash = location.hash;
  history.replaceState(null, "", location.pathname + location.search + "#home");
  if (startHash && startHash !== "#home" && !/^#(edit|new)/.test(startHash)) history.pushState(null, "", startHash);
  render();
})();
