import { parseSong, slugify } from "./parser.js";
import { mountPlayer } from "./player.js";

/*
  Все файлы из папки songs подхватываются при сборке автоматически.
  Положил новый .song, значит после сборки у песни появилась своя страница.
*/
var files = import.meta.glob("../songs/*.song", { query: "?raw", import: "default", eager: true });

var SONGS = {};
var BROKEN = [];
Object.keys(files).forEach(function (path) {
  var slug = path.split("/").pop().replace(/\.song$/, "");
  var res = parseSong(files[path], slug);
  if (res.errors.length) BROKEN.push({ slug: slug, errors: res.errors });
  else SONGS[slug] = res.song;
});

var app = document.getElementById("app");
var mounted = null;

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}

function unmount() {
  if (mounted) { mounted.destroy(); mounted = null; }
}

function uniqueChords(song) {
  var out = [];
  song.parts.forEach(function (p) { p.lines.forEach(function (l) { l.forEach(function (c) { if (out.indexOf(c[0]) < 0) out.push(c[0]); }); }); });
  return out;
}

function renderList() {
  var list = Object.keys(SONGS).map(function (k) { return SONGS[k]; });
  list.sort(function (a, b) { return (a.artist + a.title).localeCompare(b.artist + b.title, "ru"); });
  var html = '<header class="home-head"><div class="kicker">Тренажёр для начинающих гитаристов</div>' +
    '<h1>Аккордник</h1><p class="sub">Выбери песню: покажу аккорды, бой и смены в нужном темпе, со звуком.</p></header>' +
    '<div class="song-list">';
  list.forEach(function (s) {
    var chords = uniqueChords(s);
    html += '<a class="song-card" href="#' + s.slug + '">' +
      '<span class="song-artist">' + esc(s.artist) + "</span>" +
      '<span class="song-title">' + esc(s.title) + "</span>" +
      '<span class="song-meta">' + chords.length + " " + plural(chords.length, "аккорд", "аккорда", "аккордов") + ", " + s.tempo + " ударов в минуту</span>" +
      '<span class="song-chords">' + chords.map(function (c) { return "<i>" + c + "</i>"; }).join("") + "</span>" +
      "</a>";
  });
  html += '<a class="song-card add" href="#new"><span class="song-title">Добавить песню</span><span class="song-meta">Редактор с живым предпросмотром</span></a></div>';
  if (BROKEN.length) {
    html += '<section class="broken"><h2>Не собрались</h2>' + BROKEN.map(function (b) {
      return "<p><b>" + esc(b.slug) + ".song</b>: " + b.errors.map(function (e) { return "строка " + e.line + ", " + esc(e.message); }).join("; ") + "</p>";
    }).join("") + "</section>";
  }
  app.innerHTML = html;
  document.title = "Аккордник";
}

function plural(n, one, few, many) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function renderSong(slug) {
  var song = SONGS[slug];
  if (!song) { renderNotFound(); return; }
  var holder = document.createElement("div");
  holder.className = "song-page";
  app.innerHTML = "";
  app.appendChild(holder);
  mounted = mountPlayer(holder, song, { showHeader: true });
  document.title = song.title + ". Аккордник";
}

function renderNotFound() {
  app.innerHTML = '<header class="song-head"><a class="back" href="#">Все песни</a><h1>Такой песни нет</h1></header>';
}

var TEMPLATE = [
  "title: Название",
  "artist: Исполнитель",
  "tempo: 100",
  "strum: D - D U D - D U",
  "strum-text: Вниз, затем вниз-вверх.",
  "tip: Первый совет.",
  "",
  "[Вступление]",
  "Am:2 C:2 G:2 Em:2",
  "",
  "[Куплет 1]",
  "Am:4 C:4 G:4 Em:4 x2",
  "",
  "[Припев]",
  "C:4 G:4 Am:4 Em:4",
  "",
  "[Куплет 2] = Куплет 1",
  "[Припев]",
  ""
].join("\n");

function renderEditor() {
  var draft = TEMPLATE;
  try { draft = localStorage.getItem("akkordnik-draft") || TEMPLATE; } catch (e) { /* хранилище недоступно */ }
  app.innerHTML = '<header class="song-head"><a class="back" href="#">Все песни</a><h1>Новая песня</h1>' +
    '<p class="sub">Пиши слева, справа сразу появится плеер. Когда всё звучит как надо, скопируй текст и сохрани его в папку songs под именем из подсказки, затем сделай коммит.</p></header>' +
    '<div class="editor">' +
      '<div class="editor-left"><textarea id="src" spellcheck="false" aria-label="Текст песни в формате song"></textarea>' +
        '<div class="row"><button class="btn" id="copy" type="button">Скопировать текст</button><span class="small" id="fileHint"></span></div>' +
        '<div class="errors" id="errors"></div></div>' +
      '<div class="editor-right" id="preview"></div>' +
    "</div>";
  var src = document.getElementById("src"), errBox = document.getElementById("errors");
  var preview = document.getElementById("preview"), hint = document.getElementById("fileHint");
  src.value = draft;
  var timer = null;

  function update() {
    try { localStorage.setItem("akkordnik-draft", src.value); } catch (e) { /* хранилище недоступно */ }
    var res = parseSong(src.value, "draft");
    hint.textContent = "Имя файла: songs/" + slugify(res.song.title) + ".song";
    if (res.errors.length) {
      errBox.innerHTML = res.errors.map(function (e) { return "<p>Строка " + e.line + ": " + esc(e.message) + "</p>"; }).join("");
      return;
    }
    errBox.innerHTML = "";
    unmount();
    var holder = document.createElement("div");
    preview.innerHTML = "";
    preview.appendChild(holder);
    mounted = mountPlayer(holder, res.song, { showHeader: false });
  }
  src.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(update, 500); });
  document.getElementById("copy").addEventListener("click", function () {
    var btn = this;
    function done() { btn.textContent = "Скопировано"; setTimeout(function () { btn.textContent = "Скопировать текст"; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(src.value).then(done, function () { src.select(); });
    } else { src.select(); }
  });
  update();
  document.title = "Новая песня. Аккордник";
}

function route() {
  unmount();
  var h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (!h) renderList();
  else if (h === "new") renderEditor();
  else renderSong(h);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
