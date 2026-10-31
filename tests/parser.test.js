import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSong, slugify } from "../src/parser.js";

var songsDir = fileURLToPath(new URL("../songs/", import.meta.url));

describe("файлы песен", function () {
  readdirSync(songsDir).filter(function (f) { return f.endsWith(".song"); }).forEach(function (file) {
    it(file + " разбирается без ошибок", function () {
      var res = parseSong(readFileSync(join(songsDir, file), "utf8"), file);
      expect(res.errors).toEqual([]);
      expect(res.song.parts.length).toBeGreaterThan(0);
      res.song.parts.forEach(function (p) { expect(p.lines.length).toBeGreaterThan(0); });
    });
  });
});

describe("парсер", function () {
  var base = "title: Тест\ntempo: 100\n";

  it("понимает длительность и повтор строки", function () {
    var res = parseSong(base + "[Куплет]\nEm:2 Am x3\n");
    expect(res.errors).toEqual([]);
    expect(res.song.parts[0].lines.length).toBe(3);
    expect(res.song.parts[0].lines[0]).toEqual([["Em", 2], ["Am", 4]]);
  });

  it("копирует раздел явно и по совпадающему имени", function () {
    var res = parseSong(base + "[Куплет 1]\nEm C\n[Припев]\nG D\n[Куплет 2] = Куплет 1\n[Припев]\n");
    expect(res.errors).toEqual([]);
    expect(res.song.parts[2].lines).toEqual([[["Em", 4], ["C", 4]]]);
    expect(res.song.parts[3].lines).toEqual([[["G", 4], ["D", 4]]]);
  });

  it("H читается как B", function () {
    var res = parseSong(base + "[Куплет]\nHm\n");
    expect(res.song.parts[0].lines[0][0][0]).toBe("Bm");
  });

  it("сообщает о неизвестном аккорде с номером строки", function () {
    var res = parseSong(base + "[Куплет]\nEm F#dim\n");
    expect(res.errors.length).toBe(1);
    expect(res.errors[0].line).toBe(4);
  });

  it("проверяет бой", function () {
    expect(parseSong(base + "strum: D U M -\n[К]\nEm\n").song.patterns.main).toEqual(["D", "U", "M", "", "D", "U", "M", ""]);
    expect(parseSong(base + "strum: D U D\n[К]\nEm\n").errors.length).toBe(1);
  });

  it("требует title и tempo", function () {
    expect(parseSong("[К]\nEm\n").errors.length).toBe(2);
  });

  it("делает имя файла из русского названия", function () {
    expect(slugify("Пачка сигарет")).toBe("pachka-sigaret");
  });
});
