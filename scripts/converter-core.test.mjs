import { describe, expect, it } from "vitest";

import { isHeaderRow, parseQuestionRow } from "./converter-core.mjs";

const cell = (value) => ({ value, fill: { type: "pattern", pattern: "none" }, font: {} });

describe("Excel変換", () => {
  it("同じ使い方の1行目を見出し扱いしない", () => {
    expect(isHeaderRow("目が利く", "鼻が利く", "耳が利く / 鼻が利く")).toBe(false);
  });

  it("問題・解答・選択肢は見出しとして除外する", () => {
    expect(isHeaderRow("問題", "解答", "選択肢")).toBe(true);
  });

  it("正解が選択肢にない問題を出題対象にしない", () => {
    const parsed = parseQuestionRow({
      genre: "空欄",
      rowNumber: 3,
      promptCell: cell("問題"),
      answerCell: cell("正解"),
      optionsCell: cell("誤答1 / 誤答2"),
    });
    expect(parsed.kind).toBe("excluded");
    expect(parsed.reasons).toContain("正解が選択肢に存在しない");
  });
});
