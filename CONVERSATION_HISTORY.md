# セッション会話履歴 & 要件定義ログ (Session Log)

- **プロジェクト**: NotebookLM Audio Podcaster (Firefox Add-on)
- **記録日時**: 2026-10-06
- **保存先パス**: `/home/txjp/dev/firefox-notebooklm-audio/`

---

## 1. 初回ユーザーリクエスト

> **User**:  
> URLを入力すると、そのページをソースにしたnotebooklmが作成されて、自動的に音声解説が作成されて、その音声解説を簡単に取り出せるような仕組みが欲しい。grillmeできる？

---

## 2. 要件定義インタビュー（Grill-me）の記録

### 第1ラウンド：全体方針と基本仕様
- **Q1: NotebookLM本家への依存度と実装アプローチ**
  - **回答**: 本家NotebookLMの自動化（Googleアカウントのセッション/ブラウザ自動化を使い、NotebookLM特有の掛け合い音声を生成）
- **Q2: インターフェース・利用シーン**
  - **回答**: ブラウザ拡張 / ブックマークレット（閲覧中のWebページから1クリックで作成）
- **Q3: 音声解説の希望言語**
  - **回答**: 日本語で解説してほしい
- **Q4: 音声ファイル（MP3等）の受け取り・管理方法**
  - **回答**: ローカルPCの特定フォルダにMP3として自動保存

### 第2ラウンド：UX・動作フロー・ライフサイクル
- **Q1: 拡張機能クリック時の動作感・UX**
  - **回答**: バックグラウンドで自動処理（NotebookLMのタブをバックグラウンドで開き、完了したら通知＆MP3自動ダウンロード）
- **Q2: ノートブックの扱い**
  - **回答**: 1URLごとに「新規ノートブック」を作成して残す（過去のソースやメモも後から参照可能）
- **Q3: 音声解説の生成設定（日本語プロンプト）の指定方法**
  - **回答**: ワンクリックで即実行（設定画面であらかじめ「日本語で要約」「トーン」などを固定設定しておく）
- **Q4: 保存先フォルダ**
  - **回答**: 通常の「ダウンロード」フォルダ配下（`Downloads/NotebookLM/`）に自動保存

### 第3ラウンド：技術アーキテクチャ・DOM操作詳細
- **Q1: ソース登録方法**
  - **回答**: URLのみをNotebookLMの「ウェブリンク」入力欄に渡す（NotebookLM側で再度フェッチさせる）
- **Q2: 完了監視の方式**
  - **回答**: バックグラウンドタブを1つ開き、完了時に自動で閉じる（Manifest V3でも数分〜十数分の生成待ちに最も安定して耐えられる方式）
- **Q3: 日本語プロンプトの仕様**
  - **回答**: 設定画面でユーザー自身がカスタムプロンプト（口調、話者設定、重点項目など）を自由に編集・変更できるようにする

---

## 3. 追加変更リクエスト

> **User**:  
> やっぱりfirefoxの拡張として実装してほしい

- **変更点**:
  - Chrome拡張（Chrome Extension MV3）から **Firefox拡張機能（WebExtension MV3）** へ仕様を変更。
  - Firefox MV3仕様（`gecko.id` の定義、`background.scripts` による長時間待機耐性、`browser.*` WebExtension API、`about:debugging` による読み込み対応）を採用。

---

## 4. 実装されたファイルと役割

| ファイル | 役割・概要 |
| :--- | :--- |
| [`manifest.json`](manifest.json) | Firefox MV3 拡張機能定義（Gecko ID, permissions, background, content_scripts, popup, options） |
| [`background/background.js`](background/background.js) | バックグラウンド処理（タスク発行、裏タブ管理、デスクトップ通知、MP3自動ダウンロード、タブ自動クローズ） |
| [`content-scripts/automator.js`](content-scripts/automator.js) | NotebookLM DOM自動操作エンジン（ログイン確認、新規ノート作成、Webリンク追加、日本語プロンプト注入、生成待機ポーリング、ダウンロード検出） |
| [`popup/popup.html`](popup/popup.html) / [`popup.css`](popup/popup.css) / [`popup.js`](popup/popup.js) | ポップアップ画面（現在タブのURL自動取得、ワンクリック実行、進行中タスク表示、NotebookLMタブへのフォーカス切替） |
| [`options/options.html`](options/options.html) / [`options.css`](options/options.css) / [`options.js`](options/options.js) | 設定画面（日本語プロンプトの自由編集・初期化、保存先サブフォルダ名指定、タブ自動クローズ設定） |
| [`icons/`](icons/) | 拡張機能用アイコン（16px, 48px, 128px） |
| [`README.md`](README.md) | Firefox（`about:debugging`）へのインストール手順・利用マニュアル |

---

## 5. デフォルト日本語プロンプト

```text
Please converse entirely in natural, engaging Japanese. 
Act as two enthusiastic experts explaining the core takeaways, context, and implications of this source material. 
Keep the discussion clear, insightful, and accessible for a Japanese-speaking listener.
```
