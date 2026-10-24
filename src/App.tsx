import { useEffect, useMemo, useRef, useState } from "react";

import {
  createInitialState,
  createSession,
  reconcileState,
  recordSessionAnswer,
  statusCounts,
  summarizeSession,
} from "./study";
import { exportState, loadState, readImportedState, saveState } from "./storage";
import {
  GENRES,
  type Genre,
  type Question,
  type QuestionDataset,
  type SessionMode,
  type SessionSummary,
  type StudyState,
} from "./types";

type Screen = "home" | "quiz" | "result";

const GENRE_LABELS: Record<Genre, string> = {
  空欄: "空欄補充",
  同じ使い方: "同じ使い方",
  関係: "語句の関係",
  熟語選択_類似順: "熟語選択",
};

function App() {
  const [dataset, setDataset] = useState<QuestionDataset | null>(null);
  const [state, setState] = useState<StudyState | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [loadingError, setLoadingError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<SessionSummary | null>(null);
  const [lastMode, setLastMode] = useState<SessionMode>("normal");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}questions.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`問題データを読み込めませんでした（${response.status}）`);
        return (await response.json()) as QuestionDataset;
      })
      .then((loaded) => {
        if (!active) return;
        setDataset(loaded);
        setState(reconcileState(loadState(), loaded.questions, loaded.version));
      })
      .catch((error: unknown) => {
        if (active) setLoadingError(error instanceof Error ? error.message : "問題データの読み込みに失敗しました。");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  const questionMap = useMemo(
    () => new Map((dataset?.questions ?? []).map((question) => [question.id, question])),
    [dataset],
  );

  if (loadingError) {
    return (
      <main className="app-shell centered-shell">
        <section className="card error-card">
          <div className="large-symbol">!</div>
          <h1>読み込みエラー</h1>
          <p>{loadingError}</p>
          <button className="primary-button" onClick={() => window.location.reload()}>再読み込み</button>
        </section>
      </main>
    );
  }

  if (!dataset || !state) {
    return (
      <main className="app-shell centered-shell" aria-live="polite">
        <div className="loader" />
        <p className="muted">問題を準備しています…</p>
      </main>
    );
  }

  const counts = statusCounts(state);
  const session = state.activeSession;
  const currentQuestion = session ? questionMap.get(session.questionIds[session.currentIndex]) : undefined;
  const currentAnswer = currentQuestion
    ? session?.answers.find((answer) => answer.questionId === currentQuestion.id)
    : undefined;

  function updateState(next: StudyState) {
    setState(next);
  }

  function toggleGenre(genre: Genre) {
    const selected = state!.selectedGenres.includes(genre);
    const next = selected
      ? state!.selectedGenres.filter((item) => item !== genre)
      : [...state!.selectedGenres, genre];
    if (!next.length) {
      setNotice("少なくとも1つのジャンルを選んでください。");
      return;
    }
    setNotice("");
    updateState({ ...state!, selectedGenres: next });
  }

  function startSession(mode: SessionMode) {
    const nextSession = createSession(dataset!.questions, state!, mode, state!.selectedGenres);
    if (!nextSession) {
      setNotice(
        mode === "difficult"
          ? "選択中のジャンルに☠の問題がありません。"
          : "現在は再出題できる問題がありません。復習間隔を保つため、しばらく通常問題を進めてください。",
      );
      return;
    }
    setNotice("");
    setResult(null);
    setLastMode(mode);
    updateState({ ...state!, activeSession: nextSession });
    setScreen("quiz");
    window.scrollTo({ top: 0 });
  }

  function submitAnswer(selected: string | null, unknown = false) {
    if (!currentQuestion || currentAnswer) return;
    setState((previous) =>
      previous ? recordSessionAnswer(previous, currentQuestion, selected, unknown) : previous,
    );
  }

  function goNext() {
    if (!session || !currentAnswer) return;
    if (session.currentIndex >= session.questionIds.length - 1) {
      setResult(summarizeSession(session.answers));
      updateState({ ...state!, activeSession: null });
      setScreen("result");
      window.scrollTo({ top: 0 });
      return;
    }
    updateState({
      ...state!,
      activeSession: { ...session, currentIndex: session.currentIndex + 1 },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveAndExit() {
    setScreen("home");
    setNotice("途中記録を保存しました。いつでも続きから再開できます。");
    window.scrollTo({ top: 0 });
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await readImportedState(file);
      const reconciled = reconcileState(imported, dataset!.questions, dataset!.version);
      updateState(reconciled);
      setScreen("home");
      setNotice("学習記録を復元しました。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "学習記録を復元できませんでした。");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  function resetAll() {
    if (!window.confirm("すべての学習記録を削除します。元に戻せません。よろしいですか？")) return;
    updateState(createInitialState(dataset!.questions, dataset!.version));
    setResult(null);
    setScreen("home");
    setNotice("学習記録をリセットしました。");
  }

  if (screen === "quiz" && session && currentQuestion) {
    const options = session.optionOrders[currentQuestion.id] ?? currentQuestion.options.map((option) => option.text);
    const progressPercent = ((session.currentIndex + (currentAnswer ? 1 : 0)) / session.questionIds.length) * 100;
    return (
      <main className="app-shell quiz-shell">
        <header className="quiz-header">
          <div>
            <span className="eyebrow">{GENRE_LABELS[currentQuestion.genre]}</span>
            <h1>{session.mode === "difficult" ? "☠ 苦手トレーニング" : "通常学習"}</h1>
          </div>
          <span className="question-counter">第{session.currentIndex + 1}問 / {session.questionIds.length}問</span>
        </header>

        <div className="progress-track" aria-label={`進捗 ${Math.round(progressPercent)}%`}>
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        <section className="question-card">
          <p className="question-text">{currentQuestion.prompt}</p>
          <div className="options" aria-label="選択肢">
            {options.map((option, index) => {
              const source = currentQuestion.options.find((item) => item.text === option);
              const isSelected = currentAnswer?.selected === option;
              const isCorrect = Boolean(currentAnswer) && option === currentQuestion.answer;
              const isWrong = Boolean(currentAnswer) && isSelected && !currentAnswer.correct;
              const className = ["option-button", isCorrect && "is-correct", isWrong && "is-wrong", isSelected && "is-selected"]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  className={className}
                  disabled={Boolean(currentAnswer)}
                  key={`${currentQuestion.id}-${option}`}
                  onClick={() => submitAnswer(option)}
                >
                  <span className="option-index">{index + 1}</span>
                  <span>{option}</span>
                  {state.settings.showSupplementedOptions && source?.supplemented && (
                    <span className="supplemented-tag">補完</span>
                  )}
                </button>
              );
            })}
          </div>

          {!currentAnswer ? (
            <button className="unknown-button" onClick={() => submitAnswer(null, true)}>わからない</button>
          ) : (
            <div className={`answer-feedback ${currentAnswer.correct ? "correct" : "incorrect"}`} aria-live="polite">
              <div className="answer-symbol">{currentAnswer.correct ? "〇" : "✕"}</div>
              <div>
                <strong>{currentAnswer.correct ? "正解です！" : currentAnswer.unknown ? "正解を確認しましょう" : "惜しい！"}</strong>
                {!currentAnswer.correct && <p>正解：{currentQuestion.answer}</p>}
              </div>
              <button className="primary-button next-button" onClick={goNext}>
                {session.currentIndex === session.questionIds.length - 1 ? "結果を見る" : "次の問題へ"}
              </button>
            </div>
          )}
        </section>

        <button className="text-button exit-button" onClick={saveAndExit}>記録して終了</button>
      </main>
    );
  }

  if (screen === "result" && result) {
    return (
      <main className="app-shell result-shell">
        <section className="card result-card">
          <div className="result-badge">学習完了</div>
          <h1>おつかれさまでした！</h1>
          <div className="accuracy-ring" style={{ "--accuracy": `${result.accuracy * 3.6}deg` } as React.CSSProperties}>
            <span>{result.accuracy}<small>%</small></span>
          </div>
          <p className="muted">{result.total}問の結果</p>
          <div className="result-grid">
            <ResultItem label="正解" value={result.correct} tone="green" />
            <ResultItem label="不正解" value={result.incorrect} tone="red" />
            <ResultItem label="わからない" value={result.unknown} tone="blue" />
            <ResultItem label="★になった" value={result.becameStar} tone="gold" />
            <ResultItem label="★★になった" value={result.becameMastered} tone="gold" />
            <ResultItem label="新たな☠" value={result.becameDifficult} tone="dark" />
          </div>
          <div className="stacked-actions">
            <button className="primary-button" onClick={() => startSession(lastMode)}>次の50問</button>
            <button className="secondary-button" onClick={() => { setScreen("home"); setNotice(""); }}>ホームへ</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell home-shell">
      <header className="hero">
        <div className="brand-mark">S</div>
        <div>
          <span className="eyebrow light">SPI TEST CENTER</span>
          <h1>ことばを、少しずつ確実に。</h1>
          <p>今日の積み重ねが、本番の自信になる。</p>
        </div>
      </header>

      <section className="summary-section" aria-labelledby="progress-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LEARNING PROGRESS</span>
            <h2 id="progress-title">学習の進み具合</h2>
          </div>
          <span className="dataset-count">全{dataset.questions.length}問</span>
        </div>
        <div className="stat-grid">
          <StatCard label="残り" value={counts.remaining} symbol="→" featured />
          <StatCard label="未習得" value={counts.zero} symbol="0" />
          <StatCard label="あと1回" value={counts.star} symbol="★" />
          <StatCard label="クリア" value={counts.mastered} symbol="★★" />
          <StatCard label="苦手" value={counts.difficult} symbol="☠" />
        </div>
      </section>

      {notice && <div className="notice" role="status">{notice}</div>}

      {state.activeSession && (
        <section className="resume-card">
          <div>
            <span className="eyebrow">途中の学習</span>
            <h2>第{state.activeSession.currentIndex + 1}問から再開</h2>
            <p>{state.activeSession.mode === "difficult" ? "苦手トレーニング" : "通常学習"}・最大{state.activeSession.questionIds.length}問</p>
          </div>
          <button className="primary-button" onClick={() => { setLastMode(state.activeSession!.mode); setScreen("quiz"); }}>学習を再開</button>
        </section>
      )}

      <section className="card action-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">START</span>
            <h2>学習をはじめる</h2>
          </div>
          <span className="session-note">1セット最大50問</span>
        </div>
        <div className="primary-actions">
          <button className="primary-button large" onClick={() => startSession("normal")} disabled={Boolean(state.activeSession)}>
            <span>通常出題</span><small>未習得を優先してランダム出題</small>
          </button>
          <button className="danger-button large" onClick={() => startSession("difficult")} disabled={Boolean(state.activeSession)}>
            <span>☠ 苦手問題</span><small>苦手だけを集中トレーニング</small>
          </button>
        </div>
        {state.activeSession && <p className="inline-help">途中の学習を終えるか再開してから、新しいセットを開始できます。</p>}
      </section>

      <section className="card genre-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">CATEGORY</span>
            <h2>出題ジャンル</h2>
          </div>
          <span className="selected-count">{state.selectedGenres.length} / {GENRES.length}</span>
        </div>
        <div className="genre-list">
          {GENRES.map((genre) => (
            <label className="genre-option" key={genre}>
              <input
                type="checkbox"
                checked={state.selectedGenres.includes(genre)}
                onChange={() => toggleGenre(genre)}
              />
              <span className="custom-check">✓</span>
              <span>{GENRE_LABELS[genre]}</span>
              <small>{dataset.questions.filter((question) => question.genre === genre).length}問</small>
            </label>
          ))}
        </div>
      </section>

      <section className="card settings-card">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">DATA & SETTINGS</span>
            <h2>記録と設定</h2>
          </div>
        </div>
        <label className="switch-row">
          <span><strong>補完選択肢を表示</strong><small>Excelで赤文字だった選択肢に印を付けます</small></span>
          <input
            type="checkbox"
            checked={state.settings.showSupplementedOptions}
            onChange={(event) => updateState({
              ...state,
              settings: { ...state.settings, showSupplementedOptions: event.target.checked },
            })}
          />
        </label>
        <div className="utility-actions">
          <button className="secondary-button" onClick={() => exportState(state)}>記録をバックアップ</button>
          <button className="secondary-button" onClick={() => importRef.current?.click()}>記録を復元</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importBackup(event.target.files?.[0])} />
          <button className="reset-button" onClick={resetAll}>全学習記録をリセット</button>
        </div>
      </section>

      <footer>
        <p>学習記録はこの端末のブラウザに保存されます。</p>
        <p>通常出題の通算回答数：{state.totalNormalSequence}</p>
      </footer>
    </main>
  );
}

function StatCard({ label, value, symbol, featured = false }: { label: string; value: number; symbol: string; featured?: boolean }) {
  return (
    <div className={`stat-card ${featured ? "featured" : ""}`}>
      <span className="stat-symbol">{symbol}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{label}</small>
    </div>
  );
}

function ResultItem({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`result-item ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default App;
