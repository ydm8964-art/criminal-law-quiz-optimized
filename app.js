(function () {
  const data = window.CRIMINAL_LAW_DATA;
  const articles = data.articles;
  const questionTypes = [
    { id: "choice", label: "选择题" },
    { id: "blank", label: "填空题" },
    { id: "correction", label: "改错题" },
  ];

  const storageKey = "criminal-law-quiz-progress-v1";
  const themeKey = "criminal-law-quiz-theme";

  const state = {
    type: "choice",
    articleIndex: 0,
    chapter: "全部",
    query: "",
    selected: "",
    typed: "",
    checked: false,
    feedback: null,
    showHint: false,
    mobilePanel: "",
    progress: loadProgress(),
    theme: localStorage.getItem(themeKey) || "light",
  };

  const chapters = ["全部", ...Array.from(new Set(articles.map((a) => a.chapter).filter(Boolean)))];

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(storageKey, JSON.stringify(state.progress));
  }

  function normalize(text) {
    return String(text || "").replace(/\s+/g, "").replace(/[，。；：、""''（）()《》]/g, "");
  }

  function seeded(seed) {
    let x = seed;
    return function () {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
  }

  function articleNumber(article) {
    const found = article.id.match(/\d+/);
    return found ? Number(found[0]) : articles.indexOf(article) + 1;
  }

  function compactText(text) {
    return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  }

  function sentenceParts(article) {
    const parts = compactText(article.text)
      .split(/[。；]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 8);
    return parts.length ? parts : [compactText(article.text).slice(0, 80)];
  }

  function keywordFor(article) {
    const text = compactText(article.text);
    const patterns = [
      /处([^。；]{4,32}?)(?:。|；|$)/,
      /是([^。；]{4,28}?)(?:。|；|$)/,
      /应当([^。；]{4,28}?)(?:。|；|$)/,
      /可以([^。；]{4,28}?)(?:。|；|$)/,
      /不得([^。；]{4,28}?)(?:。|；|$)/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].replace(/[，、]$/, "").trim();
    }
    const first = sentenceParts(article)[0];
    const chunks = first.match(/[\u4e00-\u9fa5]{4,14}/g) || [];
    return chunks[Math.min(1, chunks.length - 1)] || first.slice(0, 12);
  }

  function nearbyArticles(article, count) {
    const base = articles.indexOf(article);
    const pool = [];
    for (let offset = 1; pool.length < count + 8 && offset < 80; offset += 1) {
      if (articles[base - offset]) pool.push(articles[base - offset]);
      if (articles[base + offset]) pool.push(articles[base + offset]);
    }
    return pool.slice(0, count);
  }

  function shuffle(list, seed) {
    const rand = seeded(seed);
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function makeQuestion(article) {
    const key = keywordFor(article);
    const number = articleNumber(article);
    const firstSentence = sentenceParts(article)[0];
    const distractors = nearbyArticles(article, 9)
      .map(keywordFor)
      .filter((item) => item && normalize(item) !== normalize(key));
    const options = shuffle([key, ...Array.from(new Set(distractors)).slice(0, 3)], number + 17);
    const wrong = options.find((item) => normalize(item) !== normalize(key)) || "三年以下有期徒刑或者拘役";
    const blankPrompt = compactText(article.text).replace(key, "____");
    const wrongPrompt = compactText(article.text).replace(key, wrong);

    return {
      key,
      wrong,
      firstSentence,
      options,
      blankPrompt,
      wrongPrompt,
    };
  }

  function currentArticle() {
    const filtered = filteredArticles();
    if (!filtered.length) return articles[0];
    if (state.articleIndex >= filtered.length) state.articleIndex = filtered.length - 1;
    if (state.articleIndex < 0) state.articleIndex = 0;
    return filtered[state.articleIndex];
  }

  function filteredArticles() {
    const query = normalize(state.query);
    return articles.filter((article) => {
      const chapterOk = state.chapter === "全部" || article.chapter === state.chapter;
      const queryOk =
        !query ||
        normalize(`${article.label}${article.part}${article.chapter}${article.section}${article.text}`).includes(query);
      return chapterOk && queryOk;
    });
  }

  function progressKey(article, type) {
    return `${article.id}:${type}`;
  }

  function setProgress(article, type, result) {
    state.progress[progressKey(article, type)] = {
      result,
      at: new Date().toISOString(),
      label: article.label,
      type,
      chapter: article.chapter,
    };
    saveProgress();
  }

  function progressCount() {
    return Object.values(state.progress).length;
  }

  function render() {
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem(themeKey, state.theme);

    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `
      ${renderMobileBar()}
      <div class="app-shell">
        ${renderSidebar()}
        ${renderQuestion()}
        ${renderInspector()}
      </div>
    `;
    bindEvents();
  }

  function renderSidebar() {
    return `
      <aside class="sidebar ${state.mobilePanel === 'menu' ? 'open' : ''}">
        <div class="brand panel">
          <h1>刑法练习</h1>
          <p class="small-note">学习您的法律知识</p>
        </div>
        <div class="progress-card panel">
          <div class="progress-line"><div class="progress-fill" style="width: ${Math.min(100, (progressCount() / (articles.length * questionTypes.length)) * 100)}%"></div></div>
          <div class="small-note" style="text-align:center; margin-top:8px">已完成: ${progressCount()} / ${articles.length * questionTypes.length} 题</div>
        </div>
        <nav class="filter-card panel">
          <label class="section-title">章节选择</label>
          <select id="chapter">
            ${chapters.map(c => `<option value="${escapeHtml(c)}" ${state.chapter === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </nav>
        <div class="menu-list panel">
          <h3 style="margin:0 0 12px;font-size:14px;color:var(--muted)">最近错题</h3>
          <div class="mistake-list">
            ${renderMistakeShortlist()}
          </div>
        </div>
      </aside>
    `;
  }

  function renderMistakeShortlist() {
    const mistakes = Object.entries(state.progress)
      .filter(([, value]) => value.result === "wrong")
      .slice(-10)
      .reverse();
    return mistakes.length
      ? mistakes
          .map(([key, item]) => {
            const id = key.split(":")[0];
            return `<button class="mistake-item" data-mistake-id="${id}" data-mistake-type="${item.type}"><strong style="color:var(--bad)">${escapeHtml(item.label)}</strong><span class="mistake-meta">${escapeHtml(item.chapter || "")}</span></button>`;
          })
          .join("")
      : '<div class="empty">还没有错题</div>';
  }

  function renderQuestion() {
    const article = currentArticle();
    const question = makeQuestion(article);
    const isChecked = state.checked;
    const typeId = state.type;

    return `
      <main class="workspace">
        <div class="topbar panel">
          <div class="type-tabs">
            ${questionTypes.map(t => `<button class="tab ${t.id === typeId ? 'active' : ''}" data-type="${t.id}">${t.label}</button>`).join('')}
          </div>
          <div class="top-actions">
            ${state.showHint ? `<div class="hint-bubble">提示：关键词在「${escapeHtml(question.key)}」附近</div>` : ''}
            <button class="icon-button" id="hint" title="提示">💡</button>
            <button class="icon-button" id="themeToggle" title="切换主题">${state.theme === 'light' ? '🌙' : '☀️'}</button>
          </div>
        </div>
        
        <div class="question-card panel">
          <header class="article-head">
            <div>
              <div class="article-kicker">${escapeHtml(article.part || '总则')}</div>
              <h2>${escapeHtml(article.label)}</h2>
              <div class="meta">${escapeHtml(article.chapter || '')}</div>
            </div>
            <div class="actions">
               <button class="ghost-button" id="prev">← 上一条</button>
               <button class="primary-button" id="next">下一条 →</button>
            </div>
          </header>

          <div class="prompt">
            ${getPromptHtml(question, typeId)}
          </div>

          <div class="question-area">
            ${getQuestionContentHtml(question, typeId)}
          </div>

          <div class="actions" style="margin-top:20px;">
            ${!isChecked 
              ? `<button class="primary-button" id="check">提交答案</button>
                 <button class="ghost-button" id="reveal">显示答案</button>`
              : `<button class="primary-button" id="nextBottom">下一题</button>`
            }
          </div>

          ${state.feedback ? `<div class="feedback ${state.feedback.tone}">${escapeHtml(state.feedback.text)}</div>` : ''}
        </div>
      </main>
    `;
  }

  function getPromptHtml(question, typeId) {
    if (typeId === 'choice') return `<p><strong>请选择正确的关键词：</strong></p><p>${escapeHtml(question.firstSentence)}</p>`;
    if (typeId === 'blank') return `<p><strong>请填写空白处的内容：</strong></p>`;
    return `<p><strong>请找出下列表述中的错误并更正：</strong></p>`;
  }

  function getQuestionContentHtml(question, typeId) {
    if (typeId === 'choice') {
      return `
        <div class="choices">
          ${question.options.map((opt, i) => `
            <button class="choice-button ${state.selected === opt ? 'selected' : ''}" data-choice="${escapeHtml(opt)}">
              <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
              <span>${escapeHtml(opt)}</span>
            </button>
          `).join('')}
        </div>
      `;
    }
    if (typeId === 'blank') {
      return `
        <div class="prompt" style="padding:16px;background:var(--paper-soft);border-radius:8px;margin-bottom:16px;">${escapeHtml(question.blankPrompt)}</div>
        <input type="text" class="answer-input" id="blankInput" placeholder="请输入答案" value="${escapeHtml(state.typed)}" ${state.checked ? 'disabled' : ''} />
      `;
    }
    return `
      <div class="prompt" style="padding:16px;background:var(--paper-soft);border-radius:8px;margin-bottom:16px;">${escapeHtml(question.wrongPrompt)}</div>
      <input type="text" class="answer-input" id="correctionInput" placeholder="请输入正确的关键词" value="${escapeHtml(state.typed)}" ${state.checked ? 'disabled' : ''} />
    `;
  }

  function renderInspector() {
    const article = currentArticle();
    return `
      <aside class="inspector ${state.mobilePanel === 'source' ? 'open' : ''}">
        <section class="source-card panel">
          <h3>条文原文</h3>
          <div class="article-text">${escapeHtml(article.text)}</div>
        </section>
      </aside>
    `;
  }

  function renderMobileBar() {
    return `
      <div class="mobile-bar">
        <button class="ghost-button" id="mobileMenu">☰ 目录</button>
        <button class="ghost-button" id="mobileSource">📄 原文</button>
      </div>
    `;
  }

  function bindEvents() {
    document.querySelectorAll("[data-type]").forEach((button) => {
      button.addEventListener("click", () => {
        state.type = button.dataset.type;
        resetAnswer();
        render();
      });
    });
    
    document.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!state.checked) {
          state.selected = button.dataset.choice;
          state.feedback = null;
          render();
        }
      });
    });
    
    document.querySelectorAll("[data-mistake-id]").forEach((button) => {
      button.addEventListener("click", () => goToArticle(button.dataset.mistakeId, button.dataset.mistakeType));
    });

    const chapter = document.getElementById("chapter");
    if (chapter) {
      chapter.addEventListener("change", (event) => {
        state.chapter = event.target.value;
        state.articleIndex = 0;
        resetAnswer();
        render();
      });
    }

    const blankInput = document.getElementById("blankInput");
    if (blankInput) {
      blankInput.addEventListener("input", (e) => {
        state.typed = e.target.value;
      });
    }

    const correctionInput = document.getElementById("correctionInput");
    if (correctionInput) {
      correctionInput.addEventListener("input", (e) => {
        state.typed = e.target.value;
      });
    }

    document.getElementById("check")?.addEventListener("click", checkAnswer);
    document.getElementById("next")?.addEventListener("click", () => nextArticle(1));
    document.getElementById("nextBottom")?.addEventListener("click", () => nextArticle(1));
    document.getElementById("prev")?.addEventListener("click", () => nextArticle(-1));
    document.getElementById("hint")?.addEventListener("click", () => {
      state.showHint = !state.showHint;
      render();
    });
    document.getElementById("reveal")?.addEventListener("click", () => {
      const question = makeQuestion(currentArticle());
      state.feedback = { tone: "warn", text: `正确答案：${question.key}` };
      state.checked = true;
      render();
    });
    document.getElementById("mobileMenu")?.addEventListener("click", () => {
      state.mobilePanel = state.mobilePanel === "menu" ? "" : "menu";
      render();
    });
    document.getElementById("mobileSource")?.addEventListener("click", () => {
      state.mobilePanel = state.mobilePanel === "source" ? "" : "source";
      render();
    });
    document.getElementById("themeToggle")?.addEventListener("click", () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      render();
    });
  }

  function checkAnswer() {
    const article = currentArticle();
    const question = makeQuestion(article);
    
    if (state.type === "choice") {
      if (!state.selected) {
        state.feedback = { tone: "warn", text: "请先选择一个答案" };
        render();
        return;
      }
      const isCorrect = normalize(state.selected) === normalize(question.key);
      state.feedback = isCorrect 
        ? { tone: "good", text: "✓ 回答正确！" }
        : { tone: "bad", text: `✗ 回答错误。正确答案是：${question.key}` };
      setProgress(article, "choice", isCorrect ? "correct" : "wrong");
    } else if (state.type === "blank") {
      if (!state.typed.trim()) {
        state.feedback = { tone: "warn", text: "请先输入答案" };
        render();
        return;
      }
      const isCorrect = normalize(state.typed) === normalize(question.key);
      state.feedback = isCorrect 
        ? { tone: "good", text: "✓ 回答正确！" }
        : { tone: "bad", text: `✗ 回答错误。正确答案是：${question.key}` };
      setProgress(article, "blank", isCorrect ? "correct" : "wrong");
    } else if (state.type === "correction") {
      if (!state.typed.trim()) {
        state.feedback = { tone: "warn", text: "请先输入正确答案" };
        render();
        return;
      }
      const isCorrect = normalize(state.typed) === normalize(question.key);
      state.feedback = isCorrect 
        ? { tone: "good", text: "✓ 回答正确！" }
        : { tone: "bad", text: `✗ 回答错误。正确答案是：${question.key}` };
      setProgress(article, "correction", isCorrect ? "correct" : "wrong");
    }
    
    state.checked = true;
    render();
  }

  function nextArticle(step) {
    const filtered = filteredArticles();
    state.articleIndex += step;
    
    if (state.articleIndex >= filtered.length) state.articleIndex = 0;
    if (state.articleIndex < 0) state.articleIndex = filtered.length - 1;
    
    resetAnswer();
    render();
  }

  function resetAnswer() {
    state.checked = false;
    state.feedback = null;
    state.selected = "";
    state.typed = "";
    state.showHint = false;
  }

  function goToArticle(id, type) {
    const filtered = filteredArticles();
    const article = articles.find(a => a.id === id);
    if (article) {
      const index = filtered.indexOf(article);
      if (index !== -1) {
        state.articleIndex = index;
        state.type = type;
        resetAnswer();
        state.mobilePanel = "";
        render();
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  render();
})();
