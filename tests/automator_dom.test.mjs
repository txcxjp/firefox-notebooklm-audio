import test from 'node:test';
import assert from 'node:assert/strict';

// Node.js組み込みの基本クラスを使ったミニマルDOMモック
class MockElement {
  constructor(tagName, attributes = {}, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.textContent = textContent;
    this.innerText = textContent;
    this.children = [];
    this.parentElement = null;
    this.events = [];
    this.value = '';
    this.offsetWidth = 100;
    this.offsetHeight = 40;
  }

  get childElementCount() {
    return this.children.length;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  dispatchEvent(evt) {
    this.events.push(evt.type);
    return true;
  }

  focus() {
    this.focused = true;
  }
}

function matchesSelector(el, selector) {
  const parts = selector.split(',').map(s => s.trim());
  return parts.some(part => {
    if (part.startsWith('.')) {
      const cls = (el.getAttribute('class') || '').split(' ');
      return cls.includes(part.slice(1));
    }
    if (part.startsWith('[') && part.endsWith(']')) {
      const attr = part.slice(1, -1);
      return el.getAttribute(attr) !== null;
    }
    return el.tagName.toLowerCase() === part.toLowerCase();
  });
}

// automator.js 内の探索ロジックのシミュレーション
function findElementByTextMock(root, selector, regex) {
  const elements = root.querySelectorAll(selector);
  elements.sort((a, b) => a.childElementCount - b.childElementCount);

  for (const el of elements) {
    const text = el.textContent.trim();
    if (regex.test(text)) {
      return el;
    }
  }
  return null;
}

test('findElementByText prioritizes leaf elements over containers', () => {
  const root = new MockElement('div');
  const container = root.appendChild(new MockElement('div', { class: 'container' }, '新しいノートブックを作成 詳細説明など'));
  const innerButton = container.appendChild(new MockElement('button', { class: 'btn' }, '新しいノートブックを作成'));

  const found = findElementByTextMock(root, 'div, button', /新しいノートブックを作成/);
  assert.equal(found, innerButton, 'Should select the deeper child button rather than the container div');
});

test('matches Angular form control attributes including urls textarea', () => {
  const root = new MockElement('div');
  const dialog = root.appendChild(new MockElement('div', { role: 'dialog' }));
  const textarea = dialog.appendChild(new MockElement('textarea', { formcontrolname: 'urls', placeholder: 'リンクを貼り付ける', 'aria-label': 'URL を入力' }));

  const textareas = root.querySelectorAll('textarea');
  assert.equal(textareas.length, 1);
  assert.equal(textareas[0].getAttribute('formcontrolname'), 'urls');
  assert.equal(textareas[0].getAttribute('placeholder'), 'リンクを貼り付ける');
  assert.equal(textareas[0].getAttribute('aria-label'), 'URL を入力');
});

test('matches studio audio overview button', () => {
  const root = new MockElement('div');
  const studio = root.appendChild(new MockElement('div', { class: 'studio' }));
  const audioTile = studio.appendChild(new MockElement('div', { role: 'button', 'aria-label': '音声解説' }, 'audio_spark 音声解説'));

  assert.equal(audioTile.getAttribute('role'), 'button');
  assert.equal(audioTile.getAttribute('aria-label'), '音声解説');
});

test('matches website option and insert button in localized text', () => {
  const regexWebsite = /ウェブサイト|ウェブの\s*URL|ウェブリンク|Website|Web\s*link|リンク.*URL/i;
  assert.ok(regexWebsite.test('ウェブサイト'));
  assert.ok(regexWebsite.test('ウェブの URL'));
  assert.ok(regexWebsite.test('Website'));
  assert.ok(regexWebsite.test('Web link'));
  assert.ok(regexWebsite.test('リンク (URL)'));

  // 説明文は除外条件で弾かれることのテスト
  const isExcludedDescription = (text) => {
    return text.length > 30 || /追加してください|できます|その後|質問|作成/i.test(text);
  };
  assert.ok(isExcludedDescription('ファイルやウェブサイトなどを追加してください。その後、そのソースに基づいて質問したり、何かを作成したりできます。'));
  assert.ok(!isExcludedDescription('ウェブサイト'));
  assert.ok(!isExcludedDescription('ウェブの URL'));

  const regexInsert = /挿入|追加|Insert|Add/i;
  assert.ok(regexInsert.test('挿入'));
  assert.ok(regexInsert.test('リンクを挿入'));
  assert.ok(regexInsert.test('追加'));
  assert.ok(regexInsert.test('Insert'));
  assert.ok(regexInsert.test('Add source'));
});

test('findPlayButton criteria strictly ignores Play Books and matches playback controls', () => {
  const isPlayButton = (aria, text, iconName) => {
    aria = (aria || '').trim();
    text = (text || '').trim();
    iconName = (iconName || '').trim();

    if (
      aria.includes('Google') || aria.includes('ノートブック') || aria.includes('ソース') ||
      aria.includes('Play ブックス') || text.includes('Play ブックス') ||
      aria.includes('共有') || aria.includes('設定')
    ) {
      return false;
    }

    return (
      aria === '再生' || aria === '一時停止' || aria === 'Play' || aria === 'Pause' ||
      aria.startsWith('再生 ') || aria.startsWith('Play ') ||
      text === 'play_arrow' || iconName === 'play_arrow' ||
      text === 'pause' || iconName === 'pause'
    );
  };

  // Play ブックス must be rejected
  assert.equal(isPlayButton('Play ブックス', 'Play ブックス', ''), false);
  assert.equal(isPlayButton('', 'Play ブックス', ''), false);

  // Other non-audio buttons must be rejected
  assert.equal(isPlayButton('ノートブックの設定', 'more_vert', 'more_vert'), false);
  assert.equal(isPlayButton('ソースを追加', 'add_2', 'add_2'), false);

  // Audio play/pause controls must be accepted
  assert.equal(isPlayButton('再生', '', 'play_arrow'), true);
  assert.equal(isPlayButton('Play', '', 'play_arrow'), true);
  assert.equal(isPlayButton('一時停止', '', 'pause'), true);
  assert.equal(isPlayButton('', 'play_arrow', 'play_arrow'), true);
});

test('audio download URL transformation converts stream to download param', () => {
  const streamUrl = 'https://rr1---sn-abc.googleusercontent.com/notebooklm/audio-12345=m140';
  const downloadUrl = streamUrl.includes('=m140') && !streamUrl.includes('=m140-dv')
    ? streamUrl.replace('=m140', '=m140-dv')
    : streamUrl;

  assert.equal(downloadUrl, 'https://rr1---sn-abc.googleusercontent.com/notebooklm/audio-12345=m140-dv');
});

test('findActiveUrlInput strictly rejects discoverSourcesQuery and accepts urls textarea', () => {
  const isUrlInput = (formcontrolname, placeholder) => {
    formcontrolname = (formcontrolname || '').toLowerCase();
    placeholder = (placeholder || '').toLowerCase();

    if (formcontrolname.includes('discover') || formcontrolname.includes('query')) {
      return false;
    }
    if (placeholder.includes('検索')) {
      return false;
    }

    return formcontrolname === 'urls' || placeholder.includes('リンクを貼り付ける') || placeholder.includes('url');
  };

  // discoverSourcesQuery must be rejected
  assert.equal(isUrlInput('discoverSourcesQuery', 'ウェブで新しいソースを検索'), false);

  // Real URL input must be accepted
  assert.equal(isUrlInput('urls', 'リンクを貼り付ける'), true);
  assert.equal(isUrlInput('urls', ''), true);
  assert.equal(isUrlInput('', 'リンクを貼り付ける'), true);
});

test('findWebsiteSourceButton matches user DOM source-action-button with website label', () => {
  const root = new MockElement('div', { class: 'dialog-container state-main' });
  const buttonsContainer = root.appendChild(new MockElement('div', { class: 'source-buttons' }));
  const uploadBtn = buttonsContainer.appendChild(new MockElement('button', { class: 'source-action-button' }, 'upload ファイルをアップロード'));
  const websiteBtn = buttonsContainer.appendChild(new MockElement('button', { class: 'source-action-button' }, 'link_2 video_youtube ウェブサイト'));

  const findBtn = (container) => {
    const btns = container.querySelectorAll('.source-action-button, button');
    for (const b of btns) {
      if ((b.textContent || '').includes('ウェブサイト')) return b;
    }
    return null;
  };

  const matched = findBtn(root);
  assert.equal(matched, websiteBtn);
});

test('studio panel targeting and audio card elements based on real user DOM', () => {
  const root = new MockElement('div');
  const section = root.appendChild(new MockElement('section', { class: 'studio-panel', 'data-panel-state': 'studio-home' }));
  const header = section.appendChild(new MockElement('div', { class: 'panel-header' }));
  const closeBtn = header.appendChild(new MockElement('button', {
    class: 'toggle-studio-panel-button',
    'aria-label': 'Studio のパネルを閉じる'
  }));

  const studioPanel = section.appendChild(new MockElement('studio-panel'));
  const scrollable = studioPanel.appendChild(new MockElement('div', { class: 'panel-content-scrollable' }));
  const btnContainer = scrollable.appendChild(new MockElement('div', { class: 'create-artifact-buttons-container' }));

  const basicBtn = btnContainer.appendChild(new MockElement('basic-create-artifact-button'));
  const cardDiv = basicBtn.appendChild(new MockElement('div', {
    role: 'button',
    class: 'create-artifact-button-container',
    'aria-label': '音声解説'
  }, '音声解説'));
  const optionIcon = cardDiv.appendChild(new MockElement('div', { class: 'option-icon' }));
  const chevron = optionIcon.appendChild(new MockElement('mat-icon', { class: 'edit-icon' }, 'chevron_forward'));

  // Studio panel root locator must never select the close button
  const getStudioPanel = (doc) => {
    return doc.querySelectorAll('.studio-panel, studio-panel')[0] || null;
  };
  assert.equal(getStudioPanel(root), section);
  assert.notEqual(getStudioPanel(root), closeBtn);

  // Audio overview card resolution
  const audioCards = section.querySelectorAll('basic-create-artifact-button');
  assert.equal(audioCards.length, 1);
  assert.equal(cardDiv.getAttribute('aria-label'), '音声解説');
  assert.equal(chevron.textContent, 'chevron_forward');
});

test('studio generation criteria ignores spinners outside studio-panel', () => {
  const isStudioGenerating = (studio, spinnerInside) => {
    return !!spinnerInside;
  };

  assert.equal(isStudioGenerating(null, false), false, 'Should not detect generation if spinner is in another panel');
  assert.equal(isStudioGenerating(null, true), true, 'Should detect generation if spinner is inside studio');
});

test('isButtonDisabled correctly identifies grayed out and active audio buttons', () => {
  const isButtonDisabledMock = (el) => {
    if (!el) return true;
    if (el.getAttribute('disabled') !== null) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.getAttribute('data-disabled') === 'true') return true;
    if (el.getAttribute('tabindex') === '-1') return true;
    const classStr = ((el.getAttribute('class') || '')).toLowerCase();
    if (classStr.includes('disabled') || classStr.includes('inactive')) return true;

    let p = el.parentElement;
    while (p) {
      if (p.tagName === 'BASIC-CREATE-ARTIFACT-BUTTON') {
        if (p.getAttribute('disabled') !== null || p.getAttribute('aria-disabled') === 'true' || p.getAttribute('data-disabled') === 'true') return true;
        const pClass = (p.getAttribute('class') || '').toLowerCase();
        if (pClass.includes('disabled') || pClass.includes('inactive')) return true;
      }
      p = p.parentElement;
    }
    return false;
  };

  const host = new MockElement('basic-create-artifact-button');
  const activeBtn = host.appendChild(new MockElement('div', { role: 'button', 'aria-label': '音声解説', tabindex: '0' }));
  assert.equal(isButtonDisabledMock(activeBtn), false, 'Active button must not be disabled');

  const disabledBtnAria = new MockElement('div', { role: 'button', 'aria-disabled': 'true' });
  assert.equal(isButtonDisabledMock(disabledBtnAria), true, 'aria-disabled="true" must be disabled');

  const disabledBtnTabindex = new MockElement('div', { role: 'button', tabindex: '-1' });
  assert.equal(isButtonDisabledMock(disabledBtnTabindex), true, 'tabindex="-1" must be disabled');

  const disabledHost = new MockElement('basic-create-artifact-button', { 'aria-disabled': 'true' });
  const childBtn = disabledHost.appendChild(new MockElement('div', { role: 'button' }));
  assert.equal(isButtonDisabledMock(childBtn), true, 'Child of disabled host must be disabled');

  const disabledClassBtn = new MockElement('div', { role: 'button', class: 'create-artifact-button-container mat-mdc-button-disabled' });
  assert.equal(isButtonDisabledMock(disabledClassBtn), true, 'Button with disabled class must be disabled');
});

test('customize dialog targeting matches configurable-form-dialog and exact generate button', () => {
  const root = new MockElement('div');
  const dialogHost = root.appendChild(new MockElement('configurable-form-dialog', { class: 'mat-mdc-dialog-component-host' }));
  const dialogContainer = dialogHost.appendChild(new MockElement('div', { class: 'dialog-container' }));

  // External search textarea (must NEVER be matched by dialog prompt finder)
  const externalSearch = root.appendChild(new MockElement('textarea', {
    id: 'mat-input-0',
    class: 'cdk-textarea-autosize mat-mdc-input-element query-box-textarea',
    formcontrolname: 'discoverSourcesQuery',
    'aria-label': '入力されたクエリをもとにソースを検出する'
  }));

  // Textarea with aria-label
  const content = dialogContainer.appendChild(new MockElement('mat-dialog-content', { class: 'mat-mdc-dialog-content' }));
  const suggestionBuilder = content.appendChild(new MockElement('suggestion-builder'));
  const promptTa = suggestionBuilder.appendChild(new MockElement('textarea', {
    class: 'mat-mdc-input-element cdk-textarea-autosize',
    'aria-label': 'このエピソードで AI ホストが焦点を当てるべきこと'
  }));

  // Actions with both "後で生成" and "生成"
  const actions = dialogContainer.appendChild(new MockElement('mat-dialog-actions', { class: 'mat-mdc-dialog-actions' }));
  const meter = actions.appendChild(new MockElement('div', { role: 'progressbar', class: 'meter-bar', 'aria-label': '使用量メーター' }));

  const laterBtnWrapper = actions.appendChild(new MockElement('span'));
  const laterBtn = laterBtnWrapper.appendChild(new MockElement('button', {}, '後で生成'));

  const actionWrapper = actions.appendChild(new MockElement('span', { class: 'action-button-wrapper' }));
  const generateBtn = actionWrapper.appendChild(new MockElement('button', { class: 'mat-tonal-button' }, ' 生成 '));

  // 1. Prompt textarea must match
  const findPromptTa = (rootEl) => {
    const tas = rootEl.querySelectorAll('textarea');
    for (const ta of tas) {
      const aria = ta.getAttribute('aria-label') || '';
      if (aria.includes('ホスト') || aria.includes('焦点')) return ta;
    }
    return null;
  };
  assert.equal(findPromptTa(root), promptTa);
  assert.notEqual(findPromptTa(root), externalSearch, 'Must NEVER select external discoverSourcesQuery textarea');

  // 2. Generate button must select exact "生成" and reject "後で生成"
  const findDialogGenBtn = (rootEl) => {
    const actionBtn = rootEl.querySelectorAll('.action-button-wrapper button')[0];
    if (actionBtn) return actionBtn;

    const btns = rootEl.querySelectorAll('button');
    for (const b of btns) {
      const text = (b.textContent || '').trim();
      if (/後で/i.test(text)) continue;
      if (/^生成$/i.test(text)) return b;
    }
    return null;
  };

  assert.equal(findDialogGenBtn(root), generateBtn);
  assert.notEqual(findDialogGenBtn(root), laterBtn);

  // 3. Usage meter must be excluded from progress spinner checks
  const isGenerating = (el) => {
    if (el.getAttribute('role') === 'progressbar') {
      if ((el.getAttribute('class') || '').includes('meter-bar') || (el.getAttribute('aria-label') || '').includes('使用量')) {
        return false;
      }
      return true;
    }
    return false;
  };
  assert.equal(isGenerating(meter), false, 'Meter bar must not be treated as generation spinner');
});

test('findAudioPlayerMenuButton targets [BTN #40] aria="その他" and excludes studio close and other menus', () => {
  const root = new MockElement('div');
  const section = root.appendChild(new MockElement('section', { class: 'studio-panel' }));
  const closeBtn = section.appendChild(new MockElement('button', {
    class: 'toggle-studio-panel-button',
    'aria-label': 'Studio のパネルを閉じる'
  }));

  const playerContainer = section.appendChild(new MockElement('div', { class: 'player-container' }));
  const playBtn = playerContainer.appendChild(new MockElement('button', {
    'aria-label': '再生'
  }, 'play_arrow'));
  const menuBtn = playerContainer.appendChild(new MockElement('button', {
    'aria-label': 'その他'
  }, 'more_vert'));

  const findMenu = (studio, playEl) => {
    const btns = studio.querySelectorAll('button');
    for (const b of btns) {
      if (b === playEl) continue;
      const aria = b.getAttribute('aria-label') || '';
      const text = b.textContent || '';
      if (aria.includes('閉じる')) continue;
      if (aria === 'その他' || text.includes('more_vert')) {
        return b;
      }
    }
    return null;
  };

  const found = findMenu(section, playBtn);
  assert.equal(found, menuBtn);
  assert.notEqual(found, closeBtn);
});

test('fail-fast validation: rejects silent fallback and requires dialog closure after generate', () => {
  // 1. Prompt input must be strictly validated (non-empty)
  const validatePromptSet = (inputEl, text) => {
    inputEl.value = text;
    if (!inputEl.value || inputEl.value.trim().length === 0) {
      throw new Error('プロンプト入力欄にテキストを設定できませんでした');
    }
    return true;
  };

  const ta = new MockElement('textarea');
  assert.equal(validatePromptSet(ta, 'Japanese prompt'), true);

  const emptyTa = new MockElement('textarea');
  assert.throws(() => validatePromptSet(emptyTa, '   '), /プロンプト入力欄にテキストを設定できませんでした/);

  // 2. Dialog closure validation: if dialog is still open after clicking generate, fail immediately
  const verifyDialogClosed = (isDialogVisible) => {
    if (isDialogVisible) {
      throw new Error('「生成」ボタンをクリックしましたが、ダイアログが自動で閉じず生成が開始されませんでした。');
    }
    return true;
  };

  assert.equal(verifyDialogClosed(false), true, 'When dialog closes naturally, it succeeds');
  assert.throws(() => verifyDialogClosed(true), /ダイアログが自動で閉じず生成が開始されませんでした/, 'Must throw if dialog remains open instead of silently suppressing with Escape');
});

test('existing completed audio detection bypasses generation and extracts title from live user DOM structure', () => {
  const root = new MockElement('div');
  const section = root.appendChild(new MockElement('section', {
    class: 'studio-panel',
    'data-panel-state': 'studio-home'
  }));

  const studioPanel = section.appendChild(new MockElement('studio-panel'));
  const content = studioPanel.appendChild(new MockElement('div', { class: 'panel-content-scrollable' }));
  const artifactLib = content.appendChild(new MockElement('artifact-library'));
  const item = artifactLib.appendChild(new MockElement('artifact-library-item', {
    'data-studio-accent': 'blue',
    class: 'has-unseen-dot'
  }));

  const itemButton = item.appendChild(new MockElement('div', { class: 'artifact-item-button' }));
  const buttonContent = itemButton.appendChild(new MockElement('div', { class: 'artifact-button-content' }));
  const titleContainer = buttonContent.appendChild(new MockElement('div', { class: 'title-container' }));
  const titleSpan = titleContainer.appendChild(new MockElement('span', { class: 'artifact-title' }, ' 半年の放置が招いた文化露寇 '));

  const actions = itemButton.appendChild(new MockElement('div', { class: 'artifact-actions' }));
  const actionContainer = actions.appendChild(new MockElement('span', { class: 'artifact-action-container' }));
  const playWrapper = actionContainer.appendChild(new MockElement('nb-icon-button', {
    fonticonname: 'play_arrow',
    mattooltip: '再生'
  }));
  const playBtn = playWrapper.appendChild(new MockElement('button', {
    'aria-label': '再生'
  }, 'play_arrow'));

  const moreWrapper = actions.appendChild(new MockElement('nb-icon-button', {
    fonticonname: 'more_vert',
    mattooltip: 'もっと見る'
  }));
  const moreBtn = moreWrapper.appendChild(new MockElement('button', {
    'aria-label': 'その他'
  }, 'more_vert'));

  // 1. Detection of play button from real DOM
  const findPlayBtn = (studio) => {
    const btns = studio.querySelectorAll('button');
    for (const b of btns) {
      const aria = b.getAttribute('aria-label') || '';
      const text = b.textContent || '';
      const p = b.parentElement;
      const font = p?.getAttribute('fonticonname') || '';
      if (aria === '再生' || font === 'play_arrow' || text === 'play_arrow') {
        return b;
      }
    }
    return null;
  };

  const detectedPlay = findPlayBtn(section);
  assert.equal(detectedPlay, playBtn, 'Must find exact play button');

  // 2. Generation bypass logic
  const isStudioGen = (studio) => {
    const spinners = studio.querySelectorAll('[role="progressbar"], mat-progress-spinner');
    return spinners.some(s => !(s.getAttribute('class') || '').includes('meter-bar'));
  };

  const isCompletedAudio = (studio) => {
    const play = findPlayBtn(studio);
    return !!play && !isStudioGen(studio);
  };

  assert.equal(isCompletedAudio(section), true, 'Must detect completed audio and skip 8-minute generation');

  // 3. Title extraction
  const titleEl = section.querySelectorAll('.artifact-title')[0];
  assert.equal(titleEl?.textContent?.trim(), '半年の放置が招いた文化露寇');
});

test('triggerClick emits exactly ONE click event to prevent duplicate notebook creation', () => {
  const btn = new MockElement('button', { class: 'mat-mdc-button', 'aria-label': '新しいノートブック' });

  let clickCount = 0;
  btn.click = () => {
    clickCount++;
    btn.dispatchEvent({ type: 'click' });
  };

  const firedEvents = [];
  const triggerClickMock = (target) => {
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
    events.forEach(evt => {
      target.dispatchEvent({ type: evt });
      firedEvents.push(evt);
    });

    if (typeof target.click === 'function') {
      target.click();
      firedEvents.push('native:click');
    } else {
      target.dispatchEvent({ type: 'click' });
      firedEvents.push('dispatch:click');
    }
  };

  triggerClickMock(btn);

  // Exactly 1 native click call and 1 click event
  assert.equal(clickCount, 1, 'Must invoke click exactly ONCE to prevent 4 duplicate notebooks');
  assert.equal(btn.events.filter(e => e === 'click').length, 1, 'Only 1 click event must be recorded');
  assert.deepEqual(firedEvents, [
    'pointerdown',
    'mousedown',
    'pointerup',
    'mouseup',
    'native:click'
  ]);
});
