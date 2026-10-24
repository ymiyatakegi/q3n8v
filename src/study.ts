import {
  GENRES,
  type ActiveSession,
  type Genre,
  type LearningStatus,
  type Question,
  type QuestionProgress,
  type SessionAnswer,
  type SessionMode,
  type SessionSummary,
  type StudyState,
} from "./types";

export const SESSION_SIZE = 50;
export const ZERO_REVIEW_INTERVAL = 50;
export const STAR_REVIEW_INTERVAL = 200;

export function initialQuestionProgress(): QuestionProgress {
  return {
    status: "zero",
    normalCorrect: 0,
    normalIncorrect: 0,
    zeroMissStreak: 0,
    lastNormalSequence: null,
    lastStudiedAt: null,
  };
}

export function createInitialState(questions: Question[], datasetVersion: number): StudyState {
  return {
    schemaVersion: 1,
    datasetVersion,
    totalNormalSequence: 0,
    progress: Object.fromEntries(questions.map((question) => [question.id, initialQuestionProgress()])),
    activeSession: null,
    selectedGenres: [...GENRES],
    settings: { showSupplementedOptions: false },
  };
}

export function reconcileState(
  saved: StudyState | null,
  questions: Question[],
  datasetVersion: number,
): StudyState {
  const clean = createInitialState(questions, datasetVersion);
  if (!saved || saved.schemaVersion !== 1) return clean;
  clean.totalNormalSequence = Math.max(0, Number(saved.totalNormalSequence) || 0);
  clean.settings = {
    showSupplementedOptions: Boolean(saved.settings?.showSupplementedOptions),
  };
  clean.selectedGenres = GENRES.filter((genre) => saved.selectedGenres?.includes(genre));
  if (!clean.selectedGenres.length) clean.selectedGenres = [...GENRES];

  for (const question of questions) {
    const previous = saved.progress?.[question.id];
    if (!previous) continue;
    clean.progress[question.id] = {
      status: (["zero", "star", "mastered", "difficult"] as LearningStatus[]).includes(previous.status)
        ? previous.status
        : "zero",
      normalCorrect: Math.max(0, Number(previous.normalCorrect) || 0),
      normalIncorrect: Math.max(0, Number(previous.normalIncorrect) || 0),
      zeroMissStreak: Math.max(0, Math.min(2, Number(previous.zeroMissStreak) || 0)),
      lastNormalSequence:
        previous.lastNormalSequence == null ? null : Math.max(0, Number(previous.lastNormalSequence) || 0),
      lastStudiedAt: typeof previous.lastStudiedAt === "string" ? previous.lastStudiedAt : null,
    };
  }

  if (saved.activeSession) {
    const validIds = new Set(questions.map((question) => question.id));
    const session = saved.activeSession;
    const idsValid = session.questionIds?.length && session.questionIds.every((id) => validIds.has(id));
    const indexValid = Number.isInteger(session.currentIndex) && session.currentIndex >= 0;
    if (idsValid && indexValid && session.currentIndex < session.questionIds.length) {
      clean.activeSession = session;
    }
  }
  return clean;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function isEligibleForNormal(progress: QuestionProgress, totalSequence: number): boolean {
  if (progress.status === "mastered") return false;
  if (progress.lastNormalSequence == null) return true;
  const gap = totalSequence - progress.lastNormalSequence;
  return gap >= (progress.status === "star" ? STAR_REVIEW_INTERVAL : ZERO_REVIEW_INTERVAL);
}

export function sessionCandidates(
  questions: Question[],
  state: StudyState,
  mode: SessionMode,
  genres: Genre[],
  random: () => number = Math.random,
): Question[] {
  const selected = new Set(genres);
  const available = questions.filter((question) => selected.has(question.genre));
  if (mode === "difficult") {
    return shuffled(
      available.filter((question) => state.progress[question.id]?.status === "difficult"),
      random,
    );
  }

  const eligible = available.filter((question) =>
    isEligibleForNormal(state.progress[question.id] ?? initialQuestionProgress(), state.totalNormalSequence),
  );
  const primary = shuffled(
    eligible.filter((question) => {
      const status = state.progress[question.id]?.status ?? "zero";
      return status === "zero" || status === "difficult";
    }),
    random,
  );
  const review = shuffled(
    eligible.filter((question) => state.progress[question.id]?.status === "star"),
    random,
  );
  return [...primary, ...review];
}

export function createSession(
  questions: Question[],
  state: StudyState,
  mode: SessionMode,
  genres: Genre[],
  random: () => number = Math.random,
): ActiveSession | null {
  const candidates = sessionCandidates(questions, state, mode, genres, random).slice(0, SESSION_SIZE);
  if (!candidates.length) return null;
  const optionOrders = Object.fromEntries(
    candidates.map((question) => [
      question.id,
      shuffled(question.options.map((option) => option.text), random),
    ]),
  );
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    mode,
    genres,
    questionIds: candidates.map((question) => question.id),
    optionOrders,
    currentIndex: 0,
    answers: [],
    startedAt: new Date().toISOString(),
  };
}

export function applyAnswer(
  progress: QuestionProgress,
  mode: SessionMode,
  correct: boolean,
  normalSequence: number,
  now = new Date().toISOString(),
): { progress: QuestionProgress; statusBefore: LearningStatus } {
  const statusBefore = progress.status;
  const next = { ...progress, lastStudiedAt: now };
  if (mode === "difficult") return { progress: next, statusBefore };

  next.lastNormalSequence = normalSequence;
  if (correct) {
    next.normalCorrect += 1;
    next.zeroMissStreak = 0;
    if (statusBefore === "zero") next.status = "star";
    else if (statusBefore === "star") next.status = "mastered";
    else if (statusBefore === "difficult") next.status = "zero";
  } else {
    next.normalIncorrect += 1;
    if (statusBefore === "star") {
      next.status = "zero";
      next.zeroMissStreak = 0;
    } else if (statusBefore === "zero") {
      next.zeroMissStreak += 1;
      if (next.zeroMissStreak >= 2) next.status = "difficult";
    }
  }
  return { progress: next, statusBefore };
}

export function recordSessionAnswer(
  state: StudyState,
  question: Question,
  selected: string | null,
  unknown: boolean,
): StudyState {
  const session = state.activeSession;
  if (!session) return state;
  if (session.answers.some((answer) => answer.questionId === question.id)) return state;

  const correct = !unknown && selected === question.answer;
  const nextState: StudyState = {
    ...state,
    progress: { ...state.progress },
    activeSession: { ...session, answers: [...session.answers] },
  };
  const sequence = session.mode === "normal" ? state.totalNormalSequence + 1 : state.totalNormalSequence;
  const currentProgress = state.progress[question.id] ?? initialQuestionProgress();
  const transition = applyAnswer(currentProgress, session.mode, correct, sequence);
  nextState.progress[question.id] = transition.progress;
  nextState.totalNormalSequence = sequence;
  const answer: SessionAnswer = {
    questionId: question.id,
    selected,
    correct,
    unknown,
    statusBefore: transition.statusBefore,
    statusAfter: transition.progress.status,
    becameStar: transition.statusBefore !== "star" && transition.progress.status === "star",
    becameMastered: transition.statusBefore !== "mastered" && transition.progress.status === "mastered",
    becameDifficult: transition.statusBefore !== "difficult" && transition.progress.status === "difficult",
  };
  nextState.activeSession!.answers.push(answer);
  return nextState;
}

export function summarizeSession(answers: SessionAnswer[]): SessionSummary {
  const correct = answers.filter((answer) => answer.correct).length;
  const unknown = answers.filter((answer) => answer.unknown).length;
  const incorrect = answers.length - correct;
  return {
    total: answers.length,
    correct,
    incorrect,
    unknown,
    accuracy: answers.length ? Math.round((correct / answers.length) * 100) : 0,
    becameStar: answers.filter((answer) => answer.becameStar).length,
    becameMastered: answers.filter((answer) => answer.becameMastered).length,
    becameDifficult: answers.filter((answer) => answer.becameDifficult).length,
  };
}

export function statusCounts(state: StudyState) {
  const counts = { zero: 0, star: 0, mastered: 0, difficult: 0 };
  for (const progress of Object.values(state.progress)) counts[progress.status] += 1;
  return { ...counts, remaining: counts.zero + counts.star + counts.difficult };
}
