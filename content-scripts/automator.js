/**
 * NotebookLM Audio Podcaster - Content Script Automator
 * NotebookLM Web UIのDOMを堅牢に操作し、ソース追加から音声生成・ダウンロードまでを完結させます。
 */

(() => {
  if (window.__NLM_AUTOMATOR_INJECTED__) {
    console.log('[NLM Automator] Already injected, skipping re-init');
    return;
  }
  window.__NLM_AUTOMATOR_INJECTED__ = true;

  console.log('[NLM Automator] Content script initialized on:', window.location.href);
  showBanner('NotebookLM 自動操作スクリプト起動');

  let currentTaskId = null;
  let taskTitle = '';
  let capturedDownloadUrl = null;

  // ブラウザの Performance Resource から音声URLを探索（非侵襲・完全安全）
  function findAudioUrlInResources() {
    try {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        const r = entries[i];
        if (!r.name) continue;
        const url = r.name;
        if (
          url.includes('googleusercontent.com') ||
          url.includes('/download/audio') ||
          (url.includes('download') && (url.includes('audio') || url.includes('podcast'))) ||
          url.match(/\.(mp3|m4a|wav)(\?|$)/i) ||
          url.includes('mimeType=audio') ||
          url.includes('videoplayback')
        ) {
          if (url.includes('googleusercontent.com/notebooklm/')) {
            return url.includes('=m140') && !url.includes('=m140-dv') ? url.replace('=m140', '=m140-dv') : url;
          }
          return url;
        }
      }
    } catch (e) {}
    return null;
  }

  // DOMツリーから直接メディア要素やリンクを探索（非侵襲・完全安全）
  function findAudioUrlInDOM() {
    try {
      const mediaElements = Array.from(document.querySelectorAll('audio, video, source'));
      for (const el of mediaElements) {
        const src = el.src || el.currentSrc || el.getAttribute('src');
        if (src && (src.startsWith('blob:') || src.startsWith('http')) && !src.includes('google.com/notebook/')) {
          if (src.includes('googleusercontent.com/notebooklm/')) {
            return src.includes('=m140') && !src.includes('=m140-dv') ? src.replace('=m140', '=m140-dv') : src;
          }
          return src;
        }
      }

      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const a of links) {
        if (a.href && (a.href.startsWith('blob:') || a.href.startsWith('http')) && !a.href.includes('google.com/notebook/')) {
          if (a.hasAttribute('download') || a.href.includes('download') || a.href.includes('audio') || a.href.match(/\.(mp3|m4a|wav)(\?|$)/i)) {
            return a.href;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // --- メッセージ受信ハンドラ ---
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message.action === 'PING') {
      console.log('[NLM Automator] PING received, returning PONG');
      showBanner('自動操作スクリプトが接続されました');
      return Promise.resolve({ status: 'PONG', url: window.location.href });
    }

    if (message.action === 'EXECUTE_PIPELINE') {
      console.log('[NLM Automator] EXECUTE_PIPELINE received, starting task:', message.taskId);
      currentTaskId = message.taskId;
      taskTitle = message.title;

      setTimeout(() => {
        runPipeline(message).catch(err => {
          console.error('[NLM Automator] Pipeline execution failed:', err);
          reportFailed(err.message || String(err));
        });
      }, 50);

      return Promise.resolve({ accepted: true });
    }

    if (message.action === 'EXECUTE_DOWNLOAD_ONLY') {
      console.log('[NLM Automator] EXECUTE_DOWNLOAD_ONLY received');
      (async () => {
        try {
          currentTaskId = currentTaskId || `task_${Date.now()}`;
          const titleEl = document.querySelector('.artifact-title, h1');
          taskTitle = message.title || taskTitle || titleEl?.textContent?.trim() || '音声解説';
          const res = await executeDownloadOnly();
          sendResponse({ success: true, result: res });
        } catch (err) {
          console.error('[NLM Automator] EXECUTE_DOWNLOAD_ONLY failed:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });

  // スクリプト起動時にバックグラウンドへタスクを能動的に問い合わせる（プル型アーキテクチャ）
  async function requestTaskFromBackground(maxRetries = 10) {
    console.log('[NLM Automator] Starting task polling from background...');
    for (let i = 1; i <= maxRetries; i++) {
      try {
        const res = await browser.runtime.sendMessage({ action: 'REQUEST_TASK' });
        if (res && res.hasTask && res.task) {
          console.log('[NLM Automator] Received task from background:', res.task);
          currentTaskId = res.task.taskId;
          taskTitle = res.task.title;
          showBanner('タスクを受信しました。自動操作を開始します...');

          runPipeline(res.task).catch(err => {
            console.error('[NLM Automator] Pipeline execution failed:', err);
            reportFailed(err.message || String(err));
          });
          return true;
        } else {
          console.log(`[NLM Automator] Attempt ${i}: No active task returned yet`);
        }
      } catch (e) {
        console.warn(`[NLM Automator] Attempt ${i} request error:`, e);
      }
      await sleep(1000);
    }
    console.log('[NLM Automator] Polling complete. No task assigned to this tab.');
    return false;
  }

  // 初期化実行（DOMが準備でき次第ポーリング開始）
  setTimeout(requestTaskFromBackground, 300);

  async function checkResumeActiveTask() {
    try {
      const data = await browser.storage.local.get(['tasks', 'activeTaskId']);
      const activeTaskId = data.activeTaskId;
      if (!activeTaskId || !data.tasks || !data.tasks[activeTaskId]) return;

      const task = data.tasks[activeTaskId];
      // タスクが開始中かつ未完了で、かつすでにパイプラインが動いていない場合
      if (['starting', 'loading_page', 'creating_notebook'].includes(task.status) && !currentTaskId) {
        console.log('[NLM Automator] Found active pending task in storage, resuming:', activeTaskId);
        currentTaskId = task.id;
        taskTitle = task.title;
        runPipeline({
          taskId: task.id,
          title: task.title,
          url: task.url,
          prompt: task.prompt
        }).catch(err => {
          reportFailed(err.message || String(err));
        });
      }
    } catch (e) {
      console.warn('[NLM Automator] Error checking active tasks:', e);
    }
  }

  // --- ヘルパー関数群 ---

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 画面右上に実行中ステータスバナーを表示するUIヘルパー
  function showBanner(text, isError = false) {
    try {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => showBanner(text, isError), { once: true });
        return;
      }
      let banner = document.getElementById('nlm-automator-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'nlm-automator-banner';
        banner.style.cssText = `
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          background: #1a73e8;
          color: white;
          padding: 8px 14px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          font-size: 13px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
          pointer-events: none;
          transition: background 0.3s ease;
        `;
        document.body.appendChild(banner);
      }
      banner.style.background = isError ? '#d93025' : '#1a73e8';
      banner.innerHTML = `🎙️ <span>${text}</span>`;
    } catch (e) {}
  }

  function reportProgress(status, message) {
    console.log(`[NLM Automator] [${status}] ${message}`);
    showBanner(message, false);
    browser.runtime.sendMessage({
      action: 'TASK_PROGRESS',
      taskId: currentTaskId,
      status: status,
      message: message
    }).catch(() => {});
  }

  function reportComplete(audioUrl, directTriggered = false, customTitle = null) {
    const finalTitle = customTitle || taskTitle || '音声解説';
    console.log('[NLM Automator] Complete! Audio URL:', audioUrl, 'directTriggered:', directTriggered, 'title:', finalTitle);
    showBanner('音声解説の生成が完了しました！', false);
    browser.runtime.sendMessage({
      action: 'TASK_COMPLETE',
      taskId: currentTaskId,
      audioUrl: audioUrl,
      title: finalTitle,
      directTriggered: directTriggered
    }).catch(() => {});
  }

  function reportFailed(errorMsg) {
    console.error('[NLM Automator] Failed:', errorMsg);
    showBanner(`エラー: ${errorMsg}`, true);
    browser.runtime.sendMessage({
      action: 'TASK_FAILED',
      taskId: currentTaskId,
      error: errorMsg
    }).catch(() => {});
  }

  // 要素が表示（可視）されているか判定（拡張機能自身のバナーUIは完全に除外）
  function isVisible(el) {
    if (!el) return false;
    if (el.id === 'nlm-automator-banner' || el.closest('#nlm-automator-banner')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // 最も内側（葉ノード寄り）のテキストマッチ要素を探す
  function findElementByText(selector, regex) {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.sort((a, b) => a.childElementCount - b.childElementCount);

    for (const el of elements) {
      if (!isVisible(el)) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (regex.test(text)) {
        return el;
      }
    }
    return null;
  }

  // aria-label, title, placeholder 等を正規表現で探す
  function findElementByAria(regex) {
    const candidates = document.querySelectorAll('[aria-label], [title], [placeholder], [data-mat-icon-name]');
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const ph = el.getAttribute('placeholder') || '';
      const icon = el.getAttribute('data-mat-icon-name') || '';
      if (regex.test(aria) || regex.test(title) || regex.test(ph) || regex.test(icon)) {
        return el;
      }
    }
    return null;
  }

  // 汎用探索：セレクタ候補リストから最初に見つかった可視要素を返す
  function findFirstElement(selectors) {
    for (const sel of selectors) {
      if (typeof sel === 'string') {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (isVisible(el)) return el;
        }
      } else if (typeof sel === 'function') {
        try {
          const res = sel();
          if (res && isVisible(res)) return res;
        } catch (e) {}
      }
    }
    return null;
  }

  // 指定条件を満たす要素が出現するまで待機
  async function waitFor(fn, timeoutMs = 30000, intervalMs = 600) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = fn();
        if (res) return res;
      } catch (e) {}
      await sleep(intervalMs);
    }
    throw new Error(`Timeout after ${timeoutMs}ms waiting for element condition.`);
  }

  // 自然なマウスクリックを発行（重複クリック・多重ノート作成を完全防止）
  function triggerClick(element, isDirectTarget = false) {
    if (!element) return;
    try { element.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
    try { element.focus?.(); } catch (e) {}

    const target = isDirectTarget
      ? element
      : (element.closest('button, a, [role="button"], [role="menuitem"], [role="tab"]') || element);

    // 1. PointerEvent / MouseEvent の押下・離上シーケンス（各1回）
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 1,
      button: 0,
      buttons: 1
    };

    const PE = window.PointerEvent || window.MouseEvent;
    const ME = window.MouseEvent;

    try { target.dispatchEvent(new PE('pointerdown', eventInit)); } catch (e) {}
    try { target.dispatchEvent(new ME('mousedown', eventInit)); } catch (e) {}
    try { target.dispatchEvent(new PE('pointerup', eventInit)); } catch (e) {}
    try { target.dispatchEvent(new ME('mouseup', eventInit)); } catch (e) {}

    // 2. click イベントを正確に1回だけ発行（4重クリック・4重ノートブック作成を完全防止）
    if (typeof target.click === 'function') {
      try {
        target.click();
      } catch (e) {
        try { target.dispatchEvent(new ME('click', eventInit)); } catch (err) {}
      }
    } else {
      try { target.dispatchEvent(new ME('click', eventInit)); } catch (e) {}
    }
  }

  // Studioパネル本体（section.studio-panel または studio-panel）を取得
  function getStudioPanel() {
    return document.querySelector('section.studio-panel, studio-panel, .studio-panel') || document.body;
  }

  // Studioパネル内で音声生成中か判定（使用量メーターや他パネルのスピナーによる誤検知を防止）
  function isStudioGenerating() {
    const studio = getStudioPanel();
    const spinners = Array.from(studio.querySelectorAll('mat-progress-spinner, mat-spinner, [role="progressbar"], .loading-spinner')).filter(el => {
      if (!isVisible(el)) return false;
      // 「AI の使用状況」の使用量メーター（role="progressbar"）は除外
      if (el.classList.contains('meter-bar') || (el.getAttribute('aria-label') || '').includes('使用量')) return false;
      return true;
    });
    if (spinners.length > 0) return true;

    const textEl = Array.from(studio.querySelectorAll('div, span, p')).find(el => {
      if (!isVisible(el)) return false;
      const t = (el.innerText || el.textContent || '').trim();
      return /生成中|Generating|作成中/i.test(t) && t.length < 50;
    });
    if (textEl) return true;

    return false;
  }

  // 再生ボタンの存在を探索（NotebookLMのStudioパネル/プレイヤー）
  function findPlayButton() {
    const studio = getStudioPanel();
    // 優先1: Studioパネル内の再生ボタン（[BTN #4] <button aria-label="再生"> 等）
    const studioBtns = Array.from(studio.querySelectorAll('button, div[role="button"]'));
    for (const b of studioBtns) {
      if (!isVisible(b)) continue;
      const aria = (b.getAttribute('aria-label') || '').trim();
      const text = (b.innerText || b.textContent || '').trim();
      const parent = b.parentElement;
      const fontIcon = parent?.getAttribute('fonticonname') || '';

      if (aria === '再生' || fontIcon === 'play_arrow' || text === 'play_arrow') {
        return b;
      }
    }

    // 優先2: ドキュメント全体の再生ボタン（外部連携等は厳格除外）
    const allBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
    for (const b of allBtns) {
      if (!isVisible(b)) continue;
      const aria = (b.getAttribute('aria-label') || '').trim();
      const text = (b.innerText || b.textContent || '').trim();
      const icon = b.querySelector('mat-icon, i, svg');
      const iconName = (icon?.getAttribute('data-mat-icon-name') || icon?.textContent || '').trim();

      if (
        aria.includes('Google') || aria.includes('ノートブック') || aria.includes('ソース') ||
        aria.includes('Play ブックス') || text.includes('Play ブックス') ||
        aria.includes('共有') || aria.includes('設定')
      ) {
        continue;
      }

      if (
        aria === '再生' || aria === '一時停止' || aria === 'Play' || aria === 'Pause' ||
        aria.startsWith('再生 ') || aria.startsWith('Play ') ||
        text === 'play_arrow' || iconName === 'play_arrow' ||
        text === 'pause' || iconName === 'pause' ||
        b.getAttribute('data-mat-icon-name') === 'play_arrow'
      ) {
        return b;
      }
    }
    return document.querySelector('button[aria-label="再生"], button[aria-label="Play"]');
  }

  // 「新しいノートブック」作成ボタンを包括的に探索
  function findCreateNotebookButton() {
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], a, mat-card, [role="link"], div[tabindex="0"]'));
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = (el.innerText || el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      const combined = text + ' ' + aria;

      // 「新しいノートブック」「ノートブックを作成」「New notebook」「Create notebook」など
      if (/新しいノートブック|新規ノートブック|新規作成|ノートブックを新規作成|新しいノート|New notebook|Create notebook|Create new/i.test(combined)) {
        return el;
      }
    }

    // 「+」や「add」アイコンを持つ作成用カード/ボタン
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const icons = el.querySelectorAll('mat-icon, i, svg, span');
      for (const icon of icons) {
        const iconName = icon.getAttribute('data-mat-icon-name') || icon.textContent || '';
        if (/add|plus|\+/i.test(iconName)) {
          return el;
        }
      }
    }

    return null;
  }

  // Angular / React / Web Components 対応の入力セッター
  function robustSetInputValue(inputEl, value) {
    if (!inputEl) return;
    try { inputEl.focus(); } catch (e) {}

    const unwrapped = inputEl.wrappedJSObject || inputEl;

    // 1. プロパティ直接代入（基本設定）
    try { inputEl.value = value; } catch (e) {}
    if (unwrapped !== inputEl) {
      try { unwrapped.value = value; } catch (e) {}
    }

    // 2. 原型（prototype）の native setter（Angular/Reactの変更検知トリガー用）
    try {
      const proto = inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(inputEl, value);
      }
    } catch (e) {}

    try {
      const pageProto = inputEl.tagName === 'TEXTAREA'
        ? window.wrappedJSObject?.HTMLTextAreaElement?.prototype
        : window.wrappedJSObject?.HTMLInputElement?.prototype;
      const pageSetter = pageProto ? Object.getOwnPropertyDescriptor(pageProto, 'value')?.set : null;
      if (pageSetter && unwrapped) {
        pageSetter.call(unwrapped, value);
      }
    } catch (e) {}

    // 3. 値が確実に反映されたか再確認
    if (inputEl.value !== value) {
      try { inputEl.value = value; } catch (e) {}
    }

    const eventInit = { bubbles: true, composed: true };
    const targets = [inputEl];
    if (unwrapped !== inputEl) targets.push(unwrapped);

    for (const t of targets) {
      try { t.dispatchEvent(new Event('input', eventInit)); } catch (e) {}
      try { t.dispatchEvent(new Event('change', eventInit)); } catch (e) {}
      try { t.dispatchEvent(new KeyboardEvent('keydown', eventInit)); } catch (e) {}
      try { t.dispatchEvent(new KeyboardEvent('keyup', eventInit)); } catch (e) {}
      try { t.dispatchEvent(new Event('blur', eventInit)); } catch (e) {}
    }

    if (inputEl.isContentEditable) {
      inputEl.innerText = value;
      try { inputEl.dispatchEvent(new Event('input', eventInit)); } catch (e) {}
    }
  }

  // --- メインパイプライン ---

  async function runPipeline(params) {
    const { url: targetUrl, prompt: customPrompt } = params;
    capturedDownloadUrl = null;

    reportProgress('initializing', 'NotebookLMの状態を確認中...');
    await sleep(2000);

    // 1. Googleログイン状態チェック
    if (
      window.location.hostname.includes('accounts.google.com') ||
      document.body.innerText.includes('Sign in to continue') ||
      document.body.innerText.includes('ログインして続行') ||
      document.querySelector('a[href*="accounts.google.com/signin"]')
    ) {
      throw new Error('Googleアカウントへのログインが必要です。NotebookLMにログインしてから再試行してください。');
    }

    // 2. 新規ノートブックの作成（または既存ノートの検出）
    if (!window.location.pathname.includes('/notebook/')) {
      reportProgress('creating_notebook', '新規ノートブックを作成中...');

      let created = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 30000 && !created) {
        // 画面上に「作成できませんでした」等のエラーが表示されている場合は検知
        const errorEl = findElementByText('.error, [role="alert"], div, span', /ノートブックを作成できませんでした|エラーが発生/i);
        if (errorEl && isVisible(errorEl)) {
          throw new Error(`NotebookLMエラー: ${errorEl.textContent.trim()}`);
        }

        const createBtn = findCreateNotebookButton() ||
          findElementByAria(/Create new notebook|新しいノートブック|新しいノートブックを作成|新規ノート/i) ||
          findElementByText('button, div[role="button"], span, a', /新しいノートブック|Create notebook|Create new/i);

        if (createBtn) {
          const isDisabled = createBtn.disabled ||
            createBtn.getAttribute('aria-disabled') === 'true' ||
            createBtn.getAttribute('disabled') === 'true' ||
            createBtn.classList.contains('mat-mdc-button-disabled');

          if (isDisabled) {
            console.log('[NLM Automator] Create notebook button is disabled. Waiting for button to become active...');
            await sleep(1000);
            continue;
          }

          console.log('[NLM Automator] Found active create notebook button, clicking:', createBtn);
          triggerClick(createBtn);

          // URLの変化（/notebook/）を待つ（Googleサーバーでのノート作成リクエストを待機）
          for (let i = 0; i < 20; i++) {
            await sleep(500);
            if (window.location.pathname.includes('/notebook/')) {
              created = true;
              break;
            }
          }
          if (created) break;
        }

        await sleep(1500);
      }

      if (!window.location.pathname.includes('/notebook/')) {
        throw new Error('「新しいノートブック」ボタンをクリックしましたが、ノートブック画面への遷移が検知できませんでした。画面をご確認ください。');
      }

      reportProgress('waiting_notebook_load', 'ノートブックの読み込み完了を待機中...');
      await sleep(4000);
    }

    let isCompleted = false;
    let detectedPlayBtn = null;

    // 既存の生成済み音声解説が存在するか確認（8分間の再生成を回避し即時ダウンロードへ）
    const existingPlayBtn = findPlayButton();
    const studioEl = getStudioPanel();
    if (existingPlayBtn && studioEl && !isStudioGenerating()) {
      console.log('[NLM Automator] Existing completed audio overview detected in Studio panel! Skipping generation and proceeding to download.');
      reportProgress('downloading', '生成済みの音声解説を検出しました。ダウンロードを準備中...');
      detectedPlayBtn = existingPlayBtn;
      isCompleted = true;
      const titleEl = document.querySelector('.artifact-title');
      if (titleEl && !taskTitle) {
        taskTitle = titleEl.textContent.trim();
      }
    }

    if (!isCompleted) {
      // 3. ソース追加モーダルの処理
    reportProgress('adding_source', 'Webソース追加 (1/4): ソース選択画面を確認中...');

    // URL入力欄（textarea / input）を検索する関数（検索窓 discoverSourcesQuery は厳格に排除）
    function findActiveUrlInput() {
      // 1. formcontrolname="urls" (NotebookLMの正式なURL入力用 textarea)
      const exactUrls = document.querySelector('textarea[formcontrolname="urls"], [formcontrolname="urls"]');
      if (exactUrls && isVisible(exactUrls)) return exactUrls;

      // 2. placeholder / aria-label による探索
      const specific = document.querySelector('textarea[placeholder*="リンクを貼り付ける"], textarea[aria-label*="URL"], [formcontrolname="newUrl"], [formcontrolname="url"], input[type="url"]');
      if (specific && isVisible(specific)) {
        const fc = (specific.getAttribute('formcontrolname') || '').toLowerCase();
        if (!fc.includes('discove') && !fc.includes('query')) return specific;
      }

      return null;
    }

    // 「ウェブサイト / リンク」カード・ボタンを検索する関数
    function findWebsiteSourceButton() {
      const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .dialog-container, .add-source-dialog');
      const root = dialog || document.body;

      const candidates = Array.from(root.querySelectorAll('.source-action-button, button, div[role="button"]'));

      // 優先1: テキスト「ウェブサイト」
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const combined = text + ' ' + aria;

        if (combined.length > 35) continue;
        if (/ウェブサイト|Website/i.test(combined)) {
          return el;
        }
      }

      // 優先2: アイコン link_2 または video_youtube を持つボタン
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const icons = Array.from(el.querySelectorAll('mat-icon, i, svg'));
        if (icons.some(i => (i.textContent || '').includes('link_2') || (i.textContent || '').includes('video_youtube'))) {
          return el;
        }
      }

      return null;
    }

    // 「挿入 / 追加」ボタンを検索する関数（ダイアログ内部に限定）
    function findSubmitInsertButton() {
      const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .dialog-container, .add-source-dialog');
      if (!dialog) return null;

      const buttons = Array.from(dialog.querySelectorAll('button'));
      for (const btn of buttons) {
        if (!isVisible(btn)) continue;
        const text = (btn.innerText || btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').trim();

        if (/^(挿入|追加|Insert|Add|リンクを挿入)$/i.test(text) || (/挿入|Insert/i.test(aria) && !aria.includes('閉じる'))) {
          return btn;
        }
      }
      return dialog.querySelector('button[type="submit"]');
    }

    // 「ソースを追加」トリガーボタンを検索する関数（ダイアログ未表示時に開くため）
    function findAddSourceTriggerButton() {
      const candidates = Array.from(document.querySelectorAll('button, div[role="button"], a'));
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const combined = text + ' ' + aria;

        if (/ソースを追加|ソースの追加|Add sources?|Add source/i.test(combined)) {
          return el;
        }
      }

      // + アイコンを持つソース関連ボタン
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const icon = el.querySelector('mat-icon, i, svg');
        if (icon) {
          const name = icon.getAttribute('data-mat-icon-name') || icon.textContent || '';
          if (/add|plus|\+/i.test(name)) {
            const combined = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
            if (combined.includes('ソース') || combined.includes('source') || combined.trim() === '+' || combined.trim() === 'add') {
              return el;
            }
          }
        }
      }
      return null;
    }

    // サブステップ 1: ソース追加画面の準備（ダイアログが開いていなければ「ソースを追加」をクリック）
    reportProgress('adding_source', 'Webソース追加 (1/4): ソース選択画面を確認中...');

    function isSourceDialogOpen() {
      const d = document.querySelector('mat-dialog-container, [role="dialog"], .dialog-container, .add-source-dialog');
      return d && isVisible(d);
    }

    let urlInput = findActiveUrlInput();

    // ダイアログもURL入力欄も開いていなければ、「ソースを追加」ボタンをクリックして開く
    if (!urlInput && !isSourceDialogOpen()) {
      console.log('[NLM Automator] Source dialog not open. Searching for Add source button...');
      reportProgress('adding_source', 'Webソース追加 (1/4): 「ソースを追加」ボタンをクリック中...');
      const addSourceBtn = await waitFor(() => findAddSourceTriggerButton(), 15000);
      console.log('[NLM Automator] Found Add source button, clicking:', addSourceBtn);
      triggerClick(addSourceBtn);
      // ダイアログが開くのを少し待つ
      await waitFor(() => isSourceDialogOpen() || findWebsiteSourceButton(), 10000).catch(() => null);
      await sleep(1500);
    }

    // サブステップ 2: 「ウェブサイト」ボタンをクリックして URL 入力欄を開く
    urlInput = findActiveUrlInput();
    if (!urlInput) {
      reportProgress('adding_source', 'Webソース追加 (2/4): 「ウェブサイト」ボタンをクリック中...');
      const websiteBtn = await waitFor(() => findWebsiteSourceButton(), 15000);
      console.log('[NLM Automator] Found website button, clicking:', websiteBtn);
      triggerClick(websiteBtn);
      await sleep(2000);
    }

    // サブステップ 3: URL入力フィールドへの入力
    reportProgress('adding_source', 'Webソース追加 (3/4): URLを入力中...');
    urlInput = await waitFor(() => findActiveUrlInput(), 20000);

    if (!urlInput) {
      throw new Error('URL入力欄（リンクを貼り付ける）が見つかりませんでした。');
    }

    console.log('[NLM Automator] Setting URL in input field:', targetUrl, 'tag:', urlInput.tagName, 'formControl:', urlInput.getAttribute('formcontrolname'));
    robustSetInputValue(urlInput, targetUrl);
    await sleep(1500);

    // サブステップ 4: 「挿入」ボタンのクリック
    reportProgress('adding_source', 'Webソース追加 (4/4): 「挿入」ボタンをクリック中...');
    const insertBtn = await waitFor(() => findSubmitInsertButton(), 15000);

    if (!insertBtn) {
      throw new Error('「挿入」ボタンが見つかりませんでした。');
    }

    let waitInsertEnabled = 0;
    while (insertBtn.disabled && waitInsertEnabled < 15) {
      await sleep(500);
      waitInsertEnabled++;
    }

    console.log('[NLM Automator] Clicking Insert button:', insertBtn, 'text:', (insertBtn.innerText || insertBtn.textContent || '').trim());
    triggerClick(insertBtn);
    reportProgress('processing_source', 'ソースを取り込み・解析中 (これには最大60秒かかることがあります)...');

    // ソースの解析が完了し、ダイアログが完全に閉じるまで待機（最大90秒）
    await waitFor(() => {
      const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .dialog-container, .add-source-dialog');
      return !dialog || !isVisible(dialog);
    }, 90000);

    await sleep(3000);

    // 4. 音声解説（Studio）プロンプトの設定と生成開始
    reportProgress('setting_prompt', 'Studioで日本語音声解説の準備中...');

    // もし予期せずノートブック名編集ダイアログや他の不要なダイアログが開いていたら閉じる
    function dismissUnwantedDialogs() {
      const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, [role="dialog"]'));
      for (const d of dialogs) {
        if (!isVisible(d)) continue;
        const text = (d.innerText || d.textContent || '').trim();
        if (/ノートブックの名前|名前を変更|Rename notebook/i.test(text)) {
          console.log('[NLM Automator] Dismissing unwanted dialog:', text.substring(0, 40));
          const closeBtn = d.querySelector('button[aria-label*="閉じる" i], button[aria-label*="Close" i], button:has(mat-icon[data-mat-icon-name="close"])');
          if (closeBtn) {
            triggerClick(closeBtn);
          } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          }
        }
      }
    }

    dismissUnwantedDialogs();
    await sleep(1000);

    // Studioパネル内の「音声解説」カード/ボタンを探索
    function findAudioOverviewStudioItem() {
      const studio = getStudioPanel();
      // 1. div[role="button"][aria-label="音声解説"] (最新NotebookLMのUI)
      const exactDiv = studio.querySelector('div[role="button"][aria-label="音声解説"], button[aria-label="音声解説"]');
      if (exactDiv && isVisible(exactDiv)) return exactDiv;

      // 2. basic-create-artifact-button で 音声解説 を含む要素
      const customElements = Array.from(studio.querySelectorAll('basic-create-artifact-button'));
      for (const el of customElements) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        if (/音声解説|Audio Overview|Deep Dive/i.test(text + ' ' + aria)) {
          return el;
        }
      }

      // 3. aria-label に 音声解説 / Audio Overview が含まれる要素
      const ariaMatch = findElementByAria(/音声解説|Audio Overview|Deep Dive/i);
      if (ariaMatch && isVisible(ariaMatch)) return ariaMatch;

      // 4. テキストによる探索（Studioパネル内を優先）
      const candidates = Array.from(studio.querySelectorAll('div[role="button"], button, mat-card, .mat-mdc-card'));
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim();
        if (/音声解説|Audio Overview|Deep Dive/i.test(text) && text.length < 30) {
          return el;
        }
      }
      return null;
    }

    // 「カスタマイズ」ボタンを探索（ヘッダー等は厳格に除外し、Studio内を探索）
    function findCustomizeButton() {
      const studio = getStudioPanel();
      const candidates = Array.from(studio.querySelectorAll('button, div[role="button"], a'));
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        // ヘッダーやナビゲーションバーの要素（ノートブックタイトルの編集ボタン等）は絶対に除外
        if (btn.closest('header, nav, toolbar, .top-bar')) continue;
        // Studioパネル開閉ボタンは除外
        if (btn.classList.contains('toggle-studio-panel-button') || /Studio のパネルを閉じる/i.test(btn.getAttribute('aria-label') || '')) continue;

        const text = (btn.innerText || btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').trim();
        const combined = text + ' ' + aria;

        if (/ノートブック|名前|タイトル|共有|設定/i.test(combined)) continue;

        if (/カスタマイズ|Customize|編集|Edit/i.test(combined)) {
          return btn;
        }
      }
      return null;
    }

    // カスタマイズプロンプト入力欄を探索（ダイアログまたはStudioパネル内）
    // カスタマイズプロンプト入力欄を探索（必ずダイアログ内部のみから探索！）
    function findPromptInput() {
      // 1. まず「音声解説をカスタマイズ」ダイアログ（configurable-form-dialog）本体を特定
      // バックグラウンドタブでもCSSアニメーションや描画遅延（opacity: 0）で弾かれないよう、DOMツリー上の実体を直接特定
      const dialog = document.querySelector('configurable-form-dialog') ||
                     document.querySelector('.dialog-title:has(.dialog-title-text)')?.closest('mat-dialog-container, [role="dialog"]') ||
                     document.querySelector('mat-dialog-container');
      if (!dialog) return null;

      // 2. ダイアログ内部からプロンプト入力用 textarea を探索（検索窓やURL入力欄は厳格除外）
      const textareas = Array.from(dialog.querySelectorAll('textarea'));
      for (const ta of textareas) {
        const fcn = (ta.getAttribute('formcontrolname') || '').toLowerCase();
        if (fcn === 'discoversourcesquery' || fcn === 'urls') continue;
        return ta;
      }

      // 3. ドキュメント全体の configurable-form-dialog 内 textarea
      const direct = document.querySelector('configurable-form-dialog textarea');
      if (direct) {
        const fcn = (direct.getAttribute('formcontrolname') || '').toLowerCase();
        if (fcn !== 'discoversourcesquery' && fcn !== 'urls') return direct;
      }

      return null;
    }

    // ダイアログ内の「生成」ボタンを探索（必ずダイアログ内部のみから探索。「後で生成」は絶対に除外）
    function findDialogGenerateButton() {
      // 1. まずダイアログ本体を特定
      const dialog = document.querySelector('configurable-form-dialog') ||
                     document.querySelector('mat-dialog-container');
      if (!dialog) return null;

      // 2. .action-button-wrapper 内のボタン（NotebookLMの主アクションボタン）
      const actionWrapperBtn = dialog.querySelector('.action-button-wrapper button, mat-dialog-actions .action-button-wrapper button');
      if (actionWrapperBtn && !/後で/i.test(actionWrapperBtn.textContent || '')) {
        return actionWrapperBtn;
      }

      // 3. ダイアログ内から「生成」完全一致ボタンを探索（「後で生成」は厳格除外）
      const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
      for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if (/後で/i.test(text)) continue;
        if (/^(生成|Generate)$/i.test(text) || /^(\s*生成\s*)$/.test(text)) {
          return btn;
        }
      }

      for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').trim();
        if (/後で/i.test(text) || /後で/i.test(aria)) continue;
        if (/生成|Generate/i.test(text) || /生成|Generate/i.test(aria)) {
          return btn;
        }
      }

      return null;
    }

    // 「生成 / 作成」ボタンを探索
    function findGenerateButton() {
      const studio = getStudioPanel();
      const candidates = Array.from(studio.querySelectorAll('button, div[role="button"]'));
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        if (btn.closest('header, nav, toolbar, .top-bar')) continue;
        if (btn.classList.contains('toggle-studio-panel-button')) continue;

        // 初期タイル（basic-create-artifact-button）自体は生成ボタンと誤認しないように除外
        if (btn.closest('basic-create-artifact-button') && !btn.innerText.includes('生成')) continue;

        const text = (btn.innerText || btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').trim();
        const combined = text + ' ' + aria;

        // ノートブック新規作成やソース追加等は除外
        if (/ノートブック|ソース|ファイル|ウェブサイト|メモ|名前|タイトル/i.test(combined)) continue;

        if (/音声解説を生成|生成|Generate audio|Generate|会話を開始/i.test(combined)) {
          return btn;
        }
      }
      return null;
    }

    // 要素（またはその親コンポーネント）が無効／グレーアウト状態か判定
    function isButtonDisabled(el) {
      if (!el) return true;

      // 1. 属性チェック
      if (el.hasAttribute('disabled')) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if (el.getAttribute('data-disabled') === 'true') return true;
      if (el.getAttribute('tabindex') === '-1') return true;

      // 2. クラス名チェック（自身および親コンポーネント）
      const classStr = ((el.className || '') + ' ' + (el.getAttribute('class') || '')).toLowerCase();
      if (classStr.includes('disabled') || classStr.includes('inactive') || classStr.includes('loading') || classStr.includes('mat-mdc-button-disabled')) {
        return true;
      }

      const host = el.closest('basic-create-artifact-button');
      if (host) {
        if (host.hasAttribute('disabled') || host.getAttribute('aria-disabled') === 'true' || host.getAttribute('data-disabled') === 'true') {
          return true;
        }
        const hostClass = ((host.className || '') + ' ' + (host.getAttribute('class') || '')).toLowerCase();
        if (hostClass.includes('disabled') || hostClass.includes('inactive') || hostClass.includes('loading')) {
          return true;
        }
      }

      // 3. スタイルチェック（透明度やポインターイベント）
      try {
        const style = window.getComputedStyle(el);
        if (style.pointerEvents === 'none') return true;
        if (style.cursor === 'not-allowed') return true;
        const opacity = parseFloat(style.opacity);
        if (!isNaN(opacity) && opacity < 0.65) return true;
      } catch (e) {}

      return false;
    }

    const studio = getStudioPanel();
    console.log('[NLM Automator] Studio panel element:', studio, 'data-panel-state:', studio.getAttribute('data-panel-state'));

    // ソースのインデックス完了とStudio音声解説ボタンの有効化（グレーアウト解除）を待機
    reportProgress('setting_prompt', 'ソースの解析完了とStudioの有効化を待機中...');

    const WAIT_STUDIO_READY_SECONDS = 90;
    const checkIntervalMs = 2000;
    const maxAttempts = Math.floor((WAIT_STUDIO_READY_SECONDS * 1000) / checkIntervalMs);

    let audioCard = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      audioCard = findAudioOverviewStudioItem();

      if (audioCard) {
        const disabled = isButtonDisabled(audioCard);
        if (disabled) {
          console.log(`[NLM Automator] Attempt ${attempt}/${maxAttempts}: Audio overview button is grayed out / disabled. Waiting for indexing...`);
          reportProgress('setting_prompt', `ソースのインデックス完了を待機中... (${attempt * 2}秒)`);
        } else {
          console.log(`[NLM Automator] Attempt ${attempt}/${maxAttempts}: Audio overview button is active!`);
          break;
        }
      } else {
        console.log(`[NLM Automator] Attempt ${attempt}/${maxAttempts}: Waiting for audio overview button in Studio...`);
        reportProgress('setting_prompt', `Studioの表示を待機中... (${attempt * 2}秒)`);
      }

      await sleep(checkIntervalMs);
    }

    if (!audioCard || isButtonDisabled(audioCard)) {
      throw new Error('Studioパネルの「音声解説」ボタンが有効化されませんでした（ソースのインデックス待機がタイムアウトしました）。');
    }

    // 4-1. 音声解説のカスタマイズ/オプションを開くトリガーを特定
    function findOptionTrigger() {
      // ホバーイベントを発火してカードのUI状態を更新
      try {
        audioCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        audioCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      } catch (e) {}

      // 1. .option-icon または mat-icon.edit-icon（右側のchevron矢印アイコン）
      // ※ hover前はCSSで opacity: 0 や visibility: hidden の場合があるため、要素が存在すれば採用する
      const direct = audioCard.querySelector('.option-icon mat-icon, mat-icon.edit-icon, .option-icon') ||
                     audioCard.closest('basic-create-artifact-button')?.querySelector('.option-icon mat-icon, mat-icon.edit-icon, .option-icon');
      if (direct) return direct;

      // 2. chevron_forward アイコンをテキストから特定
      const icons = Array.from(audioCard.querySelectorAll('mat-icon'));
      const chevron = icons.find(ic => (ic.textContent || '').includes('chevron_forward') || (ic.className || '').includes('option-icon'));
      if (chevron) return chevron;

      // 3. Studio内のカスタマイズボタン
      return findCustomizeButton();
    }

    const triggerEl = findOptionTrigger();
    if (!triggerEl) {
      console.error('[NLM Automator Debug] Audio card HTML:', audioCard.outerHTML);
      throw new Error('Studioパネルに「音声解説」のカスタマイズ/オプションアイコン（.option-icon）が見つかりませんでした。');
    }

    console.log('[NLM Automator] Clicking Audio Overview customize trigger:', triggerEl);
    triggerClick(triggerEl, true);

    // 4-2. ダイアログが開いてプロンプト入力欄（textarea）が出現するのを待機（バックグラウンドタブを考慮し最大25秒）
    reportProgress('setting_prompt', 'カスタマイズダイアログの表示を待機中...');
    const promptInput = await waitFor(() => findPromptInput(), 25000).catch(() => null);

    if (!promptInput) {
      const visibleDlgs = Array.from(document.querySelectorAll('configurable-form-dialog, [role="dialog"], mat-dialog-container')).filter(isVisible);
      console.error(`[NLM Automator Debug] Visible dialogs count: ${visibleDlgs.length}`);
      visibleDlgs.forEach((d, i) => console.error(`  [DLG #${i}]`, d.innerHTML.substring(0, 300)));
      throw new Error('音声解説カスタマイズダイアログが開かないか、プロンプト入力欄（textarea）が見つかりませんでした。DOM構造が想定と異なっています。');
    }

    console.log('[NLM Automator] Found prompt textarea:', promptInput, 'id:', promptInput.id, 'class:', promptInput.className);

    // 4-3. プロンプト入力欄にカスタム指示を設定
    console.log('[NLM Automator] Setting custom prompt in textarea:', customPrompt.substring(0, 50) + '...');
    reportProgress('setting_prompt', '日本語カスタムプロンプトを設定中...');
    robustSetInputValue(promptInput, customPrompt);
    await sleep(800);

    console.log('[NLM Automator] Textarea value after setting:', promptInput.value?.substring(0, 50));

    // 値が正しく反映されたか検証（空なら即座にエラー停止）
    if (!promptInput.value || promptInput.value.trim().length === 0) {
      throw new Error('プロンプト入力欄にテキストを設定できませんでした（入力欄のvalueが空のままです）。');
    }

    // 4-4. ダイアログ内の「生成」ボタン（「後で生成」は厳格除外）を取得
    const submitBtn = await waitFor(() => findDialogGenerateButton(), 10000).catch(() => null);
    if (!submitBtn) {
      const dlg = document.querySelector('configurable-form-dialog, [role="dialog"], mat-dialog-container') || document.body;
      const dlgBtns = Array.from(dlg.querySelectorAll('button, div[role="button"]')).filter(isVisible);
      console.error(`[NLM Automator Debug] Dialog buttons (${dlgBtns.length}):`);
      dlgBtns.forEach((b, i) => {
        console.error(`  [BTN #${i}] text="${(b.innerText || '').trim()}" aria="${b.getAttribute('aria-label') || ''}"`);
      });
      throw new Error('カスタマイズダイアログ内の「生成」ボタンが見つかりませんでした。');
    }

    // ボタンが有効（disabledでない）か確認・待機
    let waitBtnSec = 0;
    const isSubmitDisabled = (b) => {
      if (!b) return true;
      if (b.disabled || b.hasAttribute('disabled')) return true;
      if (b.getAttribute('aria-disabled') === 'true') return true;
      if (b.classList.contains('mat-mdc-button-disabled')) return true;
      const hostBtn = b.closest('nb-button');
      if (hostBtn && (hostBtn.getAttribute('aria-disabled') === 'true' || hostBtn.classList.contains('disabled'))) return true;
      return false;
    };

    while (isSubmitDisabled(submitBtn) && waitBtnSec < 8) {
      await sleep(1000);
      waitBtnSec++;
    }
    if (isSubmitDisabled(submitBtn)) {
      throw new Error('カスタマイズダイアログの「生成」ボタンが無効化（disabled）されたままでクリックできません。');
    }

    // クリック対象のダイアログ要素への参照を保持（閉じる監視用）
    const activeDialog = document.querySelector('configurable-form-dialog, mat-dialog-container, [role="dialog"].mat-mdc-dialog-container');

    console.log('[NLM Automator] Clicking dialog Generate button:', submitBtn, 'text:', (submitBtn.innerText || '').trim());
    triggerClick(submitBtn);

    // 4-5. 状態遷移の検証（Fail-Fast）：
    // 正常であればダイアログは自動的に閉じるか、音声生成が開始される。
    // バックグラウンドタブでもアニメーション終了待ちで止まらないよう、isStudioGenerating() も完了条件に含める。
    reportProgress('setting_prompt', '音声解説の生成開始を確認中...');
    const dialogClosed = await waitFor(() => {
      if (isStudioGenerating()) return true; // 音声生成が開始されたら大成功
      if (!activeDialog) return true;
      if (!document.body.contains(activeDialog)) return true;
      const style = window.getComputedStyle(activeDialog);
      return style.display === 'none' || style.visibility === 'hidden' || !isVisible(activeDialog);
    }, 15000).catch(() => false);

    if (!dialogClosed) {
      throw new Error('「生成」ボタンをクリックしましたが、ダイアログが自動で閉じず生成が開始されませんでした。生成リクエストの送信に失敗した可能性があります。');
    }

    console.log('[NLM Automator] Customize dialog closed successfully. Audio overview generation has started!');
    reportProgress('generating_audio', '音声解説を生成中... (数分〜10分程度かかります)');

    // 5. 生成完了の監視（ポーリング）
    const MAX_WAIT_SECONDS = 1500; // 最大25分
    const POLL_INTERVAL = 8000;    // 8秒おき
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT_SECONDS * 1000) {
      await sleep(POLL_INTERVAL);

      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
      reportProgress('generating_audio', `音声解説を生成中... (${elapsedMinutes}分経過)`);

      const errorEl = findElementByText('.error, [role="alert"], div', /生成できませんでした|Generation failed|エラーが発生|Something went wrong/i);
      if (errorEl && isVisible(errorEl)) {
        throw new Error(`NotebookLMで生成エラーが発生しました: ${errorEl.textContent.trim()}`);
      }

      const playBtn = findPlayButton();
      const isGenerating = isStudioGenerating();

      if (playBtn && !isGenerating) {
        console.log('[NLM Automator] Play button detected and studio not generating. Audio generation complete!', playBtn);
        detectedPlayBtn = playBtn;
        isCompleted = true;
        break;
      }
    }

    if (!isCompleted) {
      throw new Error('音声解説の生成がタイムアウトしました（25分経過）。');
    }
  } // end of if (!isCompleted) - 生成ステップ完了

    reportProgress('downloading', '音声ファイルのダウンロードを準備中...');
    dismissUnwantedDialogs();
    await sleep(1000);

    // 6. ダウンロードの実行
    const downloadResult = await executeDownload(detectedPlayBtn || findPlayButton());

    if (!downloadResult || !downloadResult.success) {
      console.warn('[NLM Automator] Failed to trigger download automatically.');
      const currentButtons = Array.from(document.querySelectorAll('button, div[role="button"], a')).filter(isVisible);
      console.log(`[NLM Automator Debug] Currently visible buttons (${currentButtons.length}):`);
      currentButtons.forEach((b, i) => {
        console.log(`  [BTN #${i}] <${b.tagName}> aria="${b.getAttribute('aria-label') || ''}" text="${(b.innerText || '').trim().substring(0, 40)}"`);
      });
      throw new Error('音声解説の生成は完了しましたが、「ダウンロード」メニュー項目が見つかりませんでした。画面右側のStudioパネルの音声プレイヤーにあるメニューをご確認ください。');
    }

    // 7. 実体URLまたはUIダウンロード結果をバックグラウンドへ伝達
    if (downloadResult.url) {
      console.log('[NLM Automator] Handing captured audio URL to background:', downloadResult.url);
      reportComplete(downloadResult.url, false);
      return;
    }

    console.log('[NLM Automator] Download menu clicked. Delegating browser download monitoring to background.');
    reportComplete(null, true);
  }

  // --- ダウンロード専用関数群（多重フォールバック & 単体実行対応） ---

  async function executeDownload(targetPlayBtn = null) {
    const playBtn = targetPlayBtn || findPlayButton();
    let bestUrl = capturedDownloadUrl || findAudioUrlInResources() || findAudioUrlInDOM();
    if (bestUrl) {
      console.log('[NLM Automator] Found audio URL directly before menu interaction:', bestUrl);
      return { success: true, url: bestUrl };
    }

    // 6-1. 直接のダウンロードボタン/リンクを探索
    const directDlBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(el => {
      if (!isVisible(el)) return false;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const icon = el.querySelector('mat-icon, i, svg');
      const iconName = (icon?.getAttribute('data-mat-icon-name') || icon?.textContent || '').toLowerCase();

      if (aria.includes('ノートブック') || aria.includes('共有') || aria.includes('アカウント') || aria.includes('設定') || aria.includes('side_nav')) return false;

      return (
        aria.includes('ダウンロード') || aria.includes('download') ||
        text === 'ダウンロード' || text === 'download' ||
        iconName.includes('download')
      );
    });

    if (directDlBtn) {
      console.log('[NLM Automator] Found direct download button, clicking:', directDlBtn);
      triggerClick(directDlBtn);
      await sleep(2500);
      bestUrl = capturedDownloadUrl || findAudioUrlInResources() || findAudioUrlInDOM();
      return { success: true, url: bestUrl, directTriggered: !bestUrl };
    }

    // 6-2. 再生ボタン周辺またはStudio内のオプションメニューボタン（more_vert / その他）を探索
    let candidateButtons = [];

    function findAudioPlayerMenuButton() {
      const studio = getStudioPanel();
      // 1. Studioパネル内の「その他」または more_vert ボタン（[BTN #5] 等）
      const studioBtns = Array.from(studio.querySelectorAll('button, div[role="button"]')).filter(isVisible);
      for (const b of studioBtns) {
        if (b === playBtn) continue;
        if (b.classList.contains('toggle-studio-panel-button')) continue;
        const aria = (b.getAttribute('aria-label') || '').trim();
        const text = (b.innerText || b.textContent || '').trim();
        const parent = b.parentElement;
        const fontIcon = parent?.getAttribute('fonticonname') || '';

        if (aria === 'その他' || aria.toLowerCase() === 'more' || aria.includes('その他') || aria.includes('オプション')) {
          return b;
        }
        if (fontIcon === 'more_vert' || text.includes('more_vert') || text.includes('more_horiz')) {
          return b;
        }
      }

      // 2. 再生ボタンの近くにあるメニューボタン
      if (playBtn) {
        const parent = playBtn.parentElement;
        if (parent) {
          const siblingBtns = Array.from(parent.querySelectorAll('button, div[role="button"]')).filter(b => b !== playBtn && isVisible(b));
          if (siblingBtns.length > 0) return siblingBtns[0];
        }
        const grandParent = parent?.parentElement;
        if (grandParent) {
          const nearby = Array.from(grandParent.querySelectorAll('button, div[role="button"]')).filter(b => b !== playBtn && isVisible(b));
          const menuBtn = nearby.find(b => {
            const a = (b.getAttribute('aria-label') || '').toLowerCase();
            const t = (b.innerText || '').toLowerCase();
            return a.includes('その他') || a.includes('more') || t.includes('more_vert');
          });
          if (menuBtn) return menuBtn;
        }
      }
      return null;
    }

    const primaryMenuBtn = findAudioPlayerMenuButton();
    if (primaryMenuBtn) {
      candidateButtons.push(primaryMenuBtn);
    }

    if (playBtn) {
      const audioContainer = playBtn.closest('artifact-library-item, mat-card, .mat-mdc-card, [role="region"], div:has(button)') || playBtn.parentElement?.parentElement;
      if (audioContainer) {
        const localBtns = Array.from(audioContainer.querySelectorAll('button, div[role="button"]')).filter(b => {
          if (!isVisible(b) || b === playBtn || candidateButtons.includes(b)) return false;
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          if (aria.includes('ノートブック') || aria.includes('共有') || aria.includes('アカウント') || aria.includes('設定') || aria.includes('side_nav')) return false;
          const text = (b.innerText || b.textContent || '').trim();
          const icon = b.querySelector('mat-icon, i, svg');
          const iconName = (icon?.getAttribute('data-mat-icon-name') || icon?.textContent || '').toLowerCase();

          return (
            text.includes('more_vert') || text.includes('more_horiz') ||
            iconName.includes('more_vert') || iconName.includes('more_horiz') ||
            b.getAttribute('aria-haspopup') === 'menu' ||
            aria.includes('その他') || aria.includes('more') || aria.includes('オプション') || aria.includes('option')
          );
        });
        candidateButtons.push(...localBtns);
      }
    }

    console.log(`[NLM Automator] Found ${candidateButtons.length} audio menu candidate buttons`);

    let menuDlClicked = false;

    for (let i = 0; i < candidateButtons.length; i++) {
      const menuBtn = candidateButtons[i];
      console.log(`[NLM Automator] Attempting menu button #${i + 1}:`, menuBtn, 'aria:', menuBtn.getAttribute('aria-label'), 'text:', menuBtn.innerText);

      // メニューが開くまで最大3回試行
      for (let clickAttempt = 1; clickAttempt <= 3; clickAttempt++) {
        triggerClick(menuBtn);
        await sleep(1000);

        // オーバーレイメニュー（.cdk-overlay-container または [role="menu"]）を探索
        const menuItems = Array.from(document.querySelectorAll(
          '.cdk-overlay-container [role="menuitem"], .cdk-overlay-container button, .mat-mdc-menu-item, [role="menu"] button, [role="menu"] a, [role="menuitem"], .cdk-overlay-pane button'
        ));
        console.log(`[NLM Automator] Attempt ${clickAttempt}: Open menu items count: ${menuItems.length}`);

        if (menuItems.length > 0) {
          const dlItem = menuItems.find(item => {
            if (!isVisible(item)) return false;
            const text = (item.innerText || item.textContent || '').trim().toLowerCase();
            const aria = (item.getAttribute('aria-label') || '').toLowerCase();
            const icon = item.querySelector('mat-icon, i, svg');
            const iconName = (icon?.getAttribute('data-mat-icon-name') || icon?.textContent || '').toLowerCase();

            return (
              text.includes('ダウンロード') || text.includes('download') ||
              aria.includes('ダウンロード') || aria.includes('download') ||
              iconName.includes('download')
            );
          });

          if (dlItem) {
            console.log('[NLM Automator] Found Download menu item! Clicking:', dlItem, 'text:', (dlItem.innerText || '').trim());
            if (dlItem.href && (dlItem.href.startsWith('http') || dlItem.href.startsWith('blob:'))) {
              return { success: true, url: dlItem.href };
            }

            triggerClick(dlItem);
            menuDlClicked = true;

            // クリック後に実体URLがフック/リソース/DOMにキャッチされるのを待機
            for (let wait = 0; wait < 4; wait++) {
              await sleep(1000);
              bestUrl = capturedDownloadUrl || findAudioUrlInResources() || findAudioUrlInDOM();
              if (bestUrl) {
                console.log('[NLM Automator] Captured audio URL after clicking menu:', bestUrl);
                return { success: true, url: bestUrl };
              }
            }

            break; // 内側ループ脱出
          }
        }
      }

      if (menuDlClicked) break;

      // ダウンロード項目がない場合は、メニューを閉じるために Escape を送信
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(600);
    }

    // 6-3. 再生ボタントリガーによる音声ストリームURL捕捉（Tier 3）
    // メニュークリックで直接URLが捕獲できなかった場合でも、再生ボタンを短時間トリガーして音声ストリームURLを確実に取り出す
    if (playBtn) {
      console.log('[NLM Automator] Triggering playback briefly to capture audio stream URL...', playBtn);
      triggerClick(playBtn);
      for (let wait = 0; wait < 6; wait++) {
        await sleep(800);
        bestUrl = capturedDownloadUrl || findAudioUrlInResources() || findAudioUrlInDOM();
        if (bestUrl) {
          console.log('[NLM Automator] Successfully captured audio stream URL via player trigger:', bestUrl);
          // 音声を即時停止
          try {
            document.querySelectorAll('audio, video').forEach(a => { a.pause(); a.currentTime = 0; });
            const pauseBtn = document.querySelector('button[aria-label="一時停止"], button[aria-label="Pause"], nb-icon-button[fonticonname="pause"] button');
            if (pauseBtn) triggerClick(pauseBtn);
          } catch (e) {}

          return { success: true, url: bestUrl };
        }
      }
    }

    // 最終確認: リソースまたはDOMからURLを再チェック
    bestUrl = capturedDownloadUrl || findAudioUrlInResources() || findAudioUrlInDOM();
    if (bestUrl) {
      return { success: true, url: bestUrl };
    }

    // メニューをクリックできた場合は、バックグラウンドのダウンロード監視に委任
    if (menuDlClicked) {
      return { success: true, url: null, directTriggered: true };
    }

    return { success: false };
  }

  // 既存のNotebookLMタブに対して直接ダウンロードのみを実行するヘルパー
  async function executeDownloadOnly() {
    reportProgress('downloading', '音声ファイルのダウンロードを準備中...');
    dismissUnwantedDialogs();
    await sleep(500);

    const playBtn = findPlayButton();
    const downloadResult = await executeDownload(playBtn);

    if (!downloadResult || !downloadResult.success) {
      throw new Error('音声解説のダウンロードメニュー項目が見つかりませんでした。Studioパネルの音声プレイヤーをご確認ください。');
    }

    const titleEl = document.querySelector('.artifact-title, h1');
    const dlTitle = titleEl?.textContent?.trim() || taskTitle || document.title || '音声解説';

    if (downloadResult.url) {
      console.log('[NLM Automator] Captured audio URL via executeDownloadOnly:', downloadResult.url);
      reportComplete(downloadResult.url, false, dlTitle);
    } else {
      console.log('[NLM Automator] Delegating direct download via executeDownloadOnly to background');
      reportComplete(null, true, dlTitle);
    }
    return downloadResult;
  }
})();
