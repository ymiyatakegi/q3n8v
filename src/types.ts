export const GENRES = ["空欄", "同じ使い方", "関係", "熟語選択_類似順"] as const;

export type Genre = (typeof GENRES)[number];
export type LearningStatus = "zero" | "star" | "mastered" | "difficult";
export type SessionMode = "normal" | "difficult";

export interface QuestionOption {
  text: string;
  supplemented: boolean;
}

export interface Question {
  id: string;
  genre: Genre;
  prompt: string;
  answer: string;
  options: QuestionOption[];
  sourceRow: number;
}

export interface QuestionDataset {
  version: number;
  generatedAt: string;
  questions: Question[];
}

export interface QuestionProgress {
  status: LearningStatus;
  normalCorrect: number;
  normalIncorrect: number;
  zeroMissStreak: number;
  lastNormalSequence: number | null;
  lastStudiedAt: string | null;
}

export interface SessionAnswer {
  questionId: string;
  selected: string | null;
  correct: boolean;
  unknown: boolean;
  statusBefore: LearningStatus;
  statusAfter: LearningStatus;
  becameStar: boolean;
  becameMastered: boolean;
  becameDifficult: boolean;
}

export interface ActiveSession {
  id: string;
  mode: SessionMode;
  genres: Genre[];
  questionIds: string[];
  optionOrders: Record<string, string[]>;
  currentIndex: number;
  answers: SessionAnswer[];
  startedAt: string;
}

export interface AppSettings {
  showSupplementedOptions: boolean;
}

export interface StudyState {
  schemaVersion: 1;
  datasetVersion: number;
  totalNormalSequence: number;
  progress: Record<string, QuestionProgress>;
  activeSession: ActiveSession | null;
  selectedGenres: Genre[];
  settings: AppSettings;
}

export interface SessionSummary {
  total: number;
  correct: number;
  incorrect: number;
  unknown: number;
  accuracy: number;
  becameStar: number;
  becameMastered: number;
  becameDifficult: number;
}
