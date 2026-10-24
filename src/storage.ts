import type { StudyState } from "./types";

export const STORAGE_KEY = "spi-study-state-v1";

export function loadState(): StudyState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StudyState) : null;
  } catch {
    return null;
  }
}

export function saveState(state: StudyState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportState(state: StudyState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `spi-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readImportedState(file: File): Promise<StudyState> {
  const parsed = JSON.parse(await file.text()) as StudyState;
  if (parsed?.schemaVersion !== 1 || typeof parsed.progress !== "object") {
    throw new Error("対応しているSPI学習記録ではありません。");
  }
  return parsed;
}
