# NotebookLM Audio Podcaster (Firefox Add-on)

閲覧中のWebページ、または任意のURLから **Google NotebookLM** の音声解説（Audio Overview / Deep Dive）を日本語で自動生成し、MP3ファイルをローカルPC（ダウンロードフォルダ）へ自動保存するFirefox拡張機能です。

---

## 主な特徴

1. **ワンクリックで自動化**
   - 閲覧中の記事やWebサイト上でアドオンアイコンをクリックし、「日本語で音声解説を作成」を押すだけ。
   - バックグラウンドでNotebookLMを開き、新規ノート作成 ➔ URL追加 ➔ 日本語プロンプト設定 ➔ 音声解説生成 ➔ MP3ダウンロードまで完全自動で行います。
2. **日本語音声解説（プロンプト内蔵 & カスタマイズ可能）**
   - 2人のホストが日本語で自然に対話・解説するプロンプトを内蔵。設定画面から自由に変更可能。
3. **ローカルへ自動ダウンロード**
   - 生成が完了すると、`Downloads/NotebookLM/YYYYMMDD_タイトル.mp3` に自動保存されます。
4. **デスクトップ通知**
   - 開始時、完了時、エラー時にFirefoxのシステム通知が届きます。

---

## Firefox へのインストール手順（開発中アドオンの読み込み）

Firefoxの「一時的なアドオン読み込み」機能を使って、数秒でインストールできます。

1. **Firefox を起動**
2. アドレスバーに以下を入力して開きます：
   ```text
   about:debugging#/runtime/this-firefox
   ```
3. ページ内の **「一時的なアドオンを読み込む... (Load Temporary Add-on...)」** ボタンをクリックします。
4. ファイル選択ダイアログで、このプロジェクトの **`manifest.json`** を選択します：
   ```text
   /home/txjp/dev/firefox-notebooklm-audio/manifest.json
   ```
5. ツールバーに青いアイコン（🎙️）が表示されたらインストール完了です！

---

## 使い方

### 1. 前提条件
- Firefox上で [Google NotebookLM](https://notebooklm.google.com/) にあらかじめログインしていることを確認してください。

### 2. 音声解説の作成
1. 音声解説を作りたいWebページ（記事、ブログ、ニュースなど）を開きます。
2. ツールバーの **NotebookLM Audio Podcaster** アイコンをクリック。
3. 自動でタイトルとURLが入力されているのを確認し、**「日本語で音声解説を作成」** ボタンをクリック。
4. 「音声解説の生成を開始しました」という通知が表示され、バックグラウンドで処理が進行します。
5. 数分〜10分程度で生成が完了し、`Downloads/NotebookLM/` 配下にMP3ファイルが自動ダウンロードされます。

---

## 設定のカスタマイズ（オプション画面）

ポップアップ右上の ⚙️（歯車アイコン）をクリックするか、Firefoxのアドオンマネージャー（`about:addons`）から「設定」を開きます。

- **音声解説プロンプト**: 日本語のトーン、話し手の性格、重点的に解説させたいポイントなどを自由にカスタマイズ可能。
- **ダウンロード先サブフォルダ**: 保存先フォルダ名（デフォルト: `NotebookLM`）を変更可能。
- **タブの自動クローズ**: ダウンロード完了後に自動操作用タブを閉じるかどうかの切り替え。

---

## ディレクトリ構成

```
firefox-notebooklm-audio/
├── manifest.json            # Firefox WebExtension MV3 マニフェスト
├── popup/                   # ポップアップ画面
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/                 # 設定画面
│   ├── options.html
│   ├── options.css
│   └── options.js
├── background/              # バックグラウンド処理・ダウンロード・通知
│   └── background.js
├── content-scripts/         # NotebookLM DOM自動操作エンジン
│   └── automator.js
├── tests/                   # ユニットテスト (Node.js test runner)
│   ├── background.test.mjs
│   └── automator_dom.test.mjs
├── icons/                   # アプリアイコン (16, 48, 128)
├── package.json
└── README.md
```

---

## テストの実行

Node.js (v18+) 組み込みのテストランナーでユニットテストを実行できます：

```bash
npm test
```

---

## デバッグとトラブルシューティング

- **進捗の確認**:
  - ポップアップ内の「NotebookLMタブを表示」ボタンを押すと、現在バックグラウンドで操作中のNotebookLMタブに切り替えてリアルタイムのDOM状態を確認できます。
- **コンソールログの確認**:
  - Firefoxで `F12`（開発者ツール）を開くか、`about:debugging` の当アドオン欄にある「調査 (Inspect)」をクリックすると、`background.js` および `automator.js` の詳細なステップログ（`[NLM Automator]`、`[Background]`）を確認できます。

