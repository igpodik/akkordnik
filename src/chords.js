/*
  Словарь аппликатур.
  frets: лады от 6-й струны к 1-й, -1 значит струну не играть, 0 открытая.
  fingers: номер пальца на каждой струне (1 указательный, 4 мизинец), 0 без пальца.
  Чтобы песня могла использовать новый аккорд, добавь его сюда.
*/
export var SHAPES = {
  "Em":    { frets: [0, 2, 2, 0, 0, 0],    fingers: [0, 2, 3, 0, 0, 0], note: "самый простой" },
  "E":     { frets: [0, 2, 2, 1, 0, 0],    fingers: [0, 2, 3, 1, 0, 0], note: "" },
  "Am":    { frets: [-1, 0, 2, 2, 1, 0],   fingers: [0, 0, 2, 3, 1, 0], note: "" },
  "A":     { frets: [-1, 0, 2, 2, 2, 0],   fingers: [0, 0, 1, 2, 3, 0], note: "" },
  "Asus4": { frets: [-1, 0, 2, 2, 3, 0],   fingers: [0, 0, 1, 2, 4, 0], note: "A плюс мизинец" },
  "A7":    { frets: [-1, 0, 2, 0, 2, 0],   fingers: [0, 0, 2, 0, 3, 0], note: "" },
  "Bm":    { frets: [-1, -1, 4, 4, 3, 2],  fingers: [0, 0, 3, 4, 2, 1], note: "он же Hm, малый вариант" },
  "B7":    { frets: [-1, 2, 1, 2, 0, 2],   fingers: [0, 2, 1, 3, 0, 4], note: "он же H7" },
  "C":     { frets: [-1, 3, 2, 0, 1, 0],   fingers: [0, 3, 2, 0, 1, 0], note: "" },
  "Cmaj7": { frets: [-1, 3, 2, 0, 0, 0],   fingers: [0, 3, 2, 0, 0, 0], note: "" },
  "D":     { frets: [-1, -1, 0, 2, 3, 2],  fingers: [0, 0, 0, 1, 3, 2], note: "играть с 4-й струны" },
  "Dm":    { frets: [-1, -1, 0, 2, 3, 1],  fingers: [0, 0, 0, 2, 3, 1], note: "играть с 4-й струны" },
  "D7":    { frets: [-1, -1, 0, 2, 1, 2],  fingers: [0, 0, 0, 2, 1, 3], note: "" },
  "E7":    { frets: [0, 2, 0, 1, 0, 0],    fingers: [0, 2, 0, 1, 0, 0], note: "" },
  "Fmaj7": { frets: [-1, -1, 3, 2, 1, 0],  fingers: [0, 0, 3, 2, 1, 0], note: "вместо F, без баррэ" },
  "G":     { frets: [3, 2, 0, 0, 0, 3],    fingers: [2, 1, 0, 0, 0, 3], note: "" },
  "G6":    { frets: [3, 2, 0, 0, 0, 0],    fingers: [2, 1, 0, 0, 0, 0], note: "G с открытой 1-й" },
  "G7":    { frets: [3, 2, 0, 0, 0, 1],    fingers: [3, 2, 0, 0, 0, 1], note: "" }
};

/* Диаграмма аккорда в SVG. Цвета задаются классами в style.css, поэтому работает в обеих темах */
export function chordSVG(name) {
  var sh = SHAPES[name];
  if (!sh) return "";
  var W = 100, H = 118, left = 17, gap = 13.2, top = 26, fh = 20, nf = 4;
  var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Аппликатура ' + name + '">';
  for (var f = 1; f <= nf; f++) {
    s += '<line class="fret" x1="' + left + '" x2="' + (left + gap * 5) + '" y1="' + (top + f * fh) + '" y2="' + (top + f * fh) + '"/>';
  }
  for (var i = 0; i < 6; i++) {
    var x = left + i * gap;
    s += '<line class="str" x1="' + x + '" x2="' + x + '" y1="' + top + '" y2="' + (top + nf * fh) + '"/>';
  }
  s += '<line class="nut" x1="' + (left - 1) + '" x2="' + (left + gap * 5 + 1) + '" y1="' + top + '" y2="' + top + '"/>';
  for (var j = 0; j < 6; j++) {
    var xx = left + j * gap, fr = sh.frets[j];
    if (fr < 0) {
      s += '<line class="mute" x1="' + (xx - 3.5) + '" x2="' + (xx + 3.5) + '" y1="' + (top - 14) + '" y2="' + (top - 7) + '"/>';
      s += '<line class="mute" x1="' + (xx + 3.5) + '" x2="' + (xx - 3.5) + '" y1="' + (top - 14) + '" y2="' + (top - 7) + '"/>';
    } else if (fr === 0) {
      s += '<circle class="open" cx="' + xx + '" cy="' + (top - 10) + '" r="3.6"/>';
    } else {
      var cy = top + (fr - 0.5) * fh;
      s += '<circle class="dot" cx="' + xx + '" cy="' + cy + '" r="6"/>';
      s += '<text class="dot-num" x="' + xx + '" y="' + cy + '">' + sh.fingers[j] + "</text>";
    }
  }
  for (var k = 1; k <= nf; k++) {
    s += '<text class="lbl" x="3" y="' + (top + (k - 0.5) * fh + 3) + '">' + k + "</text>";
  }
  s += '<text class="lbl" x="' + (left - 4) + '" y="' + (H - 3) + '">6</text>';
  s += '<text class="lbl" x="' + (left + gap * 5 - 3) + '" y="' + (H - 3) + '">1</text>';
  return s + "</svg>";
}
