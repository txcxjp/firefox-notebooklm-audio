/**
 * NotebookLM Audio Podcaster - Options Controller
 */

const DEFAULT_PROMPT = `Please converse entirely in natural, engaging Japanese. 
Act as two enthusiastic experts explaining the core takeaways, context, and implications of this source material. 
Keep the discussion clear, insightful, and accessible for a Japanese-speaking listener.`;

const DEFAULT_SETTINGS = {
  prompt: DEFAULT_PROMPT,
  downloadSubdir: 'NotebookLM',
  autoCloseTab: true
};

document.addEventListener('DOMContentLoaded', async () => {
  const promptInput = document.getElementById('promptInput');
  const subdirInput = document.getElementById('subdirInput');
  const autoCloseTab = document.getElementById('autoCloseTab');
  const resetPromptBtn = document.getElementById('resetPromptBtn');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // 設定のロード
  const store = await browser.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...(store.settings || {}) };

  promptInput.value = settings.prompt;
  subdirInput.value = settings.downloadSubdir;
  autoCloseTab.checked = settings.autoCloseTab !== false;

  // デフォルトに戻す
  resetPromptBtn.addEventListener('click', () => {
    if (confirm('プロンプトを初期値に戻しますか？')) {
      promptInput.value = DEFAULT_PROMPT;
    }
  });

  // 設定の保存
  saveBtn.addEventListener('click', async () => {
    const updatedSettings = {
      prompt: promptInput.value.trim() || DEFAULT_PROMPT,
      downloadSubdir: subdirInput.value.trim() || 'NotebookLM',
      autoCloseTab: autoCloseTab.checked
    };

    await browser.storage.local.set({ settings: updatedSettings });

    saveStatus.textContent = '設定を保存しました！';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 2500);
  });
});
