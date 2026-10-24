import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import ExcelJS from "exceljs";

import { TARGET_SHEETS, parseQuestionRow } from "./converter-core.mjs";

export async function convertWorkbook(inputPath, outputDirectory) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  const questions = [];
  const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(inputPath),
    sheets: {},
    total: { scanned: 0, included: 0, excluded: 0, headers: 0, empty: 0 },
    exclusions: [],
  };

  for (const genre of TARGET_SHEETS) {
    const sheet = workbook.getWorksheet(genre);
    if (!sheet) throw new Error(`対象シート「${genre}」が見つかりません。`);

    const summary = { scanned: 0, included: 0, excluded: 0, headers: 0, empty: 0 };
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const parsed = parseQuestionRow({
        genre,
        rowNumber,
        promptCell: row.getCell(1),
        answerCell: row.getCell(2),
        optionsCell: row.getCell(3),
      });
      summary.scanned += 1;
      if (parsed.kind === "question") {
        questions.push(parsed.question);
        summary.included += 1;
      } else if (parsed.kind === "excluded") {
        report.exclusions.push({ genre, ...parsed });
        summary.excluded += 1;
      } else {
        summary[parsed.kind === "header" ? "headers" : "empty"] += 1;
      }
    }
    report.sheets[genre] = summary;
    for (const key of Object.keys(summary)) report.total[key] += summary[key];
  }

  const uniqueQuestions = [];
  const ids = new Set();
  for (const question of questions) {
    if (ids.has(question.id)) {
      report.exclusions.push({
        genre: question.genre,
        kind: "excluded",
        row: question.sourceRow,
        prompt: question.prompt,
        answer: question.answer,
        options: question.options.map((option) => option.text),
        reasons: ["同一内容の重複問題"],
      });
      report.sheets[question.genre].included -= 1;
      report.sheets[question.genre].excluded += 1;
      report.total.included -= 1;
      report.total.excluded += 1;
      continue;
    }
    ids.add(question.id);
    uniqueQuestions.push(question);
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "questions.json"),
    `${JSON.stringify({ version: 1, generatedAt: report.generatedAt, questions: uniqueQuestions }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputDirectory, "validation-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

async function main() {
  const inputPath = process.argv[2];
  const outputDirectory = process.argv[3] ?? path.resolve("public");
  if (!inputPath) {
    console.error("使い方: npm run convert -- <Excelファイル> [出力先]");
    process.exitCode = 1;
    return;
  }
  const report = await convertWorkbook(path.resolve(inputPath), path.resolve(outputDirectory));
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) await main();
