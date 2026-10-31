import { SHAPES } from "./chords.js";

/*
  Разбор файла песни в формате .song. Полное описание формата в README.md.
  Возвращает { song, errors }. Если errors не пустой, страницу песни показывать нельзя.
*/

var META_KEYS = {
  "title": true, "artist": true, "tempo": true, "start": true,
  "strum": true, "easy-strum": true, "strum-text": true,
  "easy-chords": true, "easy-text": true, "tempo-note": true,
  "pairs": true, "tip": true
};

var STRUM_TOKENS = { "D": "D", "U": "U", "M": "M", "-": "" };

export function parseSong(text, slug) {
  var song = {
    slug: slug || "",
    title: "",
    artist: "",
    tempo: 0,
    start: 0,
    tempoNote: "",
    patterns: { main: ["D", "U", "D", "U", "D", "U", "D", "U"], easy: ["D", "", "D", "", "D", "", "D", ""] },
    patternText: "",
    easyMap: {},
    easyText: "",
    pairs: [],
    tips: [],
    parts: []
  };
  var errors = [];
  var current = null;
  var lines = String(text || "").replace(/\r/g, "").split("\n");

  function err(ln, msg) { errors.push({ line: ln, message: msg }); }

  for (var i = 0; i < lines.length; i++) {
    var ln = i + 1;
    var line = lines[i].replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    /* Заголовок раздела: [Припев] или [Куплет 2] = Куплет 1 */
    var head = line.match(/^\[(.+?)\]\s*(?:=\s*(.+))?$/);
    if (head) {
      current = { name: head[1].trim(), copyFrom: head[2] ? head[2].trim() : "", lines: [], line: ln };
      song.parts.push(current);
      continue;
    }

    /* До первого раздела идут поля вида ключ: значение */
    if (!current) {
      var meta = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!meta) { err(ln, "Ожидалось поле вида «title: Название» или заголовок раздела в квадратных скобках."); continue; }
      var key = meta[1].toLowerCase(), val = meta[2].trim();
      if (!META_KEYS[key]) { err(ln, "Неизвестное поле «" + key + "»."); continue; }
      applyMeta(song, key, val, ln, err);
      continue;
    }

    /* Строка аккордов: Em:2 Bm:2 C:4 x3 */
    if (current.copyFrom) { err(ln, "Раздел «" + current.name + "» копирует другой раздел, свои аккорды ему писать нельзя."); continue; }
    var parsed = parseChordLine(line, ln, err);
    for (var r = 0; r < parsed.repeat; r++) current.lines.push(parsed.chords.slice());
  }

  /* Копирование разделов: явное через = и неявное, когда пустой раздел назван как уже встреченный */
  var seen = {};
  song.parts.forEach(function (p) {
    var src = p.copyFrom || (p.lines.length === 0 ? p.name : "");
    if (src) {
      var from = seen[src];
      if (!from) err(p.line, "Раздел «" + src + "» не найден выше, копировать нечего.");
      else p.lines = from.lines.map(function (l) { return l.slice(); });
    }
    if (p.lines.length && !seen[p.name]) seen[p.name] = p;
    delete p.copyFrom;
    delete p.line;
  });

  if (!song.title) err(1, "Нет поля title.");
  if (!song.tempo) err(1, "Нет поля tempo (темп оригинала в ударах в минуту).");
  if (!song.parts.length) err(lines.length, "Нет ни одного раздела с аккордами.");
  if (!song.start) song.start = Math.max(40, Math.round(song.tempo * 0.55));
  if (song.start > song.tempo) song.start = song.tempo;

  /* Пары для тренировки смен: если не заданы, берём первые смены песни */
  if (!song.pairs.length) song.pairs = autoPairs(song);

  return { song: song, errors: errors };
}

function applyMeta(song, key, val, ln, err) {
  if (key === "title") song.title = val;
  else if (key === "artist") song.artist = val;
  else if (key === "tempo" || key === "start") {
    var n = parseInt(val, 10);
    if (!(n >= 30 && n <= 260)) { err(ln, "Темп должен быть числом от 30 до 260."); return; }
    song[key] = n;
  }
  else if (key === "tempo-note") song.tempoNote = val;
  else if (key === "strum-text") song.patternText = val;
  else if (key === "easy-text") song.easyText = val;
  else if (key === "tip") song.tips.push(val);
  else if (key === "strum" || key === "easy-strum") {
    var pat = parseStrum(val, ln, err);
    if (pat) song.patterns[key === "strum" ? "main" : "easy"] = pat;
  }
  else if (key === "easy-chords") {
    val.split(",").forEach(function (pair) {
      var m = pair.trim().match(/^(\S+)\s*=\s*(\S+)$/);
      if (!m) { err(ln, "easy-chords пишется так: Bm=G, F=Fmaj7"); return; }
      if (!SHAPES[m[2]]) { err(ln, "Нет аппликатуры для аккорда " + m[2] + "."); return; }
      song.easyMap[m[1]] = m[2];
    });
  }
  else if (key === "pairs") {
    val.split(",").forEach(function (pair) {
      var m = pair.trim().match(/^(\S+?)-(\S+)$/);
      if (!m) { err(ln, "pairs пишется так: Em-Bm, C-D"); return; }
      if (!SHAPES[m[1]] || !SHAPES[m[2]]) { err(ln, "В паре " + pair.trim() + " неизвестный аккорд."); return; }
      song.pairs.push([m[1], m[2]]);
    });
  }
}

function parseStrum(val, ln, err) {
  var toks = val.split(/\s+/).filter(Boolean);
  var out = [];
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i].toUpperCase();
    if (!(t in STRUM_TOKENS)) { err(ln, "В бое допустимы только D (вниз), U (вверх), M (глушение) и - (пауза)."); return null; }
    out.push(STRUM_TOKENS[t]);
  }
  if (out.length === 4) out = out.concat(out);
  if (out.length !== 8) { err(ln, "Бой задаётся на 4 или 8 восьмых, сейчас " + out.length + "."); return null; }
  return out;
}

function parseChordLine(line, ln, err) {
  var toks = line.split(/\s+/).filter(Boolean);
  var repeat = 1;
  var last = toks[toks.length - 1].match(/^[xх](\d+)$/i);
  if (last) { repeat = parseInt(last[1], 10); toks.pop(); }
  var chords = [];
  toks.forEach(function (tok) {
    var m = tok.match(/^([A-H][#b]?[A-Za-z0-9]*)(?::(\d+))?$/);
    if (!m) { err(ln, "Не понял «" + tok + "». Аккорд пишется так: Em или Em:2 (число это доли)."); return; }
    var name = m[1].replace(/^H/, "B");
    var beats = m[2] ? parseInt(m[2], 10) : 4;
    if (!SHAPES[name]) { err(ln, "Нет аппликатуры для аккорда " + name + ". Добавь его в src/chords.js или замени."); return; }
    if (!(beats >= 1 && beats <= 32)) { err(ln, "Длительность " + tok + " должна быть от 1 до 32 долей."); return; }
    chords.push([name, beats]);
  });
  return { chords: chords, repeat: repeat };
}

function autoPairs(song) {
  var out = [], seen = {}, prev = null;
  song.parts.forEach(function (p) {
    p.lines.forEach(function (l) {
      l.forEach(function (c) {
        if (prev && prev !== c[0] && !seen[prev + c[0]]) { seen[prev + c[0]] = true; out.push([prev, c[0]]); }
        prev = c[0];
      });
    });
  });
  return out.slice(0, 6);
}

/* Транслитерация названия в имя файла: «Пачка сигарет» превращается в pachka-sigaret */
var TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export function slugify(s) {
  return String(s || "").toLowerCase().split("").map(function (ch) { return ch in TR ? TR[ch] : ch; }).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "song";
}
