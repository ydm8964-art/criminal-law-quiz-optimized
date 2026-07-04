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
    return String(text || "").replace(/\s+/g, "").replace(/[，。；：、“”‘’（）()《》]/g, "");
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
      /是([^。；]{4,28}?)(?:।|；|$)/,
      /应当([^。；]{4,28}?)(?:।|；|$)/,
      /可以([^。；]{4,28}?)(?:।|；|$)/,
      /不得([^。；]{4,28}?)(?:।|；|$)/,
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
    if (state.articleIndex >= filtered.length) state.articleIndex = 0;
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
      <aside class="sidebar panel">
        <div class="brand">
          <h1>刑法练习</h1>
          <p class="small-note">学习您的法律知识</p>
        </div>
        <div class="progress-card panel">
          <div class="progress-line"><div class="progress-fill" style="width: ${Math.min(100, (progressCount() / (articles.length * questionTypes.length)) * 100)}%"></div></div>
          <div class="small-note" style="text-align:center; margin-top:8px">已完成: ${progressCount()} 题</div>
        </div>
        <nav class="filter-card panel">
          <label class="section-title">章节选择</label>
          <select id="chapter">
            ${chapters.map(c => `<option value="${c}" ${state.chapter === c ? "selected" : ""}>${c}</option>`).join('')}
          </select>
        </nav>
        <div class="menu-list panel">
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
    const currentTypeObj = questionTypes.find(t => t.id === typeId);

    return `
      <main class="workspace">
        <div class="topbar panel">
          <div class="type-tabs">
            ${questionTypes.map(t => `<button class="tab ${t.id === typeId ? 'active' : ''}" data-type="${t.id}">${t.label}</button>`).join('')}
          </div>
          <div class="top-actions">
            <button class="icon-button" id="hint" title="提示"><svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2-11h-2V7h2v2zm0 8h-2v-2h2v2zm-2-4h-2V9h2v2z\"/></svg></button>
            <button class="icon-button" id="themeToggle"><svg width="20\" height="20\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 7a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 14c-2.69 0-5-2.31-5-5H7c0 3.87 3.13 7 7 7s7-3.13 7-7h-4c0 2.76-2.24 5-5 5z\"/></svg></button>
          </div>
        </div>
        
        <div class="question-card panel">
          <header class="article-head">
            <div>
              <div class="article-kicker">${escapeHtml(article.part || '总则')}</div>
              <h2>${escapeHtml(article.label)}</h2>
              <div class="meta">第 ${articleNumber(article)} 条</div>
            </div>
            <div class="actions">
               <button class="ghost-button" id="prev"><svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d=\"M15.41 16.59L10.25 21l-4.56-4.56L3 17.91V6h18v2.09z\"/></svg></button>
               <button class="primary-button" id="next">下一步</button>
            </div>
          </header>

          <div class="prompt">
            ${this.getPromptHtml(question)}
          </div>

          <div class="question-area">
            ${this.getQuestionContentHtml(question)}
          </div>

          <div class="actions">
            ${!isChecked 
              ? `<button class="primary-button" id="check">提交答案</button>
                 <button class="ghost-button" id="reveal">显示答案</button>`
              : `<button class="primary-button" id="nextBottom">下一题</button>`
            }
          </div>

          ${state.feedback ? `<div class="feedback ${state.feedback.tone}">${state.feedback.text}</div>` : ''}
        </div>
      </main>
    `;
  }

  function getPromptHtml(question) {
    if (state.type === 'choice') return question.firstSentence;
    if (state.type === 'blank') return question.blankPrompt;
    return question.firstSentence;
  }

  function getQuestionContentHtml(question) {
    if (state.type === 'choice') {
      return `
        <div class="choices">
          ${question.options.map((opt, i) => `
            <button class="choice-button ${state.selected === opt.id ? 'selected' : ''}" data-choice="${opt.id}">
              <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
              <span>${escapeHtml(opt)}</span>
            </button>
          `).join('')}
        </div>
      `;
    }
    if (state.type === 'blank') {
      return `<div class="prompt">${question.blankPrompt}</div>`;
    }
    return `
      <div class="prompt">${question.wrongPrompt}</div>
      <div class="actions">
        <button class="primary-button" id="check">校验</button>
      </div>
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
        <button class="ghost-button" id="mobileMenu">${renderIcon("menu")} 目录</button>
        <button class="ghost-button" id="mobileSource">${renderIcon("panel")} 原文</button>
      </div>
    `;
  }

  function renderIcon(type) {
    const icons = {
      menu: '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M3 18h18v-2H3v2zM3 6v2h18V6H3z"/></svg>',
      panel: '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d=\"M4 19h16v-2H4v2zM4 13h16v-2H4v2zM4 7v2h16V7H4z\"/></svg>'
    };
    return icons[type];
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
        state.selected = button.dataset.choice;
        state.feedback = null;
        render();
      });
    });
    document.querySelectorAll("[data-chapter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.chapter = button.dataset.chapter;
        state.articleIndex = 0;
        resetAnswer();
        render();
      });
    });
    document.querySelectorAll("[data-mistake-id]").forEach((button) => {
      button.addEventListener("click", () => goToArticle(button.dataset.mistakeId, button.dataset.mistakeType));
    });

    const search = document.getElementById("search");
    if (search) {
      search.addEventListener("input", (event) => {
        state.query = event.target.value;
        state.articleIndex = 0;
        resetAnswer();
        render();
      });
    }

    const chapter = document.getElementById("chapter");
    if (chapter) {
      chapter.addEventListener("change", (event) => {
        state.chapter = event.target.value;
        state.articleIndex = 0;
        resetAnswer();
        render();
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
      if (!state.selected) return;
      const isCorrect = state.selected === question.key;
      state.feedback = isCorrect 
        ? { tone: "good", text: "回答正确！" }
        : { tone: "bad", text: `回答错误。正确答案是：${question.key}` };
      setProgress(article, "choice", isCorrect ? "correct" : "wrong");
    } else if (state.type === "blank") {
      const isCorrect = normalize(state.typed) === normalize(question.key);
      state.feedback = isCorrect 
        ? { tone: "good", text: "回答正确！" }
        : { tone: "bad", text: `回答错误。正确答案是：${question.key}` };
      setProgress(article, "blank", isCorrect ? "correct" : "wrong");
    } else if (state.type === "correction") {
      const isCorrect = normalize(state.typed) === normalize(question.key);
      state.feedback = isCorrect 
        ? { tone: "good", text: "回答正确！" }
        : { tone: "bad", text: `回答错误。正确答案是：${question.key}` };
      setProgress(article, "correction", isCorrect ? "correct" : "wrong");
    }
    state.checked = true;
    render();
  }

  function nextArticle(step) {
    state.articleIndex += step;
    state.checked = false;
    state.feedback = null;
    state.selected = "";
    state.typed = "";
    render();
  }

  function resetAnswer() {
    state.checked = false;
    state.feedback = null;
    state.selected = "";
    state.typed = "";
  }

  function goToArticle(id, type) {
    const index = articles.findIndex(a => a.id === id);
    if (index !== -1) {
      state.articleIndex = index;
      state.type = type;
      resetAnswer();
      render();
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  render();
})();
