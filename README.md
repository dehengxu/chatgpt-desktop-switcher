# ChatGPT Desktop Switcher

ChatGPT.appをプロファイルごとに分離して、複数のログイン環境を同時に起動するmacOS用のデスクトップアプリです。

現時点では自分用のMVPです。プロファイルの作成、起動状態の表示、起動、前面表示、終了ができます。

## 起動

Rustツールチェーンを用意して、リポジトリ直下で実行します。

```sh
cargo run
```

画面上部で `work` や `personal` などのプロファイルを追加し、「起動」を押します。初回は起動したChatGPTウインドウで、そのプロファイルに使うアカウントへログインしてください。

既存のChatGPT環境は `default` として表示されます。既存データの移動や変更は行いません。

追加プロファイルのデータは次へ保存されます。

```text
~/Library/Application Support/ChatGPT Desktop Switcher/profiles/<name>/
├── profile.json
├── gui/
└── cli/
```

ターミナルから扱いやすいように、アプリ起動時に次のシンボリックリンクも作成します。データの正本はApplication Support側です。

```text
~/.chatgpt-desktop-switcher
  -> ~/Library/Application Support/ChatGPT Desktop Switcher
```

ChatGPT.appは、追加プロファイルごとに次の設定を付けて起動します。

- `gui/`：`--user-data-dir`
- `cli/`：`CODEX_HOME`

## 現在の制約

- macOS専用です。
- ChatGPT.appが `/Applications/ChatGPT.app` にある前提です。
- 初回ログインのコールバックが複数インスタンス間で正しく配送されるかは、実際の複数アカウントで確認が必要です。
- アプリの署名、公証、DMG配布はまだ実装していません。
