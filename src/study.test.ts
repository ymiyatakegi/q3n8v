import { describe, expect, it } from "vitest";

import {
  applyAnswer,
  createInitialState,
  createSession,
  initialQuestionProgress,
  recordSessionAnswer,
  reconcileState,
  sessionCandidates,
  summarizeSession,
} from "./study";
import type { ActiveSession, Question, StudyState } from "./types";

function question(id: string): Question {
  return {
    id,
    genre: "空欄",
    prompt: `問題${id}`,
    answer: "正解",
    options: [
      { text: "正解", supplemented: false },
      { text: "不正解", supplemented: false },
    ],
    sourceRow: Number(id.replace(/\D/g, "")) || 1,
  };
}

describe("学習状態", () => {
  it("0で正解すると★になる", () => {
    const result = applyAnswer(initialQuestionProgress(), "normal", true, 1);
    expect(result.progress.status).toBe("star");
  });

  it("★で正解すると★★になる", () => {
    const progress = { ...initialQuestionProgress(), status: "star" as const };
    expect(applyAnswer(progress, "normal", true, 2).progress.status).toBe("mastered");
  });

  it("★で不正解になると0に戻り、連続不正解はリセットされる", () => {
    const progress = { ...initialQuestionProgress(), status: "star" as const, zeroMissStreak: 1 };
    const result = applyAnswer(progress, "normal", false, 2);
    expect(result.progress.status).toBe("zero");
    expect(result.progress.zeroMissStreak).toBe(0);
  });

  it("0で2回連続不正解になると☠になる", () => {
    const first = applyAnswer(initialQuestionProgress(), "normal", false, 1).progress;
    const second = applyAnswer(first, "normal", false, 2).progress;
    expect(first.status).toBe("zero");
    expect(first.zeroMissStreak).toBe(1);
    expect(second.status).toBe("difficult");
  });

  it("☠で通常出題に正解すると★を付けず0に戻る", () => {
    const progress = { ...initialQuestionProgress(), status: "difficult" as const, zeroMissStreak: 2 };
    const result = applyAnswer(progress, "normal", true, 8).progress;
    expect(result.status).toBe("zero");
    expect(result.zeroMissStreak).toBe(0);
  });

  it("苦手モードの正誤では進捗状態と通常集計を変えない", () => {
    const progress = { ...initialQuestionProgress(), status: "difficult" as const, normalIncorrect: 3 };
    const correct = applyAnswer(progress, "difficult", true, 4).progress;
    const incorrect = applyAnswer(progress, "difficult", false, 4).progress;
    expect(correct.status).toBe("difficult");
    expect(correct.normalCorrect).toBe(0);
    expect(incorrect.status).toBe("difficult");
    expect(incorrect.normalIncorrect).toBe(3);
  });
});

describe("出題間隔とセッション", () => {
  it("0の問題は別の問題が50問出るまで再出題しない", () => {
    const item = question("q1");
    const state = createInitialState([item], 1);
    state.progress[item.id].lastNormalSequence = 50;
    state.totalNormalSequence = 99;
    expect(sessionCandidates([item], state, "normal", ["空欄"])).toHaveLength(0);
    state.totalNormalSequence = 100;
    expect(sessionCandidates([item], state, "normal", ["空欄"])).toHaveLength(1);
  });

  it("★の問題は別の問題が200問出るまで再出題しない", () => {
    const item = question("q1");
    const state = createInitialState([item], 1);
    state.progress[item.id] = { ...initialQuestionProgress(), status: "star", lastNormalSequence: 10 };
    state.totalNormalSequence = 209;
    expect(sessionCandidates([item], state, "normal", ["空欄"])).toHaveLength(0);
    state.totalNormalSequence = 210;
    expect(sessionCandidates([item], state, "normal", ["空欄"])).toHaveLength(1);
  });

  it("★★は通常出題されない", () => {
    const item = question("q1");
    const state = createInitialState([item], 1);
    state.progress[item.id].status = "mastered";
    expect(sessionCandidates([item], state, "normal", ["空欄"])).toHaveLength(0);
  });

  it("1セッションは最大50問", () => {
    const items = Array.from({ length: 70 }, (_, index) => question(`q${index}`));
    const state = createInitialState(items, 1);
    expect(createSession(items, state, "normal", ["空欄"], () => 0.5)?.questionIds).toHaveLength(50);
  });

  it("乱数が変われば固定の50問パターンにならない", () => {
    const items = Array.from({ length: 70 }, (_, index) => question(`q${index}`));
    const state = createInitialState(items, 1);
    const first = createSession(items, state, "normal", ["空欄"], () => 0.01)?.questionIds;
    const second = createSession(items, state, "normal", ["空欄"], () => 0.91)?.questionIds;
    expect(first).not.toEqual(second);
  });
});

describe("保存中セッション", () => {
  it("同じ問題の回答は一度だけ記録する", () => {
    const item = question("q1");
    const state = createInitialState([item], 1);
    const session: ActiveSession = {
      id: "s1",
      mode: "normal",
      genres: ["空欄"],
      questionIds: [item.id],
      optionOrders: { [item.id]: ["正解", "不正解"] },
      currentIndex: 0,
      answers: [],
      startedAt: new Date(0).toISOString(),
    };
    const withSession: StudyState = { ...state, activeSession: session };
    const once = recordSessionAnswer(withSession, item, "正解", false);
    const twice = recordSessionAnswer(once, item, "正解", false);
    expect(twice.activeSession?.answers).toHaveLength(1);
    expect(twice.progress[item.id].normalCorrect).toBe(1);
    expect(twice.totalNormalSequence).toBe(1);
  });

  it("途中セッションは再読み込み用の復元処理で維持される", () => {
    const items = [question("q1"), question("q2")];
    const state = createInitialState(items, 1);
    const session = createSession(items, state, "normal", ["空欄"], () => 0.5)!;
    const answered = recordSessionAnswer({ ...state, activeSession: session }, items[0], "正解", false);
    answered.activeSession!.currentIndex = 1;
    const restored = reconcileState(JSON.parse(JSON.stringify(answered)), items, 1);
    expect(restored.activeSession?.currentIndex).toBe(1);
    expect(restored.activeSession?.answers).toHaveLength(1);
    expect(restored.progress[items[0].id].status).toBe("star");
  });

  it("50問を解き切って結果集計できる", () => {
    const items = Array.from({ length: 50 }, (_, index) => question(`q${index}`));
    let state = createInitialState(items, 1);
    state.activeSession = createSession(items, state, "normal", ["空欄"], () => 0.3)!;
    for (let index = 0; index < 50; index += 1) {
      const item = items.find((candidate) => candidate.id === state.activeSession!.questionIds[index])!;
      state.activeSession!.currentIndex = index;
      state = recordSessionAnswer(state, item, index < 25 ? "正解" : null, index >= 25);
    }
    const summary = summarizeSession(state.activeSession!.answers);
    expect(summary.total).toBe(50);
    expect(summary.correct).toBe(25);
    expect(summary.incorrect).toBe(25);
    expect(summary.unknown).toBe(25);
  });
});
