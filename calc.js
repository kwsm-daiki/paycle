// Paycle の計算の部分（画面から分けている）。
// 日付はすべて "YYYY-MM-DD" の文字列で持つ。new Date("YYYY-MM-DD") と toISOString() は使わない
// （前者は世界標準時として読まれ、後者は日本時間の朝9時前に1日前になるため）。
"use strict";

(function (root) {
  var CURRENT_VERSION = 1;

  var CATEGORIES = [
    { id: "video", label: "動画" },
    { id: "music", label: "音楽" },
    { id: "ai", label: "AI" },
    { id: "social", label: "ゲーム・SNS" },
    { id: "shopping", label: "買い物" },
    { id: "tools", label: "クラウド・道具" },
    { id: "other", label: "その他" }
  ];

  // ---------- 日付 ----------

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function parse(s) {
    var r = DATE_RE.exec(s);
    return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
  }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function isDate(s) {
    if (typeof s !== "string") return false;
    var p = parse(s);
    return !!p && p.y >= 2000 && p.y <= 2200 && p.m >= 1 && p.m <= 12 &&
      p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
  }

  // 日付を通し番号（1970-01-01 からの日数）にする。時刻を持たないので時差の影響を受けない
  function dayNum(s) {
    var p = parse(s);
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }
  function fromDayNum(n) {
    var dt = new Date(n * 86400000);
    return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  // b - a の日数
  function diffDays(a, b) { return dayNum(b) - dayNum(a); }

  // 端末の時刻（日本時間）での今日
  function todayStr(now) {
    now = now || new Date();
    return fmt(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // "YYYY-MM"
  function ymOf(s) { return s.slice(0, 7); }
  function addMonthsYm(key, n) {
    var y = +key.slice(0, 4);
    var t = +key.slice(5, 7) - 1 + n;
    y += Math.floor(t / 12);
    return y + "-" + pad(((t % 12) + 12) % 12 + 1);
  }
  function monthStart(key) { return key + "-01"; }
  function monthEnd(key) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    return fmt(y, m, daysInMonth(y, m));
  }

  // ---------- 金額 ----------

  function sortedPrices(item) {
    return (item.prices || []).slice().sort(function (a, b) {
      return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
    });
  }

  // ある日の金額: from がその日以前で一番新しい行。最初の from より前は最初の金額。null は金額未入力
  function priceOn(item, date) {
    var ps = sortedPrices(item);
    if (!ps.length) return null;
    var yen = ps[0].yen;
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].from <= date) yen = ps[i].yen;
    }
    return yen;
  }
  function firstYen(item) { var ps = sortedPrices(item); return ps.length ? ps[0].yen : null; }
  function lastYen(item) { var ps = sortedPrices(item); return ps.length ? ps[ps.length - 1].yen : null; }

  function toMonthly(yen, cycle) {
    if (yen === null || yen === undefined) return null;
    return cycle === "year" ? yen / 12 : yen;
  }
  function toYearly(yen, cycle) {
    if (yen === null || yen === undefined) return null;
    return cycle === "year" ? yen : yen * 12;
  }

  // 今日の時点の月あたり（四捨五入しない）
  function monthlyNow(item, today) { return toMonthly(priceOn(item, today), item.cycle); }

  // ---------- 請求日 ----------

  // anchor から k 回目（k は負でもよい）の請求日。
  // 月払いは anchor の日、その月にない日なら月末。年払いは anchor の月日、2/29 がない年は 2/28
  function billDateAt(item, k) {
    var a = parse(item.anchor);
    var y, m;
    if (item.cycle === "year") {
      y = a.y + k;
      m = a.m;
    } else {
      var t = a.m - 1 + k;
      y = a.y + Math.floor(t / 12);
      m = ((t % 12) + 12) % 12 + 1;
    }
    return fmt(y, m, Math.min(a.d, daysInMonth(y, m)));
  }

  // 体験が終わったのに「解約した／有料で続ける」をまだ答えていない
  function trialPending(item, today) {
    return !!item.trial && !item.trialResolved && !item.cancelled && item.anchor < today;
  }

  // k 回目の請求日 d を数えるか。数えないなら null、数えるなら { date, yen, est }
  // est: アプリに入れる前（addedOn より前）の推定の請求
  function classify(item, k, d, today) {
    if (item.cancelled && (!item.lastPaid || d > item.lastPaid)) return null;
    if (d < item.addedOn) {
      // 推定: 始めた日を入れたものだけ。体験から始めたものは anchor より前をさかのぼらない
      if (!item.startedOn || d < item.startedOn) return null;
      if (k < 0 && item.trial) return null;
      return { date: d, yen: firstYen(item), est: true, item: item };
    }
    if (k < 0) return null;
    // 体験の答え待ちのものは、過ぎた請求を数えない
    if (item.trial && !item.trialResolved && !item.cancelled && d < today) return null;
    return { date: d, yen: priceOn(item, d), est: false, item: item };
  }

  // from から to まで（両端を含む）の請求
  function bills(item, from, to, today) {
    var out = [];
    if (!item.anchor || from > to) return out;
    var a = parse(item.anchor), f = parse(from);
    var k = item.cycle === "year" ? f.y - a.y - 1 : (f.y - a.y) * 12 + (f.m - a.m) - 1;
    for (;; k++) {
      var d = billDateAt(item, k);
      if (d > to) break;
      if (d < from) continue;
      var b = classify(item, k, d, today);
      if (b) out.push(b);
    }
    return out;
  }

  // 次の請求日（今日以降で最初）。なければ null
  function nextBill(item, today) {
    var list = bills(item, today, addDays(today, 400), today);
    return list.length ? list[0].date : null;
  }

  // 「解約済みにする」の「最後に払った日」の初めの値: 今日以前で最後の請求日。体験中・払っていないなら null
  function defaultLastPaid(item, today) {
    if (item.trial && today < item.anchor) return null;
    var list = bills(item, addDays(today, -400), today, today);
    return list.length ? list[list.length - 1].date : null;
  }

  // ---------- 一覧に出すもの ----------

  function isSub(item) { return item.kind !== "saving"; }
  function activeSubs(items) { return items.filter(function (it) { return isSub(it) && !it.cancelled; }); }
  function activeSavings(items) { return items.filter(function (it) { return !isSub(it) && !it.cancelled; }); }

  // ホームの合計
  function summary(items, today) {
    var subs = activeSubs(items);
    var monthly = 0, yearly = 0, missing = 0, unused = 0, rest = 0;
    var end = monthEnd(ymOf(today));
    subs.forEach(function (it) {
      var y = priceOn(it, today);
      if (y === null) { missing++; return; }
      monthly += toMonthly(y, it.cycle);
      yearly += toYearly(y, it.cycle);
      if (it.usage === "never") unused += toMonthly(y, it.cycle);
    });
    subs.forEach(function (it) {
      bills(it, today, end, today).forEach(function (b) { if (b.yen !== null) rest += b.yen; });
    });
    var savings = activeSavings(items);
    var savingMonthly = 0;
    savings.forEach(function (it) {
      var m = monthlyNow(it, today);
      if (m !== null) savingMonthly += m;
    });
    return {
      monthly: Math.round(monthly),
      yearly: Math.round(yearly),
      count: subs.length,
      missing: missing,
      restOfMonth: rest,
      unusedMonthly: Math.round(unused),
      savingMonthly: Math.round(savingMonthly),
      savingCount: savings.length
    };
  }

  function byDateThenName(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0;
  }

  // カレンダー: その月（"YYYY-MM"）の請求。推定は入れない。積立も入れる（合計は別）
  function monthBills(items, key, today) {
    var list = [];
    items.forEach(function (it) {
      bills(it, monthStart(key), monthEnd(key), today).forEach(function (b) {
        if (!b.est) list.push(b);
      });
    });
    list.sort(byDateThenName);
    var r = { list: list, subTotal: 0, subCount: 0, savingTotal: 0, savingCount: 0, missing: 0 };
    list.forEach(function (b) {
      if (b.yen === null) r.missing++;
      if (isSub(b.item)) { r.subCount++; r.subTotal += b.yen || 0; }
      else { r.savingCount++; r.savingTotal += b.yen || 0; }
    });
    return r;
  }

  // 棒グラフ: 今月を含む過去 n か月の「払った額」（今日まで）。est はアプリに入れる前の推定。積立は入れない
  function history(items, today, n) {
    n = n || 12;
    var nowKey = ymOf(today);
    var months = [];
    var idx = {};
    for (var i = n - 1; i >= 0; i--) {
      var key = addMonthsYm(nowKey, -i);
      idx[key] = months.length;
      months.push({ ym: key, actual: 0, est: 0 });
    }
    var from = monthStart(months[0].ym);
    items.forEach(function (it) {
      if (!isSub(it)) return;
      bills(it, from, today, today).forEach(function (b) {
        if (b.yen === null) return;
        var m = months[idx[ymOf(b.date)]];
        if (b.est) m.est += b.yen; else m.actual += b.yen;
      });
    });
    return months;
  }

  // 期限が近いものの帯。請求日は3日前から、体験の終わりは7日前から。赤は今日・明日だけ、それより前は黄
  function alerts(items, today) {
    var out = [];
    items.forEach(function (it) {
      if (it.cancelled) return;
      if (it.trial && !it.trialResolved) {
        if (today <= it.anchor) {
          var td = diffDays(today, it.anchor);
          if (td <= 7) out.push({ item: it, type: "trial", date: it.anchor, days: td, level: td <= 1 ? "red" : "yellow" });
        }
        return;
      }
      var nb = nextBill(it, today);
      if (!nb) return;
      var d = diffDays(today, nb);
      if (d <= 3) out.push({ item: it, type: "bill", date: nb, days: d, level: d <= 1 ? "red" : "yellow" });
    });
    out.sort(function (a, b) {
      if (a.days !== b.days) return a.days - b.days;
      return a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0;
    });
    return out;
  }

  // 開いたときに「解約した／有料で続ける」を聞くもの
  function pendingTrials(items, today) {
    return items.filter(function (it) { return trialPending(it, today); });
  }

  // 「前回（lastOpened）から ○件 の請求日が過ぎました」: lastOpened の翌日から昨日まで。
  // アプリに入れる前のもの・体験の答え待ちのもの・積立は数えない。初めて開いたときは null
  function passedSince(items, lastOpened, today) {
    if (!lastOpened) return null;
    var from = addDays(lastOpened, 1), to = addDays(today, -1);
    if (from > to) return null;
    var count = 0, ids = [];
    items.forEach(function (it) {
      if (!isSub(it) || trialPending(it, today)) return;
      bills(it, from, to, today).forEach(function (b) {
        if (b.est) return;
        count++;
        if (ids.indexOf(it.id) < 0) ids.push(it.id);
      });
    });
    return count ? { from: lastOpened, to: to, count: count, ids: ids } : null;
  }

  // 分析の「高い順（月あたり）」。「特に高い」はサブスクが3件以上のときだけ、合計の30％以上
  function ranking(items, today) {
    var subs = activeSubs(items);
    var list = [];
    subs.forEach(function (it) {
      var m = monthlyNow(it, today);
      if (m !== null) list.push({ item: it, monthly: m });
    });
    var total = list.reduce(function (s, r) { return s + r.monthly; }, 0);
    list.sort(function (a, b) {
      if (a.monthly !== b.monthly) return b.monthly - a.monthly;
      return a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0;
    });
    list.forEach(function (r) {
      r.share = total ? r.monthly / total : 0;
      r.top = subs.length >= 3 && r.share >= 0.3;
    });
    return list;
  }

  function categoryLabel(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].label;
    return "その他";
  }

  // 円グラフ（月あたり）。by は "service" か "category"。6つを超えたら小さいものを「ほか」にまとめる
  function pie(items, today, by) {
    var rank = ranking(items, today);
    var slices = [];
    if (by === "category") {
      var map = {};
      rank.forEach(function (r) {
        var c = r.item.category || "other";
        if (!map[c]) { map[c] = { key: c, label: categoryLabel(c), value: 0 }; slices.push(map[c]); }
        map[c].value += r.monthly;
      });
    } else {
      rank.forEach(function (r) { slices.push({ key: r.item.id, label: r.item.name, value: r.monthly }); });
    }
    slices.sort(function (a, b) { return b.value - a.value; });
    if (slices.length > 6) {
      var rest = slices.slice(5);
      slices = slices.slice(0, 5);
      slices.push({ key: "_rest", label: "ほか", value: rest.reduce(function (s, x) { return s + x.value; }, 0) });
    }
    var total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    slices.forEach(function (x) { x.share = total ? x.value / total : 0; });
    return { total: total, slices: slices };
  }

  // 解約で浮いた額（月あたり）: 解約済みで再開していないサブスクの、最後の金額
  function saved(items) {
    var sum = 0, count = 0;
    items.forEach(function (it) {
      if (!isSub(it) || !it.cancelled || it.restartedTo) return;
      count++;
      var m = toMonthly(lastYen(it), it.cycle);
      if (m !== null) sum += m;
    });
    return { monthly: Math.round(sum), count: count };
  }

  // 一覧の並べ替え。key: "next"（請求日）・"high"・"low"・"new"
  function sortItems(list, key, today) {
    function name(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
    var cache = {};
    function val(it) {
      if (!(it.id in cache)) cache[it.id] = key === "next" ? nextBill(it, today) : monthlyNow(it, today);
      return cache[it.id];
    }
    return list.slice().sort(function (a, b) {
      if (key === "new") {
        if (a.addedOn !== b.addedOn) return a.addedOn < b.addedOn ? 1 : -1;
        return name(a, b);
      }
      var va = val(a), vb = val(b);
      if (va === null && vb === null) return name(a, b);
      if (va === null) return 1;   // 決まらないものは最後
      if (vb === null) return -1;
      if (va !== vb) {
        if (key === "next") return va < vb ? -1 : 1;
        return key === "low" ? va - vb : vb - va;
      }
      return name(a, b);
    });
  }

  // 一覧の行の印: "unset"（頻度？）・"never"（使っていない）・"stale"（付けて30日: まだ使っていない？）・null
  function usageFlag(item, today) {
    if (!isSub(item)) return null;
    if (item.usage === null || item.usage === undefined) return "unset";
    if (item.usage !== "never") return null;
    if (item.usageSetOn && diffDays(item.usageSetOn, today) >= 30) return "stale";
    return "never";
  }

  // 書き出しの知らせ: 最後に書き出してから（なければ最初に入れた日から）30日
  function exportDue(data, today) {
    var base = data.lastExport;
    if (!base) {
      (data.items || []).forEach(function (it) { if (!base || it.addedOn < base) base = it.addedOn; });
    }
    if (!base) return null;
    var days = diffDays(base, today);
    return days >= 30 ? { days: days, never: !data.lastExport } : null;
  }

  // ---------- データの形を確かめる・版を上げる ----------

  function isIntOrNull(v) { return v === null || (typeof v === "number" && Math.floor(v) === v && v >= 0); }
  function isDateOrNull(v) { return v === null || v === undefined || isDate(v); }
  function isStrOrNull(v) { return v === null || v === undefined || typeof v === "string"; }

  // 中身を確かめる。問題がなければ null、あればその理由（日本語）
  function validateData(obj) {
    if (!obj || typeof obj !== "object") return "ファイルの形が違います";
    if (obj.app !== "paycle") return "Paycle の控えではありません";
    if (typeof obj.version !== "number" || obj.version < 1) return "版の番号がありません";
    if (obj.version > CURRENT_VERSION) return "新しい版のアプリで作られた控えです。アプリを新しくしてから読み込んでください";
    if (!Array.isArray(obj.items)) return "サブスクの一覧がありません";
    if (!isDateOrNull(obj.lastOpened) || !isDateOrNull(obj.lastExport)) return "日付の形が違います";
    var nt = obj.notice;
    if (nt !== null && nt !== undefined) {
      if (typeof nt !== "object" || !isDate(nt.from) || !isDate(nt.to) || !isIntOrNull(nt.count) || !nt.count ||
          !Array.isArray(nt.ids) || nt.ids.some(function (x) { return typeof x !== "string"; })) return "知らせの形が違います";
    }
    var ids = {};
    for (var i = 0; i < obj.items.length; i++) {
      var it = obj.items[i], n = (i + 1) + "件目";
      if (!it || typeof it !== "object") return n + "の形が違います";
      if (typeof it.id !== "string" || !it.id || ids[it.id]) return n + "の id が違います";
      ids[it.id] = true;
      if (it.kind !== "sub" && it.kind !== "saving") return n + "の種類が違います";
      if (typeof it.name !== "string" || !it.name) return n + "の名前がありません";
      if (it.cycle !== "month" && it.cycle !== "year") return n + "の周期が違います";
      if (!isDate(it.anchor) || !isDate(it.addedOn)) return n + "の日付の形が違います";
      if (!isDateOrNull(it.startedOn) || !isDateOrNull(it.lastPaid) || !isDateOrNull(it.usageSetOn)) return n + "の日付の形が違います";
      if (!Array.isArray(it.prices) || !it.prices.length) return n + "の金額がありません";
      for (var j = 0; j < it.prices.length; j++) {
        var p = it.prices[j];
        if (!p || !isDate(p.from) || !isIntOrNull(p.yen)) return n + "の金額の形が違います";
      }
      if (typeof it.trial !== "boolean" || typeof it.trialResolved !== "boolean" || typeof it.cancelled !== "boolean") return n + "の形が違います";
      if ([null, undefined, "often", "sometimes", "never"].indexOf(it.usage) < 0) return n + "の使う頻度が違います";
      if (!isStrOrNull(it.presetId) || !isStrOrNull(it.planId) || !isStrOrNull(it.category) ||
          !isStrOrNull(it.payMethod) || !isStrOrNull(it.memo) || !isStrOrNull(it.restartedTo)) return n + "の形が違います";
    }
    return null;
  }

  // 古い版のデータを今の版まで上げる（今は版 1 だけ）
  function migrate(obj) {
    if (obj.version > CURRENT_VERSION) throw new Error("newer version");
    // 例: if (obj.version === 1) { ...; obj.version = 2; }
    return obj;
  }

  root.PaycleCalc = {
    CURRENT_VERSION: CURRENT_VERSION,
    CATEGORIES: CATEGORIES,
    categoryLabel: categoryLabel,
    isDate: isDate, daysInMonth: daysInMonth, addDays: addDays, diffDays: diffDays,
    todayStr: todayStr, ymOf: ymOf, addMonthsYm: addMonthsYm, monthStart: monthStart, monthEnd: monthEnd,
    priceOn: priceOn, lastYen: lastYen, toMonthly: toMonthly, monthlyNow: monthlyNow,
    billDateAt: billDateAt, bills: bills, nextBill: nextBill, defaultLastPaid: defaultLastPaid,
    trialPending: trialPending, pendingTrials: pendingTrials,
    summary: summary, monthBills: monthBills, history: history, alerts: alerts,
    passedSince: passedSince, ranking: ranking, pie: pie, saved: saved,
    sortItems: sortItems, usageFlag: usageFlag, exportDue: exportDue,
    validateData: validateData, migrate: migrate
  };
})(typeof window !== "undefined" ? window : this);
