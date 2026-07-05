(function () {
  const data = window.CRIMINAL_LAW_DATA;
  const articles = data.articles;
  const questionTypes = [
    { id: "choice", label: "选择题" },
    { id: "judge", label: "判断题" },
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
    mistakeFilter: "all",
    startedAt: Date.now(),
    streak: Number(localStorage.getItem("criminal-law-quiz-streak") || 0),
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
    const text = compactText(article.text);
    
    // 选择题：条文挖空，选项包含正确答案和干扰项
    const distractors = nearbyArticles(article, 9)
      .map(keywordFor)
      .filter((item) => item && normalize(item) !== normalize(key));
    const options = shuffle([key, ...Array.from(new Set(distractors)).slice(0, 3)], number + 17);
    const choicePrompt = text.replace(key, "____");
    
    // 判断题：正确或错误表述
    const wrongKeyword = options.find((item) => normalize(item) !== normalize(key)) || "三年以下有期徒刑或者拘役";
    const isCorrect = seeded(number + 100)() > 0.5;
    const judgePrompt = isCorrect ? text : text.replace(key, wrongKeyword);
    const judgeAnswer = isCorrect ? "correct" : "wrong";
    
    // 填空题：关键词留空
    const blankPrompt = text.replace(key, "____");
    
    // 改错题：错误表述
    const wrongPrompt = text.replace(key, wrongKeyword);

    return {
      key,
      wrongKeyword,
      options,
      choicePrompt,
      judgePrompt,
      judgeAnswer,
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

  function progressEntries() {
    return Object.values(state.progress);
  }

  function progressCount() {
    return progressEntries().length;
  }

  function correctCount() {
    return progressEntries().filter((item) => item.result === "correct").length;
  }

  function wrongCount() {
    return progressEntries().filter((item) => item.result === "wrong").length;
  }

  function accuracyRate() {
    const total = progressCount();
    return total ? Math.round((correctCount() / total) * 100) : 0;
  }

  function elapsedSeconds() {
    return Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
  }

  function formatSeconds(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m ? `${m}分${String(s).padStart(2, "0")}秒` : `${s}秒`;
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
          <div class="stats-grid">
            <div class="stat"><strong>${correctCount()}</strong><span>正确</span></div>
            <div class="stat"><strong>${wrongCount()}</strong><span>错题</span></div>
            <div class="stat"><strong>${accuracyRate()}%</strong><span>正确率</span></div>
          </div>
        </div>
        <nav class="filter-card panel">
          <label class="section-title">章节选择</label>
          <select id="chapter">
            ${chapters.map(c => `<option value="${escapeHtml(c)}" ${state.chapter === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <label class="section-title section-gap">全文搜索</label>
          <input class="search-input" id="search" type="search" placeholder="搜索条文、章节或关键词" value="${escapeHtml(state.query)}" />
          <label class="section-title section-gap">快速跳转</label>
          <div class="jump-row">
            <input class="search-input" id="jumpInput" type="number" min="1" max="505" placeholder="条文号" />
            <button class="mini-button" id="jumpBtn">跳转</button>
          </div>
        </nav>
        <div class="menu-list panel">
          <div class="panel-head">
            <h3>错题本</h3>
            <select id="mistakeFilter" class="mini-select">
              <option value="all" ${state.mistakeFilter === "all" ? "selected" : ""}>全部</option>
              ${questionTypes.map(t => `<option value="${t.id}" ${state.mistakeFilter === t.id ? "selected" : ""}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="mistake-list">
            ${renderMistakeShortlist()}
          </div>
        </div>
        <div class="utility-card panel">
          <button class="ghost-button full-button" id="resetProgress">清空学习记录</button>
          <p class="small-note">支持快捷键：←/→ 切换条文，Enter 提交。</p>
        </div>
      </aside>
    `;
  }

  function renderMistakeShortlist() {
    const mistakes = Object.entries(state.progress)
      .filter(([, value]) => value.result === "wrong" && (state.mistakeFilter === "all" || value.type === state.mistakeFilter))
      .slice(-10)
      .reverse();
    return mistakes.length
      ? mistakes
          .map(([key, item]) => {
            const id = key.split(":")[0];
            return `<button class="mistake-item" data-mistake-id="${id}" data-mistake-type="${item.type}"><strong style="color:var(--bad)">${escapeHtml(item.label)}</strong><span class="mistake-meta">${escapeHtml(item.chapter || "")}</span></button>`;
          })
          .join("")
      : '<div class="empty">暂无错题，继续保持！</div>';
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
            <span class="session-pill">第 ${state.articleIndex + 1} / ${filteredArticles().length} 条</span>
            <span class="session-pill">连对 ${state.streak}</span>
            <span class="session-pill">${formatSeconds(elapsedSeconds())}</span>
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
    if (typeId === 'choice') return `<p><strong>请根据条文选择正确的关键词填入空白处：</strong></p><p class="prompt-text">${escapeHtml(question.choicePrompt)}</p>`;
    if (typeId === 'judge') return `<p><strong>请判断下列表述是否正确：</strong></p><p class="prompt-text">${escapeHtml(question.judgePrompt)}</p>`;
    if (typeId === 'blank') return `<p><strong>请填写空白处的内容：</strong></p><p class="prompt-text">${escapeHtml(question.blankPrompt)}</p>`;
    return `<p><strong>请找出下列表述中的错误并更正：</strong></p><p class="prompt-text">${escapeHtml(question.wrongPrompt)}</p>`;
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
    if (typeId === 'judge') {
      return `
        <div class="choices judge-choices">
          <button class="choice-button ${state.selected === 'correct' ? 'selected' : ''}" data-choice="correct">
            <span class="choice-letter">✓</span>
            <span>正确</span>
          </button>
          <button class="choice-button ${state.selected === 'wrong' ? 'selected' : ''}" data-choice="wrong">
            <span class="choice-letter">✗</span>
            <span>错误</span>
          </button>
        </div>
      `;
    }
    if (typeId === 'blank') {
      return `
        <input type="text" class="answer-input" id="blankInput" placeholder="请输入答案" value="${escapeHtml(state.typed)}" ${state.checked ? 'disabled' : ''} />
      `;
    }
    return `
      <input type="text" class="answer-input" id="correctionInput" placeholder="请输入正确的关键词" value="${escapeHtml(state.typed)}" ${state.checked ? 'disabled' : ''} />
    `;
  }

  function renderInspector() {
    const article = currentArticle();
    return `
      <aside class="inspector ${state.mobilePanel === 'source' ? 'open' : ''}">
        <section class="source-card panel">
          <h3>条文原文</h3>
          <div class="source-meta">${escapeHtml(data.title)} · 共 ${data.articleCount} 条</div>
          <div class="article-text">${escapeHtml(article.text)}</div>
          <div class="source-version">${escapeHtml(data.version || "")}</div>
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

    const search = document.getElementById("search");
    if (search) {
      search.addEventListener("input", (event) => {
        state.query = event.target.value;
        state.articleIndex = 0;
        resetAnswer();
        render();
      });
    }

    const mistakeFilter = document.getElementById("mistakeFilter");
    if (mistakeFilter) {
      mistakeFilter.addEventListener("change", (event) => {
        state.mistakeFilter = event.target.value;
        render();
      });
    }

    document.getElementById("jumpBtn")?.addEventListener("click", jumpToNumber);
    document.getElementById("jumpInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") jumpToNumber();
    });

    document.getElementById("resetProgress")?.addEventListener("click", () => {
      if (confirm("确定要清空全部学习记录和错题吗？")) {
        state.progress = {};
        state.streak = 0;
        localStorage.removeItem(storageKey);
        localStorage.removeItem("criminal-law-quiz-streak");
        resetAnswer();
        render();
      }
    });

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
      const article = currentArticle();
      const question = makeQuestion(article);
      let answerText = "";
      if (state.type === "choice" || state.type === "blank" || state.type === "correction") {
        answerText = `正确答案：${question.key}`;
      } else if (state.type === "judge") {
        answerText = `正确答案：${question.judgeAnswer === "correct" ? "正确" : "错误"}`;
      }
      state.feedback = { tone: "warn", text: answerText };
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
    } else if (state.type === "judge") {
      if (!state.selected) {
        state.feedback = { tone: "warn", text: "请先选择正确或错误" };
        render();
        return;
      }
      const isCorrect = state.selected === question.judgeAnswer;
      state.feedback = isCorrect 
        ? { tone: "good", text: "✓ 判断正确！" }
        : { tone: "bad", text: `✗ 判断错误。正确答案是：${question.judgeAnswer === "correct" ? "正确" : "错误"}` };
      setProgress(article, "judge", isCorrect ? "correct" : "wrong");
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

    const result = state.feedback?.tone === "good";
    state.streak = result ? state.streak + 1 : 0;
    localStorage.setItem("criminal-law-quiz-streak", String(state.streak));
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

  function jumpToNumber() {
    const input = document.getElementById("jumpInput");
    const number = Number(input?.value || 0);
    if (!number) return;
    const target = articles.find((article) => articleNumber(article) === number);
    if (!target) return;
    state.chapter = "全部";
    state.query = "";
    state.articleIndex = articles.indexOf(target);
    state.mobilePanel = "";
    resetAnswer();
    render();
  }

  function resetAnswer() {
    state.checked = false;
    state.feedback = null;
    state.selected = "";
    state.typed = "";
    state.showHint = false;
    state.startedAt = Date.now();
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

  // Touch swipe gesture support for mobile
  let touchStartX = 0;
  let touchEndX = 0;
  
  document.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  
  document.addEventListener("touchend", (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const swipeThreshold = 80;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) < swipeThreshold) return;
    
    const activeElement = document.activeElement;
    if (activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)) {
      return;
    }
    
    if (diff > 0) {
      nextArticle(1);
    } else {
      nextArticle(-1);
    }
  }, { passive: true });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.key === "ArrowRight") nextArticle(1);
    if (event.key === "ArrowLeft") nextArticle(-1);
    if (event.key === "Enter" && !state.checked) checkAnswer();
    if (event.key.toLowerCase() === "h") {
      state.showHint = !state.showHint;
      render();
    }
  });

  setInterval(() => {
    if (!state.checked) {
      const timer = document.querySelector(".top-actions .session-pill:nth-child(3)");
      if (timer) timer.textContent = formatSeconds(elapsedSeconds());
    }
  }, 1000);

  render();
})();
