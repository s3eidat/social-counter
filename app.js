/* Social Counter — all counting happens locally. */
(function () {
  "use strict";
  var $ = S3.$;
  var HTTPS = "https:" + "//";

  // ---------- graphemes ----------
  var seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  function graphemes(s) {
    if (!seg) return Array.from(s);
    var out = []; for (var it = seg.segment(s)[Symbol.iterator](), r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
    return out;
  }
  var EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

  // ---------- links ----------
  var TLD = "com|net|org|io|co|ai|app|dev|me|info|biz|edu|gov|uk|jo|sa|ae|eg|qa|kw|bh|om|ma|tn|lb|iq|ps|de|fr|es|it|nl|ly|gl|tv|us|ca|au|in|news|blog|shop|store|xyz|link|site|online|tech";
  var URL_RX = new RegExp("(?:https?:\\/\\/|www\\.)[^\\s<>\"]+|\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:" + TLD + ")\\b(?:\\/[^\\s<>\"]*)?", "gi");
  function links(s) {
    var out = [], m;
    URL_RX.lastIndex = 0;
    while ((m = URL_RX.exec(s))) {
      var u = m[0].replace(/[.,!?:;'")\]}»”’]+$/, "");
      if (m.index > 0 && /[@\w]/.test(s[m.index - 1])) continue; // part of an email or a word
      out.push({ start: m.index, end: m.index + u.length, url: u });
    }
    return out;
  }

  // ---------- X weighted length (twitter-text v3 rules) ----------
  // Code points in these ranges weigh 1, everything else 2; every emoji sequence weighs 2; every link weighs 23.
  var LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
  function cpWeight(cp) { for (var i = 0; i < LIGHT.length; i++) if (cp >= LIGHT[i][0] && cp <= LIGHT[i][1]) return 1; return 2; }
  function xLen(text) {
    var s = text.normalize("NFC"), total = 0, pos = 0;
    links(s).forEach(function (l) { total += weigh(s.slice(pos, l.start)) + 23; pos = l.end; });
    return total + weigh(s.slice(pos));
  }
  function weigh(s) {
    var n = 0;
    graphemes(s).forEach(function (g) {
      if (EMOJI.test(g)) { n += 2; return; }
      for (var c of g) n += cpWeight(c.codePointAt(0));
    });
    return n;
  }

  // ---------- SMS: GSM 03.38 vs UCS-2 ----------
  var GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  var GSM_EXT = "\f^{}\\[~]|€"; // each costs two septets (escape + char)
  var GSM_SET = new Set(Array.from(GSM)), EXT_SET = new Set(Array.from(GSM_EXT));
  function sms(text) {
    var chars = Array.from(text), gsm = chars.every(function (c) { return GSM_SET.has(c) || EXT_SET.has(c); });
    var single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    var units = chars.map(function (c) { return gsm ? (EXT_SET.has(c) ? 2 : 1) : c.length; }); // UCS-2: surrogate pairs take 2
    var total = units.reduce(function (a, b) { return a + b; }, 0);
    if (!total) return { gsm: gsm, total: 0, segments: 0, per: single, remaining: single, bad: [] };
    if (total <= single) return { gsm: gsm, total: total, segments: 1, per: single, remaining: single - total, bad: nonGsm(chars) };
    // Greedy fill: an escape pair or a surrogate pair is never split across parts.
    var segs = 1, used = 0;
    units.forEach(function (u) { if (used + u > multi) { segs++; used = 0; } used += u; });
    return { gsm: gsm, total: total, segments: segs, per: multi, remaining: multi - used, bad: nonGsm(chars) };
  }
  function nonGsm(chars) {
    var seen = new Map();
    chars.forEach(function (c) { if (!GSM_SET.has(c) && !EXT_SET.has(c)) seen.set(c, (seen.get(c) || 0) + 1); });
    return Array.from(seen, function (e) { return { c: e[0], n: e[1] }; });
  }
  var LOOKALIKE = { "“": '"', "”": '"', "„": '"', "«": '"', "»": '"', "‘": "'", "’": "'", "‚": "'", "´": "'", "`": "'", "–": "-", "—": "-", "‑": "-", "…": "...",
    " ": " ", " ": " ", " ": " ", "\t": " ", "•": "-", "·": "-", "×": "x", "ç": "Ç", "​": "", "‌": "", "‍": "", "﻿": "" };
  function toGsm(s) { return Array.from(s).map(function (c) { return Object.prototype.hasOwnProperty.call(LOOKALIKE, c) ? LOOKALIKE[c] : c; }).join(""); }

  // ---------- other counts ----------
  function hashtags(s) { return (s.match(/(^|[^\p{L}\p{N}_&/])#[\p{L}\p{M}\p{N}_]*[\p{L}\p{M}_][\p{L}\p{M}\p{N}_]*/gu) || []).length; }
  function mentions(s) { return (s.match(/(^|[^\p{L}\p{N}_.])@[A-Za-z0-9_.]+/gu) || []).length; }
  function words(s) { return (s.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*/gu) || []).length; }
  var ctx2d = null;
  function titlePx(s) {
    if (!ctx2d) ctx2d = document.createElement("canvas").getContext("2d");
    ctx2d.font = "20px Arial, Helvetica, sans-serif";
    return Math.round(ctx2d.measureText(s.replace(/\s+/g, " ").trim()).width);
  }

  var METERS = [
    { k: "x", name: "X (Twitter) post", limit: 280, count: function (t) { return t.x; }, note: "Weighted: links 23, emoji 2, CJK 2. Premium allows 25,000." },
    { k: "threads", name: "Threads", limit: 500, count: function (t) { return t.g; } },
    { k: "bsky", name: "Bluesky", limit: 300, count: function (t) { return t.g; } },
    { k: "ig", name: "Instagram caption", limit: 2200, count: function (t) { return t.g; }, note: "About 125 characters show before “more”.", tags: 30 },
    { k: "li", name: "LinkedIn post", limit: 3000, count: function (t) { return t.g; }, note: "About 210 characters show before “see more”." },
    { k: "fb", name: "Facebook post", limit: 63206, count: function (t) { return t.g; } },
    { k: "tt", name: "TikTok caption", limit: 4000, count: function (t) { return t.g; } },
    { k: "yt", name: "YouTube title", limit: 100, count: function (t) { return t.g; }, angle: true },
    { k: "ytd", name: "YouTube description", limit: 5000, count: function (t) { return t.g; }, angle: true },
    { k: "pin", name: "Pinterest description", limit: 500, count: function (t) { return t.g; } },
    { k: "gt", name: "Google title", limit: 60, soft: true, count: function (t) { return t.g; }, px: true },
    { k: "gd", name: "Meta description", limit: 160, soft: true, count: function (t) { return t.g; }, note: "Google trims snippets at about 155–160 characters on desktop." }
  ];

  function analyze(text) {
    var g = graphemes(text);
    return {
      g: g.length, x: xLen(text), utf16: text.length, words: words(text), tags: hashtags(text), at: mentions(text),
      links: links(text.normalize("NFC")).length, emoji: g.filter(function (c) { return EMOJI.test(c); }).length,
      lines: text ? text.split("\n").length : 0
    };
  }

  // ---------- UI ----------
  var input = $("#input");
  function stat(label, value) { return '<div class="stat"><b>' + S3.esc(value) + "</b><span>" + S3.esc(label) + "</span></div>"; }
  function fmt(n) { return n.toLocaleString(); }

  function render() {
    var text = input.value, a = analyze(text);
    $("#stats").innerHTML = stat("characters", fmt(a.g)) + stat("words", fmt(a.words)) + stat("hashtags", fmt(a.tags)) +
      stat("mentions", fmt(a.at)) + stat("links", fmt(a.links)) + stat("emoji", fmt(a.emoji));

    var ul = $("#meters"); ul.textContent = "";
    METERS.forEach(function (m) {
      var n = m.count(a), pct = n / m.limit, over = n - m.limit;
      var cls = over > 0 ? "is-over" : pct >= 0.9 ? "is-warn" : "";
      var notes = [];
      if (m.note) notes.push(m.note);
      if (m.px && text.trim()) notes.push("≈ " + titlePx(text) + " px wide of about 600 px.");
      if (m.angle && /[<>]/.test(text)) notes.push("YouTube doesn't allow < or >.");
      var right = S3.h("span", { "class": "sc-n" }, [S3.h("b", { text: fmt(n) }), " / " + (m.soft ? "~" : "") + fmt(m.limit)]);
      var li = S3.h("li", { "class": cls }, [
        S3.h("div", { "class": "sc-top" }, [S3.h("span", { "class": "sc-name", text: m.name }), right]),
        S3.h("div", { "class": "sc-bar" }, [S3.h("i", { style: "width:" + Math.min(100, pct * 100).toFixed(1) + "%" })])
      ]);
      var info = S3.h("div", { "class": "sc-note" });
      if (over > 0) info.appendChild(S3.h("b", { "class": "sc-overby", text: fmt(over) + " over" + (m.soft ? " (may be cut off)" : "") }));
      else if (text) info.appendChild(S3.h("span", { "class": "sc-left", text: fmt(m.limit - n) + " left" }));
      if (m.tags) info.appendChild(S3.h("span", { "class": "chip" + (a.tags > m.tags ? " bad" : ""), text: a.tags + " / " + m.tags + " hashtags" }));
      notes.forEach(function (x) { info.appendChild(S3.h("span", { "class": "faint", text: x })); });
      if (info.childNodes.length) li.appendChild(info);
      ul.appendChild(li);
    });

    var s = sms(text), enc = $("#enc");
    enc.textContent = s.gsm ? "GSM-7" : "Unicode (UCS-2)";
    enc.className = "chip " + (s.gsm ? "ok" : "warn");
    var unit = s.gsm ? "characters" : "UTF-16 units";
    $("#parts").innerHTML = stat("SMS parts", fmt(s.segments)) + stat(unit + " used", fmt(s.total)) +
      stat("left in this part", fmt(s.segments ? s.remaining : s.per)) + stat("per part", s.segments > 1 ? s.per : (s.gsm ? 160 : 70));
    $("#smsNote").textContent = s.gsm
      ? "GSM-7: 160 characters fit in one SMS, 153 per part when split. ^ { } [ ] ~ \\ | € count as two."
      : "Unicode: 70 characters fit in one SMS, 67 per part when split. Arabic, emoji and many symbols force this mode; emoji take two units.";
    var box = $("#nongsm"); box.textContent = "";
    box.hidden = s.gsm || !s.bad.length;
    if (!box.hidden) {
      var fixable = s.bad.filter(function (b) { return Object.prototype.hasOwnProperty.call(LOOKALIKE, b.c); });
      box.appendChild(S3.h("span", { "class": "faint", text: "Characters forcing Unicode:" }));
      s.bad.slice(0, 24).forEach(function (b) {
        var label = b.c === " " ? "nbsp" : /[​-‍﻿]/.test(b.c) ? "zero-width" : b.c === "\t" ? "tab" : b.c;
        box.appendChild(S3.h("span", { "class": "chip mono", dir: "auto", text: label + (b.n > 1 ? " ×" + b.n : "") }));
      });
      if (s.bad.length > 24) box.appendChild(S3.h("span", { "class": "faint", text: "+" + (s.bad.length - 24) + " more" }));
      if (fixable.length) box.appendChild(S3.h("button", { "class": "btn small", type: "button", text: "Replace " + fixable.length + " with GSM look-alikes", onclick: function () {
        var before = sms(input.value).segments;
        input.value = toGsm(input.value); render(); save();
        var after = sms(input.value);
        S3.toast(after.gsm ? "Now GSM-7: " + before + " → " + after.segments + " part" + (after.segments === 1 ? "" : "s") : "Replaced; other characters still need Unicode");
        S3.done();
      } }));
    }
  }

  var save = S3.debounce(function () { S3.store("sc.text", input.value || undefined); }, 400);
  input.addEventListener("input", function () { render(); save(); });
  $("#clear").addEventListener("click", function () { input.value = ""; S3.store("sc.text", undefined); render(); input.focus(); });
  $("#copy").addEventListener("click", function () { if (!input.value) return S3.toast("Nothing to copy yet", "error"); S3.copy(input.value); S3.done(); });
  var SAMPLE = "New on the blog: 7 habits that make code reviews faster 🚀\n\nShort PRs, clear titles and a checklist go a long way. Read it here: " + HTTPS + "example.com/blog/code-reviews\n\n#coding #devtips #productivity";
  $("#sample").addEventListener("click", function () { input.value = SAMPLE; render(); save(); });

  input.value = S3.store("sc.text") || "";
  render();

  window.S3_DEMO = function () { input.value = SAMPLE; render(); };

  window.S3_SELFTEST = function () {
    var f = [];
    function eq(n, got, want) { if (got !== want) f.push(n + ": got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }
    function rep(c, n) { return new Array(n + 1).join(c); }
    // X weighted length
    eq("x latin 280", xLen(rep("a", 280)), 280);
    eq("x arabic", xLen(rep("ب", 280)), 280);
    eq("x cjk", xLen("中文"), 4);
    eq("x url", xLen(HTTPS + "example.com/" + rep("a", 60)), 23);
    eq("x bare url", xLen("Go to www.example.com now"), 6 + 23 + 4);
    eq("x domain", xLen("see example.com."), 4 + 23 + 1);
    eq("x family emoji", xLen("👨‍👩‍👧"), 2);
    eq("x flag", xLen("🇯🇴"), 2);
    eq("x skin tone", xLen("👍🏽!"), 3);
    eq("x nfc", xLen("é"), 1);
    eq("x email not link", links("mail me@example.com").length, 0);
    // SMS
    function seg2(t) { var s = sms(t); return (s.gsm ? "G" : "U") + s.segments; }
    eq("gsm 160", seg2(rep("a", 160)), "G1");
    eq("gsm 161", seg2(rep("a", 161)), "G2");
    eq("gsm 306", seg2(rep("a", 306)), "G2");
    eq("gsm 307", seg2(rep("a", 307)), "G3");
    eq("ucs 70", seg2(rep("ب", 70)), "U1");
    eq("ucs 71", seg2(rep("ب", 71)), "U2");
    eq("ucs 134", seg2(rep("ب", 134)), "U2");
    eq("ucs 135", seg2(rep("ب", 135)), "U3");
    eq("ext 80", seg2(rep("{", 80)), "G1");
    eq("ext 81", seg2(rep("{", 81)), "G2");
    eq("euro units", sms("€").total, 2);
    eq("ext not split", sms(rep("a", 152) + "{" + rep("a", 152)).segments, 3); // 152 | 2+151 | 1
    eq("emoji ucs units", sms("😀").total, 2);
    eq("emoji not split", sms(rep("ب", 66) + "😀" + rep("ب", 10)).segments, 2);
    eq("lookalike", sms(toGsm("“Hi” – it’s fine…")).gsm, true);
    // counts
    eq("graphemes", graphemes("👍🏽é").length, 2);
    eq("hashtags", hashtags("#one #two x#no #3 #تجربة"), 3);
    eq("mentions", mentions("@a hi @b_c and a@b.com"), 2);
    return f.length ? f : true;
  };
})();
