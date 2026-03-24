# UI/UX Design & Component Architecture

## 1. Overview (UI設計の基本方針)
本アプリケーションは、複雑なポートフォリオ管理データ（WBS, EVM, スナップショット）を直感的に操作できるよう、**Mantine (React Component Library)** の機能を最大限に活用したデスクトップUIを提供する。

### 基本デザイン原則
- **Data-Dense but Clean:** 業務システムとして一覧性を重視しつつ、余白とタイポグラフィ（Mantineのデフォルト）を活かして圧迫感を減らす。
- **Contextual Actions:** 「今、どの計画バージョン（ドラフトか過去のベースラインか）を見ているか」を常に画面上部に明示する。
- **Guardrails in UI:** DBの制約（Activityのみ入力可、など）をUIレベルでも適用し、無効な操作は入力フィールドを`disabled`にするか非表示にする。

---

## 2. App Layout (画面レイアウト: Mantine AppShell)

アプリケーション全体のレイアウトは `AppShell` を用いて以下の3ペイン構成とする。

### 2.1 Header (ヘッダー)
- **左側:** ポートフォリオ名、現在のビュー名（WBS, Dashboard等）。
- **中央:** 【重要】現在の「計画バージョン」を表示するセレクタ（例: `🟢 Working Draft` / `🔒 V1 Baseline`）。
- **右側:** 「ベースラインとして保存」ボタン（ドラフト閲覧時のみ表示）、全体設定。

### 2.2 Navbar (左側サイドバー)
主要な機能（ビュー）の切り替えナビゲーション。
1. 📊 **Dashboard:** EVMサマリー、Sカーブグラフ、遅延警告。
2. 🌳 **WBS & Estimates:** WBSツリーの構築と全体見積もり（BAC）。
3. 📅 **Resource Allocation:** タイムフェーズ（期間）ごとのPV割り当てマトリックス。
4. ✍️ **Execution (Actuals/EV):** メンバー向けの実績（AC）と進捗（EV）入力画面。
5. 🕰️ **Baselines:** 過去のスナップショットの履歴管理・比較。
6. 🚩 **Milestones:** マイルストーンの管理。

### 2.3 Main (メインコンテンツ領域)
選択されたビューのコンテンツを表示。以下に主要ビューの詳細を定義する。

---

## 3. Key Views (主要画面の設計)

### 3.1 🌳 WBS & Estimates (計画: ツリー構築と見積もり)
**目的:** WBSを分解し、アクティビティごとに全体工数を見積もる。
- **UIコンポーネント:** 階層型データグリッド (TreeGrid / Nested Table)。
- **カラム構成:**
  - `WBS Title` (インデントで階層を表現。展開/折りたたみ可能)
  - `Type` (Badge: Project, WorkPackage, Activity)
  - `Milestone` (マイルストーンタグ)
  - `Estimated PV` (見積工数: Activityのみ入力用NumberInputを表示。親ノードは自動集計値をテキスト表示)
  - `Tags` (Mantine MultiSelect)
- **操作:** 行の右クリックまたはアクションメニューで「子要素の追加」「削除」「ノート(Markdown)の編集モーダルを開く」を行う。

### 3.2 📅 Resource Allocation (計画: 期間割当マトリックス)
**目的:** 見積もったPVを、月/週/日単位で割り当てる。
- **UIコンポーネント:** マトリックス（表計算風）UI。
- **レイアウト:**
  - 左側固定列: WBSツリー (Activityのみ表示、または親ノードはReadOnly)。
  - 右側スクロール列: 期間（月/週）。各セルが `pv_allocations` の入力フィールド。
- **バリデーション:** 行ごとの「割り当て合計値」が、`estimated_pv` を超過した場合は警告色（赤）でハイライトする。

### 3.3 ✍️ Execution (実行: 実績・進捗の入力)
**目的:** 日々の稼働時間（AC）と、現在の進捗率（EV）を入力する。
- **UI構成:** 2つのタブ（またはスプリットビュー）で分離。
  1. **Time Tracking (AC):** 日付カレンダーと、その日に作業したActivityごとの入力フォーム（`actual_costs`）。
  2. **Progress Update (EV):** Activity一覧と、現在の進捗率（0-100%のSliderまたはNumberInput）、メモ欄（`progress_updates`）。
- **制約:** 過去のベースライン（`is_draft = false`）を選択している時は、この画面は全体が ReadOnly になる。

### 3.4 📊 EVM Dashboard (分析: EVMチャート)
**目的:** プロジェクトの健全性を可視化する。
- **UIコンポーネント:** Recharts等を用いたチャート描画 + MantineのStatカード。
- **トップ指標 (Stat Cards):**
  - CPI (コスト効率指標), SPI (スケジュール効率指標), BAC (完成時総予算), EAC (完成時予測見積).
- **メインチャート:**
  - 累積Sカーブグラフ (PV, EV, AC の3本線)。横軸は時間、縦軸は工数/コスト。
- **フィルタ:**
  - 特定のマイルストーン単位、または特定のWorkPackage単位で絞り込んでグラフを再描画できる機能。

---

## 4. Component Hierarchy Strategy (コンポーネント分割戦略)

Reactコンポーネントは以下の階層で責務を分割し、再利用性とパフォーマンスを高める。

- **Pages (`/src/pages/`):** ナビゲーションの各メニューに対応するトップレベルコンポーネント。状態（Tauriからのデータフェッチ）の起因となる。
- **Features (`/src/features/`):**
  - `/wbs`: WBSツリーグリッド、ノート編集モーダル等。
  - `/evm`: Sカーブチャート、KPIカード等。
- **Shared UI (`/src/components/`):**
  - ドメイン知識を持たない純粋なUI部品（カスタマイズされたボタン、バッジ、確認ダイアログ等）。
  
