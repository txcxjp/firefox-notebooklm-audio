/**
 * NotebookLM Audio Podcaster - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const pageTitleInput = document.getElementById('pageTitle');
  const pageUrlInput = document.getElementById('pageUrl');
  const startBtn = document.getElementById('startBtn');
  const tasksList = document.getElementById('tasksList');
  const clearTasksBtn = document.getElementById('clearTasksBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');

  // 1. 現在のアクティブタブの情報を取得して入力欄に反映
  let currentActiveTab = null;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      currentActiveTab = tabs[0];
      // http/https のWebページのみ反映
      if (currentActiveTab.url && currentActiveTab.url.startsWith('http')) {
        pageTitleInput.value = currentActiveTab.title || '';
        pageUrlInput.value = currentActiveTab.url;
      }
      // もしアクティブタブがNotebookLMのノートブック画面であれば、即時保存ボタンを表示
      if (currentActiveTab.url && currentActiveTab.url.includes('notebook.google') && currentActiveTab.url.includes('/notebook/')) {
        if (downloadCurrentBtn) {
          downloadCurrentBtn.style.display = 'flex';
          downloadCurrentBtn.style.alignItems = 'center';
          downloadCurrentBtn.style.justifyContent = 'center';
        }
      }
    }
  } catch (err) {
    console.warn('Could not query active tab:', err);
  }

  // 1-1. 現在の音声解説を直接ダウンロードするボタンの処理
  downloadCurrentBtn?.addEventListener('click', async () => {
    if (!currentActiveTab) return;
    downloadCurrentBtn.disabled = true;
    downloadCurrentBtn.querySelector('.btn-text').textContent = 'ダウンロード実行中...';

    try {
      const res = await browser.tabs.sendMessage(currentActiveTab.id, {
        action: 'EXECUTE_DOWNLOAD_ONLY',
        title: pageTitleInput.value.trim() || currentActiveTab.title || '音声解説'
      });

      if (!res || !res.success) {
        throw new Error(res?.error || 'ダウンロードに失敗しました');
      }

      downloadCurrentBtn.querySelector('.btn-text').textContent = '保存リクエスト完了！';
      setTimeout(() => {
        downloadCurrentBtn.disabled = false;
        downloadCurrentBtn.querySelector('.btn-text').textContent = '現在の音声解説を保存（検証用）';
      }, 2500);
    } catch (err) {
      alert(`エラー: ${err.message}`);
      downloadCurrentBtn.disabled = false;
      downloadCurrentBtn.querySelector('.btn-text').textContent = '現在の音声解説を保存（検証用）';
    }
  });

  // 2. タスク一覧の描画
  async function renderTasks() {
    const store = await browser.storage.local.get('tasks');
    const tasks = store.tasks || {};
    const taskIds = Object.keys(tasks).sort((a, b) => (tasks[b].createdAt || 0) - (tasks[a].createdAt || 0));

    if (taskIds.length === 0) {
      tasksList.innerHTML = '<div class="empty-state">進行中のタスクはありません</div>';
      return;
    }

    tasksList.innerHTML = '';
    taskIds.forEach(id => {
      const task = tasks[id];
      const item = document.createElement('div');
      item.className = `task-item status-${task.status || 'unknown'}`;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'task-title';
      titleDiv.title = task.title || task.url;
      titleDiv.textContent = task.title || task.url;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'task-message';
      msgDiv.textContent = task.stepMessage || task.status;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'task-actions';

      if (task.tabId) {
        const focusBtn = document.createElement('button');
        focusBtn.className = 'task-action-btn';
        focusBtn.textContent = 'NotebookLMタブを表示';
        focusBtn.addEventListener('click', () => {
          browser.runtime.sendMessage({ action: 'FOCUS_TAB', tabId: task.tabId });
        });
        actionsDiv.appendChild(focusBtn);
      }

      item.appendChild(titleDiv);
      item.appendChild(msgDiv);
      item.appendChild(actionsDiv);
      tasksList.appendChild(item);
    });
  }

  // 初回描画
  await renderTasks();

  // ストレージ変更を監視して自動更新
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.tasks) {
      renderTasks();
    }
  });

  // 3. 開始ボタンクリック
  startBtn.addEventListener('click', async () => {
    const url = pageUrlInput.value.trim();
    const title = pageTitleInput.value.trim() || url;

    if (!url || !url.startsWith('http')) {
      alert('有効なWebページのURL（http:// または https://）を入力してください。');
      return;
    }

    startBtn.disabled = true;
    startBtn.querySelector('.btn-text').textContent = '生成開始中...';

    try {
      const res = await browser.runtime.sendMessage({
        action: 'START_TASK',
        url: url,
        title: title
      });

      if (!res || !res.success) {
        throw new Error(res?.error || 'タスクの開始に失敗しました');
      }

      // 完了したらボタン復帰
      startBtn.querySelector('.btn-text').textContent = '開始しました！';
      setTimeout(() => {
        startBtn.disabled = false;
        startBtn.querySelector('.btn-text').textContent = '日本語で音声解説を作成';
      }, 1500);

      await renderTasks();
    } catch (err) {
      alert(`エラー: ${err.message}`);
      startBtn.disabled = false;
      startBtn.querySelector('.btn-text').textContent = '日本語で音声解説を作成';
    }
  });

  // 4. 設定画面を開く
  openOptionsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });

  // 5. 履歴消去
  clearTasksBtn.addEventListener('click', async () => {
    await browser.storage.local.set({ tasks: {} });
    await renderTasks();
  });
});
