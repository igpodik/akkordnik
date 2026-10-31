import { SHAPES, chordSVG } from "./chords.js";
import { unlockAudio, releaseAudio, strum, click, outputLatency } from "./audio.js";

/*
  Страница песни: плеер боя, карта песни, аппликатуры, советы.
  mountPlayer рисует всё внутри root и возвращает { destroy }, который останавливает звук и анимацию.
*/

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}

function buildTimeline(song, nameOf) {
  var events = [], parts = [], pos = 0, id = 0;
  song.parts.forEach(function (p) {
    var part = { name: p.name, start: pos, lines: [] };
    p.lines.forEach(function (line) {
      var l = [];
      line.forEach(function (c) {
        var ev = { id: id++, chord: c[0], start: pos, len: c[1] * 2 };
        events.push(ev);
        l.push(ev);
        pos += ev.len;
      });
      part.lines.push(l);
    });
    part.end = pos;
    if (part.end > part.start) parts.push(part);
  });
  return makeIndex({ events: events, parts: parts, total: pos });
}

function pairTimeline(a, b) {
  return makeIndex({ events: [{ id: 0, chord: a, start: 0, len: 8 }, { id: 1, chord: b, start: 8, len: 8 }], parts: [], total: 16, pair: true });
}

function makeIndex(tl) {
  tl.byEighth = new Array(tl.total);
  tl.events.forEach(function (ev, i) { for (var k = ev.start; k < ev.start + ev.len; k++) tl.byEighth[k] = i; });
  return tl;
}

function template(song, opts) {
  return '' +
    (opts.showHeader ? '<header class="song-head"><a class="back" href="#">Все песни</a>' +
      '<h1><span class="band">' + esc(song.artist ? song.artist + "." : "") + '</span> ' + esc(song.title) + '</h1></header>' : '') +
    '<div class="player">' +
      '<div class="stage">' +
        '<div class="cell now"><div class="cell-label">Сейчас</div><div class="chord-now-name" data-r="nowName"></div>' +
          '<div data-r="nowDiagram"></div><div class="meter"><i data-r="meter"></i></div><div class="change-in" data-r="changeIn"></div></div>' +
        '<div class="cell"><div class="cell-label">Рука</div><canvas class="hand" data-r="hand"></canvas>' +
          '<div class="strum-word rest" data-r="strumWord">Нажми Играть</div></div>' +
        '<div class="cell next"><div class="cell-label">Дальше</div><div class="chord-next-name" data-r="nextName"></div><div data-r="nextDiagram"></div></div>' +
      '</div>' +
      '<div class="lane-box"><canvas class="lane" data-r="lane" aria-label="Лента боя: каждый столбик это восьмая доля"></canvas></div>' +
      '<div class="controls">' +
        '<div class="row">' +
          '<button class="btn" data-r="play" type="button">Играть</button>' +
          '<button class="btn ghost" data-r="soundBtn" type="button" aria-pressed="true">Звук гитары</button>' +
          '<button class="btn ghost" data-r="metroBtn" type="button" aria-pressed="false">Метроном</button>' +
        '</div>' +
        '<div class="row">' +
          '<div class="field"><label><span>Темп: <span class="mono" data-r="tempoVal"></span>, в оригинале <span class="mono">' + song.tempo + '</span> ударов в минуту</span>' +
            '<input type="range" data-r="tempo" min="' + Math.min(40, song.tempo) + '" max="' + song.tempo + '" step="1"></label>' +
            (song.tempoNote ? '<div class="small">' + esc(song.tempoNote) + '</div>' : '') + '</div>' +
          '<div class="field"><label><span>Что играть по кругу</span><select data-r="range"></select></label></div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="seg" role="group" aria-label="Бой">' +
            '<button type="button" data-r="patMain" aria-pressed="true">Основной бой</button>' +
            '<button type="button" data-r="patEasy" aria-pressed="false">Только вниз</button>' +
          '</div>' +
          (Object.keys(song.easyMap).length ? '<button class="btn ghost" data-r="easyBtn" type="button" aria-pressed="false">Лёгкие аккорды</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<section><h2>Карта песни</h2><p class="sub">Ширина плашки показывает, сколько длится аккорд. Нажми на любую, чтобы начать с этого места. Длительности примерные: сверяйся с записью.</p><div class="map" data-r="map"></div></section>' +
    '<section><h2>Аккорды</h2><p class="sub">Цифра в кружке это палец: 1 указательный, 2 средний, 3 безымянный, 4 мизинец. Кружок сверху значит открытая струна, крестик значит эту струну не играть.</p><div class="chords" data-r="chordCards"></div></section>' +
    '<section class="tips"><h2>Как учить</h2><ol data-r="tips"></ol></section>';
}

export function mountPlayer(root, song, opts) {
  opts = opts || {};
  root.innerHTML = template(song, opts);
  var R = {};
  root.querySelectorAll("[data-r]").forEach(function (el) { R[el.getAttribute("data-r")] = el; });

  var easyChords = false, patternKey = "main", soundOn = true, metroOn = false;
  var tempo = song.start;
  var timeline, active, rangeStart = 0, rangeLen = 0, startPos = 0;
  var playing = false, t0 = 0, nextK = -8, ctx = null, schedTimer = null, raf = 0;
  var lastNow = null, lastNext = null, lastMapId = -1;
  var colors = {}, colorTimer = setInterval(readColors, 700);

  function chordName(c) { return (easyChords && song.easyMap[c]) ? song.easyMap[c] : c; }
  function wrap(i) { var r = (i - rangeStart) % rangeLen; if (r < 0) r += rangeLen; return rangeStart + r; }
  function eps() { return tempo / 60 * 2; }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--ink", "--muted", "--line", "--lamp", "--lamp-soft", "--frost", "--bg"].forEach(function (k) { colors[k] = cs.getPropertyValue(k).trim(); });
    colors.font = getComputedStyle(document.body).fontFamily;
    colors.mono = getComputedStyle(R.tempoVal).fontFamily;
  }

  /* Планировщик: заранее ставит удары в очередь аудио, так ритм не плывёт даже при подтормаживании страницы */
  function scheduler() {
    var now = ctx.currentTime, e = eps(), pat = song.patterns[patternKey];
    while (t0 + nextK / e < now + 0.12) {
      var tk = t0 + nextK / e;
      if (nextK < 0) { if (nextK % 2 === 0) click(tk, nextK === -8); }
      else {
        var idx = wrap(startPos + nextK);
        var ev = active.events[active.byEighth[idx]];
        var slot = pat[idx % 8];
        if (slot && soundOn) strum(chordName(ev.chord), slot, tk);
        if (metroOn && idx % 2 === 0) click(tk, idx % 8 === 0);
      }
      nextK++;
    }
  }
  function currentK() {
    if (!playing) return 0;
    return (ctx.currentTime - outputLatency() - t0) * eps();
  }
  function play() {
    ctx = unlockAudio();
    playing = true;
    nextK = -8;
    t0 = ctx.currentTime + 0.12 + 8 / eps();
    scheduler();
    schedTimer = setInterval(scheduler, 25);
    R.play.textContent = "Пауза";
  }
  function stop() {
    if (!playing) return;
    var k = Math.floor(Math.max(0, currentK()));
    startPos = wrap(startPos + k);
    playing = false;
    clearInterval(schedTimer);
    releaseAudio();
    R.play.textContent = "Играть";
  }
  function restartIfPlaying(fn) { var was = playing; stop(); fn(); if (was) play(); }

  function buildRangeOptions() {
    var html = '<option value="all">Вся песня</option>', seen = {};
    timeline.parts.forEach(function (p, i) {
      var base = p.name.replace(/\s*\d+$/, "");
      if (seen[base]) return;
      seen[base] = true;
      html += '<option value="part:' + i + '">' + esc(base) + "</option>";
    });
    var pseen = {};
    song.pairs.forEach(function (pr) {
      var a = chordName(pr[0]), b = chordName(pr[1]);
      if (a === b || pseen[a + b]) return;
      pseen[a + b] = true;
      html += '<option value="pair:' + a + ":" + b + '">Смена ' + a + " и " + b + "</option>";
    });
    R.range.innerHTML = html;
  }
  function selectRange(v) {
    R.range.value = v;
    if (v === "all") { active = timeline; rangeStart = 0; rangeLen = timeline.total; startPos = 0; }
    else if (v.indexOf("part:") === 0) {
      var p = timeline.parts[+v.slice(5)];
      active = timeline; rangeStart = p.start; rangeLen = p.end - p.start; startPos = p.start;
    } else {
      var bits = v.split(":");
      active = pairTimeline(bits[1], bits[2]); rangeStart = 0; rangeLen = 16; startPos = 0;
    }
    R.map.classList.toggle("dim", !!active.pair);
    lastMapId = -1;
  }
  function renderMap() {
    var html = "";
    timeline.parts.forEach(function (p) {
      html += '<div class="part"><div class="part-title">' + esc(p.name) + "</div>";
      p.lines.forEach(function (line) {
        html += '<div class="line">';
        line.forEach(function (ev) {
          var nm = chordName(ev.chord), sub = nm !== ev.chord;
          html += '<button type="button" class="chip' + (sub ? " subst" : "") + '" data-ev="' + ev.id + '" style="width:' + (ev.len * 9 + 4) + 'px" aria-label="' + nm + ", " + (ev.len / 2) + ' доли">' + nm + "</button>";
        });
        html += "</div>";
      });
      html += "</div>";
    });
    R.map.innerHTML = html;
  }
  function renderChordCards() {
    var used = [];
    timeline.events.forEach(function (ev) { var n = chordName(ev.chord); if (used.indexOf(n) < 0) used.push(n); });
    R.chordCards.innerHTML = used.map(function (n) {
      return '<div class="chord-card"><b>' + n + "</b>" + chordSVG(n) + "<small>" + esc(SHAPES[n].note || "") + "</small></div>";
    }).join("");
  }
  function renderTips() {
    var items = [];
    if (song.patternText) items.push(song.patternText);
    if (song.easyText) items.push(song.easyText);
    items = items.concat(song.tips);
    R.tips.innerHTML = items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    R.tips.parentNode.hidden = items.length === 0;
  }

  function fitCanvas(c) {
    var dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, w: r.width, h: r.height };
  }
  function strumColor(dir) { return dir === "D" ? colors["--lamp"] : dir === "M" ? colors["--ink"] : colors["--frost"]; }

  function drawHand(k, idx, pat) {
    var o = fitCanvas(R.hand), g = o.g, W = o.w, H = o.h;
    g.clearRect(0, 0, W, H);
    var top = H * 0.12, bot = H * 0.88, sx = W * 0.2, ex = W * 0.95;
    var progress = -1, dir = null;
    if (playing && k >= 0) {
      var slot = pat[idx % 8];
      var secIn = (k - Math.floor(k)) / eps();
      if (slot) { dir = slot; progress = Math.min(1, secIn / 0.11); }
    }
    var downish = dir === "D" || dir === "M";
    for (var s = 0; s < 6; s++) {
      var y = top + (bot - top) * s / 5, hit = false;
      if (dir) {
        var reach = downish ? progress * 5 : 5 - progress * 3;
        hit = downish ? s <= reach : (s >= reach && s >= 2);
      }
      g.strokeStyle = hit ? strumColor(dir) : colors["--muted"];
      g.lineWidth = 3.2 - s * 0.45;
      g.beginPath(); g.moveTo(sx, y); g.lineTo(ex, y); g.stroke();
      g.fillStyle = colors["--muted"];
      g.font = "500 10px " + colors.font;
      g.textBaseline = "middle";
      g.fillText(String(6 - s), 2, y);
    }
    if (dir) {
      var yy = downish ? top + (bot - top) * progress : bot - (bot - top) * 0.6 * progress;
      var cx = (sx + ex) / 2;
      g.fillStyle = strumColor(dir);
      g.globalAlpha = 0.25;
      if (downish) g.fillRect(cx - 7, top - 6, 14, yy - top + 6); else g.fillRect(cx - 7, yy, 14, bot - yy + 6);
      g.globalAlpha = 1;
      g.beginPath(); g.arc(cx, yy, 9, 0, Math.PI * 2); g.fill();
    }
  }

  function drawLane(k) {
    var o = fitCanvas(R.lane), g = o.g, W = o.w, H = o.h;
    g.clearRect(0, 0, W, H);
    var slotW = Math.max(30, Math.min(46, W / 12));
    var ph = W * 0.26;
    var pos = playing ? k : 0;
    var pat = song.patterns[patternKey];
    var jFrom = Math.floor(pos - ph / slotW) - 1, jTo = Math.ceil(pos + (W - ph) / slotW) + 1;
    var curEvI = active.byEighth[wrap(startPos + Math.floor(Math.max(0, pos)))];

    var runStart = null, runEv = null;
    function flush(jEnd) {
      if (runEv === null) return;
      var x1 = ph + (runStart - pos) * slotW, x2 = ph + (jEnd - pos) * slotW;
      var isCur = runEv === curEvI && pos >= 0;
      g.fillStyle = isCur ? colors["--lamp-soft"] : colors["--bg"];
      g.fillRect(x1 + 1, 6, x2 - x1 - 2, 26);
      g.strokeStyle = isCur ? colors["--lamp"] : colors["--line"];
      g.lineWidth = 1;
      g.strokeRect(x1 + 1.5, 6.5, x2 - x1 - 3, 25);
      g.fillStyle = isCur ? colors["--lamp"] : colors["--ink"];
      g.font = "600 15px " + colors.mono;
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillText(chordName(active.events[runEv].chord), Math.max(x1 + 7, Math.min(ph + 4, x2 - 40)), 19.5);
    }
    for (var j = jFrom; j <= jTo; j++) {
      var evI = (j < 0 && playing) ? null : active.byEighth[wrap(startPos + j)];
      var newRun = (evI !== runEv) || (evI !== null && wrap(startPos + j) === active.events[evI].start);
      if (newRun) { flush(j); runStart = j; runEv = evI; }
    }
    flush(jTo + 1);

    for (var jj = jFrom; jj <= jTo; jj++) {
      var x = ph + (jj - pos) * slotW + slotW / 2;
      var countIn = playing && jj < 0;
      var idx = wrap(startPos + jj);
      var slot = countIn ? "" : pat[idx % 8];
      g.globalAlpha = jj < Math.floor(pos) ? 0.35 : 1;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "600 13px " + colors.font;
      if (slot === "D") { g.fillStyle = colors["--lamp"]; g.fillText("вниз", x, 56); g.fillRect(x - 1.5, 66, 3, 14); }
      else if (slot === "M") { g.fillStyle = colors["--ink"]; g.fillText("глуш", x, 56); g.fillRect(x - 4, 70, 8, 3); }
      else if (slot === "U") { g.fillStyle = colors["--frost"]; g.fillText("вверх", x, 76); g.fillRect(x - 1.5, 46, 3, 14); }
      else { g.fillStyle = colors["--line"]; g.beginPath(); g.arc(x, 63, 3, 0, Math.PI * 2); g.fill(); }
      var cIdx = countIn ? (jj + 8) : idx;
      g.fillStyle = (cIdx % 8 === 0) ? colors["--ink"] : colors["--muted"];
      g.font = (cIdx % 2 === 0 ? "600 13px " : "400 12px ") + colors.mono;
      g.fillText(cIdx % 2 === 0 ? String((cIdx % 8) / 2 + 1) : "и", x, 100);
      g.globalAlpha = 1;
    }
    g.textAlign = "left";
    g.fillStyle = colors["--ink"];
    g.fillRect(ph - 1, 38, 2, H - 38);
  }

  function frame() {
    var k = currentK();
    var counting = playing && k < 0;
    var kk = Math.max(0, k);
    var idx = wrap(startPos + Math.floor(kk));
    var ev = active.events[active.byEighth[idx]];
    var nowN = chordName(ev.chord);
    var nextEv = active.events[active.byEighth[wrap(ev.start + ev.len)]];
    var nextN = chordName(nextEv.chord);
    if (nowN !== lastNow) { R.nowName.textContent = nowN; R.nowDiagram.innerHTML = chordSVG(nowN); lastNow = nowN; }
    if (nextN !== lastNext) { R.nextName.textContent = nextN; R.nextDiagram.innerHTML = chordSVG(nextN); lastNext = nextN; }

    var posInEv = (idx - ev.start) + (kk - Math.floor(kk));
    R.meter.style.width = Math.min(100, posInEv / ev.len * 100) + "%";
    var left = (ev.len - posInEv) / 2;
    R.changeIn.textContent = nextN === nowN ? "дальше тот же аккорд" : "смена через " + (left <= 1 ? "1 долю" : Math.ceil(left) + " доли");

    var pat = song.patterns[patternKey], w = R.strumWord;
    if (counting) { w.className = "strum-word rest"; w.textContent = "Отсчёт " + (Math.floor((k + 8) / 2) + 1); }
    else if (!playing) { w.className = "strum-word rest"; w.textContent = "Нажми Играть"; }
    else {
      var slot = pat[idx % 8];
      w.className = "strum-word " + (slot === "D" ? "down" : slot === "U" ? "up" : slot === "M" ? "mute" : "rest");
      w.textContent = slot === "D" ? "Вниз" : slot === "U" ? "Вверх" : slot === "M" ? "Глушение" : "пауза";
    }

    drawHand(k, idx, pat);
    drawLane(k);

    if (!active.pair && ev.id !== lastMapId) {
      var prev = R.map.querySelector(".chip.now"); if (prev) prev.classList.remove("now");
      var cur = R.map.querySelector('.chip[data-ev="' + ev.id + '"]'); if (cur) cur.classList.add("now");
      lastMapId = ev.id;
    }
    raf = requestAnimationFrame(frame);
  }

  /* Свёрнутая вкладка тормозит таймеры, ритм начнёт заикаться, поэтому ставим на паузу */
  function onVisibility() { if (document.hidden) stop(); }

  R.play.addEventListener("click", function () { if (playing) stop(); else play(); });
  R.tempo.value = tempo;
  R.tempoVal.textContent = tempo;
  R.tempo.addEventListener("input", function () {
    var k = currentK();
    tempo = +R.tempo.value;
    R.tempoVal.textContent = tempo;
    if (playing) {
      var lat = outputLatency();
      t0 = ctx.currentTime - lat - k / eps();
      nextK = Math.ceil(k + (0.12 + lat) * eps());
    }
  });
  R.range.addEventListener("change", function () { var v = R.range.value; restartIfPlaying(function () { selectRange(v); }); });
  R.soundBtn.addEventListener("click", function () { soundOn = !soundOn; R.soundBtn.setAttribute("aria-pressed", soundOn); });
  R.metroBtn.addEventListener("click", function () { metroOn = !metroOn; R.metroBtn.setAttribute("aria-pressed", metroOn); });
  function setPattern(p) {
    patternKey = p;
    R.patMain.setAttribute("aria-pressed", p === "main");
    R.patEasy.setAttribute("aria-pressed", p === "easy");
  }
  R.patMain.addEventListener("click", function () { setPattern("main"); });
  R.patEasy.addEventListener("click", function () { setPattern("easy"); });
  if (R.easyBtn) R.easyBtn.addEventListener("click", function () {
    restartIfPlaying(function () {
      easyChords = !easyChords;
      R.easyBtn.setAttribute("aria-pressed", easyChords);
      var keep = R.range.value.indexOf("pair:") === 0 ? "all" : R.range.value;
      buildRangeOptions(); selectRange(keep);
      renderMap(); renderChordCards();
      lastNow = lastNext = null;
    });
  });
  R.map.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip"); if (!chip) return;
    var ev = timeline.events[+chip.dataset.ev];
    restartIfPlaying(function () { selectRange("all"); startPos = ev.start; });
  });
  document.addEventListener("visibilitychange", onVisibility);

  timeline = buildTimeline(song);
  buildRangeOptions();
  selectRange("all");
  renderMap();
  renderChordCards();
  renderTips();
  readColors();
  raf = requestAnimationFrame(frame);

  return {
    destroy: function () {
      stop();
      cancelAnimationFrame(raf);
      clearInterval(colorTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      root.innerHTML = "";
    }
  };
}
