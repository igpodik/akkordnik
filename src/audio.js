import { SHAPES } from "./chords.js";

/*
  Звук гитары синтезируется прямо в браузере (метод Карплуса-Стронга),
  поэтому никакие записи не нужны и проект можно спокойно выкладывать.
*/

var OPEN_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
var ctx = null, master = null;
var voices = [null, null, null, null, null, null];
var bufCache = {};
var keepAlive = null;

export function getCtx() {
  if (ctx) return ctx;
  var AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: "interactive" });
  master = ctx.createGain();
  master.gain.value = 0.7;
  var comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);
  return ctx;
}

/* Задержка вывода: нужна, чтобы картинка совпадала со звуком (особенно в Bluetooth-наушниках) */
export function outputLatency() {
  if (!ctx) return 0;
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}

/*
  Вызывать только из обработчика нажатия.
  На iPhone при выключенном звонке Web Audio молчит, пока аудиосессия в режиме «ambient».
  Новые Safari понимают navigator.audioSession, для старых играем беззвучный аудиоэлемент:
  он переводит страницу в режим воспроизведения, и звук идёт даже в беззвучном режиме.
*/
export function unlockAudio() {
  var c = getCtx();
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* не поддерживается */ }
  if (!navigator.audioSession) {
    if (!keepAlive) {
      keepAlive = document.createElement("audio");
      keepAlive.src = silentWavUrl();
      keepAlive.loop = true;
      keepAlive.setAttribute("playsinline", "");
    }
    var p = keepAlive.play();
    if (p && p.catch) p.catch(function () { /* браузер может запретить, тогда просто без этого */ });
  }
  if (c.state === "suspended") c.resume();
  return c;
}

export function releaseAudio() {
  if (keepAlive) keepAlive.pause();
  if (!ctx) return;
  var now = ctx.currentTime;
  voices.forEach(function (v) {
    if (v) { try { v.g.gain.setTargetAtTime(0, now, 0.05); } catch (e) { /* голос уже закончился */ } }
  });
}

function silentWavUrl() {
  var sr = 8000, n = sr / 2;
  var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

function pluckBuffer(freq) {
  var key = Math.round(freq * 10);
  if (bufCache[key]) return bufCache[key];
  var sr = ctx.sampleRate, len = Math.floor(sr * 2.4), N = Math.max(2, Math.round(sr / freq));
  var buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  var ring = new Float32Array(N), prev = 0;
  for (var i = 0; i < N; i++) { var r = Math.random() * 2 - 1; prev = prev * 0.5 + r * 0.5; ring[i] = prev; }
  var p = 0, decay = freq < 120 ? 0.997 : 0.995;
  for (var n = 0; n < len; n++) {
    var a = ring[p], b = ring[(p + 1) % N];
    d[n] = a;
    ring[p] = decay * 0.5 * (a + b);
    p = (p + 1) % N;
  }
  bufCache[key] = buf;
  return buf;
}

function playString(str, fret, t, vel) {
  var freq = OPEN_HZ[str] * Math.pow(2, fret / 12);
  var src = ctx.createBufferSource();
  src.buffer = pluckBuffer(freq);
  var g = ctx.createGain();
  g.gain.value = vel;
  src.connect(g);
  g.connect(master);
  var old = voices[str];
  if (old) { try { old.g.gain.setTargetAtTime(0, t, 0.02); old.src.stop(t + 0.25); } catch (e) { /* уже остановлен */ } }
  src.start(t);
  voices[str] = { src: src, g: g };
  return g;
}

/* dir: D вниз, U вверх, M глушение */
export function strum(name, dir, t) {
  var sh = SHAPES[name];
  if (!sh || !ctx) return;
  if (dir === "M") {
    for (var m = 0; m < 6; m++) {
      if (sh.frets[m] < 0) continue;
      var gm = playString(m, sh.frets[m], t + m * 0.006, 0.34);
      gm.gain.setValueAtTime(0.34, t + 0.02);
      gm.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    }
    return;
  }
  var order = [];
  if (dir === "D") { for (var i = 0; i < 6; i++) if (sh.frets[i] >= 0) order.push(i); }
  else { for (var j = 5; j >= 2; j--) if (sh.frets[j] >= 0) order.push(j); }
  var vel = dir === "D" ? 0.42 : 0.26;
  order.forEach(function (s, n) { playString(s, sh.frets[s], t + n * 0.012, vel); });
}

export function click(t, strong) {
  if (!ctx) return;
  var o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = strong ? 1500 : 1000;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(strong ? 0.35 : 0.2, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.06);
}
