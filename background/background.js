/**
 * NotebookLM Audio Podcaster - Background Script (Firefox MV3)
 */

const DEFAULT_PROMPT = `Please converse entirely in natural, engaging Japanese. 
Act as two enthusiastic experts explaining the core takeaways, context, and implications of this source material. 
Keep the discussion clear, insightful, and accessible for a Japanese-speaking listener.`;

const DEFAULT_SETTINGS = {
  prompt: DEFAULT_PROMPT,
  downloadSubdir: 'NotebookLM',
  autoCloseTab: true
};

// タブID -> 実行タスクデータのマッピング
const pendingTabTasks = new Map();
// タブID -> タスクIDのマッピング
const tabToTaskMap = new Map();

// 直近のダウンロード監視用
let lastTriggeredTask = null;

// 初期設定のセットアップ
browser.runtime.onInstalled.addListener(async () => {
  const current = await browser.storage.local.get(['settings', 'tasks']);
  if (!current.settings) {
    await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  if (!current.tasks) {
    await browser.storage.local.set({ tasks: {} });
  }
});

// タスク状態の更新ヘルパー
async function updateTask(taskId, updates) {
  if (!taskId) return null;
  const data = await browser.storage.local.get('tasks');
  const tasks = data.tasks || {};
  tasks[taskId] = { ...(tasks[taskId] || {}), ...updates, updatedAt: Date.now() };
  await browser.storage.local.set({ tasks });
  return tasks[taskId];
}

// システム通知の送信
function sendNotification(title, message, id = null) {
  try {
    browser.notifications.create(id || undefined, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-48.png'),
      title: `[NotebookLM] ${title}`,
      message: message
    });
  } catch (err) {
    console.warn('Failed to send notification:', err);
  }
}

// ファイル名サニタイズ
function sanitizeFilename(name) {
  const cleaned = (name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');
  return (cleaned || 'audio_overview').substring(0, 80).trim();
}

// メッセージハンドラ
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, taskId } = message;

  if (action === 'START_TASK') {
    console.log('[Background] Received START_TASK for URL:', message.url, 'title:', message.title);
    handleStartTask(message)
      .then(id => {
        console.log('[Background] handleStartTask completed, taskId:', id);
        sendResponse({ success: true, taskId: id });
      })
      .catch(err => {
        console.error('[Background] START_TASK error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 非同期レスポンス
  }

  // コンテンツスクリプトからの能動的なタスク要求（プル型アーキテクチャ）
  if (action === 'REQUEST_TASK') {
    const tabId = sender.tab?.id;
    console.log(`[Background] REQUEST_TASK from tabId=${tabId}, pendingTabs=`, Array.from(pendingTabTasks.keys()));

    if (tabId && pendingTabTasks.has(tabId)) {
      const taskData = pendingTabTasks.get(tabId);
      pendingTabTasks.delete(tabId); // タスク引き渡し完了

      updateTask(taskData.taskId, {
        status: 'running',
        stepMessage: 'NotebookLMに接続しました。自動操作を開始します...'
      });

      console.log(`[Background] Dispatched task to tab ${tabId}:`, taskData);
      sendResponse({ hasTask: true, task: taskData });
    } else {
      console.log(`[Background] No pending task for tab ${tabId}`);
      sendResponse({ hasTask: false });
    }
    return true;
  }

  if (action === 'TASK_PROGRESS') {
    updateTask(taskId, {
      status: message.status,
      stepMessage: message.message
    });
    return false;
  }

  if (action === 'TASK_COMPLETE') {
    handleTaskComplete(message, sender.tab?.id);
    return false;
  }

  if (action === 'TASK_FAILED') {
    handleTaskFailed(message, sender.tab?.id);
    return false;
  }

  if (action === 'FOCUS_TAB') {
    if (message.tabId) {
      browser.tabs.update(message.tabId, { active: true }).then(tab => {
        if (tab && tab.windowId) {
          browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
      }).catch(() => {});
    }
    return false;
  }

});

// 新規タスクの開始処理
async function handleStartTask(data) {
  const { url, title, customPrompt } = data;
  const taskId = `task_${Date.now()}`;
  const store = await browser.storage.local.get('settings');
  const settings = store.settings || DEFAULT_SETTINGS;

  const promptToUse = customPrompt || settings.prompt;

  // タスク初期化
  await updateTask(taskId, {
    id: taskId,
    url: url,
    title: title || url,
    prompt: promptToUse,
    status: 'starting',
    stepMessage: 'NotebookLMタブを開いています...',
    createdAt: Date.now(),
    tabId: null
  });

  await browser.storage.local.set({ activeTaskId: taskId });
  sendNotification('音声解説の生成を開始しました', `対象: ${title || url}\nバックグラウンドで処理を開始します。`);

  // NotebookLMのトップページをバックグラウンドで開く（ユーザーの作業・閲覧を妨げない）
  const newTab = await browser.tabs.create({
    url: 'https://notebook.google.com/',
    active: false
  });

  await updateTask(taskId, {
    tabId: newTab.id,
    status: 'loading_page',
    stepMessage: 'NotebookLMの読み込みを待機中...'
  });

  const taskData = {
    taskId,
    url,
    title,
    prompt: promptToUse
  };

  tabToTaskMap.set(newTab.id, taskId);
  pendingTabTasks.set(newTab.id, taskData);

  // タイムアウト監視（35秒間タスク要求が来ない場合のセーフティ）
  setTimeout(async () => {
    if (pendingTabTasks.has(newTab.id)) {
      pendingTabTasks.delete(newTab.id);
      await updateTask(taskId, {
        status: 'failed',
        stepMessage: '接続タイムアウト: NotebookLMの読み込みが完了しませんでした。'
      });
      sendNotification('接続タイムアウト', 'NotebookLMの読み込みがタイムアウトしました。');
    }
  }, 35000);

  return taskId;
}

// 生成完了時のダウンロードおよび後始末
async function handleTaskComplete(message, tabId) {
  const { taskId, audioUrl, title, directTriggered } = message;
  const store = await browser.storage.local.get('settings');
  const settings = store.settings || DEFAULT_SETTINGS;

  const safeTitle = sanitizeFilename(title);
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const subdir = (settings.downloadSubdir || 'NotebookLM').replace(/^\/+|\/+$/g, '');
  const filename = `${subdir}/${timestamp}_${safeTitle}.mp3`;

  lastTriggeredTask = { taskId, title, tabId, filename, settings };

  // パターン1: 有効な実体音声URL（Blob URL または HTTP URL）が存在する場合
  if (audioUrl && (audioUrl.startsWith('blob:') || audioUrl.startsWith('http')) && !audioUrl.includes('.google.com/notebook')) {
    try {
      console.log(`[Background] Initiating download for URL: ${audioUrl} -> ${filename}`);
      const downloadId = await browser.downloads.download({
        url: audioUrl,
        filename: filename,
        saveAs: false
      });

      await updateTask(taskId, {
        status: 'completed',
        stepMessage: '音声ファイルをダウンロードしました',
        downloadId: downloadId,
        filename: filename
      });

      sendNotification('音声解説が完成しました！', `「${title}」の音声を保存しました。\n(${filename})`);
      cleanupTab(tabId, settings.autoCloseTab);
      return;
    } catch (err) {
      console.warn('[Background] Direct download failed, falling back:', err);
    }
  }

  // パターン2: UIクリックによりブラウザ標準ダウンロードがトリガーされた場合
  if (directTriggered) {
    console.log('[Background] Download menu was clicked. Waiting for browser download event...');
    await updateTask(taskId, {
      status: 'downloading',
      stepMessage: 'ダウンロードの開始を待機中...'
    });

    // 25秒間ブラウザのダウンロードイベントを監視
    setTimeout(async () => {
      const currentTasks = await browser.storage.local.get('tasks');
      const curTask = currentTasks.tasks?.[taskId];
      // すでにダウンロードが検知されていれば onChanged に任せる
      if (curTask && curTask.downloadId) {
        return;
      }

      console.warn('[Background] No download detected within 25s. Keeping tab open.');
      await updateTask(taskId, {
        status: 'completed',
        stepMessage: '音声解説の生成が完了しました（ダウンロードはお使いのブラウザのダウンロード一覧またはStudioパネルをご確認ください）'
      });
      sendNotification('音声解説が完成しました！', `「${title}」の音声解説が完成しました。\n（Studioパネルで再生・保存できます）`);
      // ダウンロード未完了時はユーザーが手動操作できるようタブを閉じない
    }, 25000);
  }
}

// ブラウザダウンロードイベントの監視（ネイティブダウンロードのキャッチ）
browser.downloads.onCreated.addListener(async (downloadItem) => {
  console.log('[Background] Browser download created:', downloadItem);

  if (lastTriggeredTask) {
    const { taskId, title, tabId, settings } = lastTriggeredTask;
    await updateTask(taskId, {
      status: 'downloading',
      stepMessage: `ダウンロード中 (${downloadItem.filename || '音声ファイル'})...`,
      downloadId: downloadItem.id
    });
  }
});

// ダウンロード完了の監視
browser.downloads.onChanged.addListener(async (delta) => {
  if (delta.state && delta.state.current === 'complete') {
    if (lastTriggeredTask) {
      const { taskId, title, tabId, settings } = lastTriggeredTask;
      await updateTask(taskId, {
        status: 'completed',
        stepMessage: 'ダウンロードが正常に完了しました'
      });
      sendNotification('ダウンロード完了', `「${title}」の音声ファイルが保存されました。`);
      cleanupTab(tabId, settings?.autoCloseTab);
      lastTriggeredTask = null;
    }
  }
});

// タブを安全に閉じるヘルパー
function cleanupTab(tabId, autoClose) {
  if (!autoClose || !tabId) return;
  setTimeout(() => {
    browser.tabs.remove(tabId).catch(() => {});
  }, 4000);
}

// エラー発生時のハンドリング
async function handleTaskFailed(message, tabId) {
  const { taskId, error } = message;
  await updateTask(taskId, {
    status: 'failed',
    stepMessage: `エラー: ${error}`
  });

  sendNotification('エラーが発生しました', error || 'NotebookLMでの処理に失敗しました。');
}
