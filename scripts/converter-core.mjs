import crypto from "node:crypto";

export const TARGET_SHEETS = ["空欄", "同じ使い方", "関係", "熟語選択_類似順"];

export function textFromCell(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  if (typeof value === "object" && value.text) return String(value.text);
  return String(value);
}

function colorIsRed(color) {
  const argb = color?.argb?.toUpperCase();
  if (argb) {
    const rgb = argb.length === 8 ? argb.slice(2) : argb;
    const red = Number.parseInt(rgb.slice(0, 2), 16);
    const green = Number.parseInt(rgb.slice(2, 4), 16);
    const blue = Number.parseInt(rgb.slice(4, 6), 16);
    return red >= 180 && green <= 110 && blue <= 110;
  }
  return color?.indexed === 10;
}

function optionSegments(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && Array.isArray(value.richText)) {
    const chars = value.richText.flatMap((part) =>
      [...(part.text ?? "")].map((character) => ({
        character,
        red: colorIsRed(part.font?.color),
      })),
    );
    const options = [];
    let current = [];
    for (const char of chars) {
      if (char.character === "/") {
        options.push(current);
        current = [];
      } else {
        current.push(char);
      }
    }
    options.push(current);
    return options.map((items) => ({
      text: items.map((item) => item.character).join("").trim(),
      supplemented: items.some((item) => item.red && item.character.trim()),
    }));
  }

  return textFromCell(cell)
    .split("/")
    .map((text) => ({
      text: text.trim(),
      supplemented: colorIsRed(cell?.font?.color),
    }));
}

function colorIsYellow(color) {
  const argb = color?.argb?.toUpperCase();
  if (argb) {
    const rgb = argb.length === 8 ? argb.slice(2) : argb;
    const red = Number.parseInt(rgb.slice(0, 2), 16);
    const green = Number.parseInt(rgb.slice(2, 4), 16);
    const blue = Number.parseInt(rgb.slice(4, 6), 16);
    return red >= 200 && green >= 180 && blue <= green - 20;
  }
  return color?.indexed === 6 || color?.indexed === 13;
}

export function rowIsYellow(cells) {
  return cells.some((cell) => {
    const fill = cell?.fill;
    return fill?.type === "pattern" && colorIsYellow(fill.fgColor);
  });
}

export function isHeaderRow(prompt, answer, options) {
  const joined = `${prompt}|${answer}|${options}`.replace(/\s/g, "");
  return (
    /問題文|設問/.test(prompt) &&
    /正解|解答/.test(answer) &&
    /選択肢|候補/.test(options)
  ) || joined === "問題|答え|選択肢" || joined === "問題|解答|選択肢";
}

function normalized(value) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function stableQuestionId(genre, prompt, answer, options) {
  const payload = [genre, prompt, answer, ...options.map((option) => option.text).sort()]
    .map(normalized)
    .join("\u241f");
  return `${genre}-${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

export function parseQuestionRow({ genre, rowNumber, promptCell, answerCell, optionsCell }) {
  const prompt = textFromCell(promptCell).trim();
  const answer = textFromCell(answerCell).trim();
  const optionsText = textFromCell(optionsCell).trim();

  if (!prompt && !answer && !optionsText) return { kind: "empty" };
  if (isHeaderRow(prompt, answer, optionsText)) return { kind: "header" };

  const reasons = [];
  if (!prompt) reasons.push("問題文が空欄");
  if (!answer) reasons.push("正解が空欄");
  if (!optionsText) reasons.push("選択肢が空欄");
  const options = optionsText ? optionSegments(optionsCell).filter((option) => option.text) : [];
  if (options.length < 2) reasons.push("選択肢が2件未満");
  const answerMatches = options.filter((option) => normalized(option.text) === normalized(answer));
  if (answer && answerMatches.length === 0) reasons.push("正解が選択肢に存在しない");
  if (answerMatches.length > 1) reasons.push("正解と一致する選択肢が複数ある");

  const yellow = rowIsYellow([promptCell, answerCell, optionsCell]);
  if (yellow) reasons.push("黄色の要確認問題");

  if (reasons.length) {
    return {
      kind: "excluded",
      row: rowNumber,
      prompt,
      answer,
      options: options.map((option) => option.text),
      reasons,
    };
  }

  return {
    kind: "question",
    question: {
      id: stableQuestionId(genre, prompt, answer, options),
      genre,
      prompt,
      answer,
      options,
      sourceRow: rowNumber,
    },
  };
}
