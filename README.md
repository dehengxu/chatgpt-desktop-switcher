# ChatGPT Desktop Switcher

*Read this in other languages: [日本語 (Japanese)](#日本語-japanese)*

ChatGPT Desktop Switcher is a macOS desktop app that launches multiple isolated ChatGPT.app profiles at the same time. Each profile keeps its own login state and Codex data.

This project is currently a personal MVP. It supports creating profiles, showing their running state, launching them, bringing their windows to the front, and stopping them.

## Run

Install the Rust toolchain, then run the following command from the repository root:

```sh
cargo run
```

Enter a profile name such as `work` or `personal`, then click **Launch**. On the first launch, sign in to the account you want to use in that ChatGPT window.

Your existing ChatGPT environment appears as the `default` profile. The app does not move or modify its existing data.

Additional profile data is stored in:

```text
~/Library/Application Support/ChatGPT Desktop Switcher/profiles/<name>/
├── profile.json
├── gui/
└── cli/
```

For convenient terminal access, the app creates the following symbolic link on startup. The Application Support directory remains the canonical data location.

```text
~/.chatgpt-desktop-switcher
  -> ~/Library/Application Support/ChatGPT Desktop Switcher
```

ChatGPT.app is launched with the following per-profile settings:

- `gui/`: passed as `--user-data-dir`
- `cli/`: passed as `CODEX_HOME`

## Current limitations

- macOS only.
- ChatGPT.app must be installed at `/Applications/ChatGPT.app`.
- Login callback behavior with multiple running instances still needs verification with real accounts.
- Code signing, notarization, and DMG distribution are not implemented yet.

## Acknowledgements

The design and project structure were inspired by [Claude Desktop Switcher](https://github.com/matsumotory/claude-desktop-switcher).

---

## 日本語 (Japanese)

*Read this in other languages: [English](#chatgpt-desktop-switcher)*

ChatGPT.appをプロファイルごとに分離して、複数のログイン環境を同時に起動するmacOS用のデスクトップアプリです。プロファイルごとにログイン状態とCodexのデータを分離します。

現時点では自分用のMVPです。プロファイルの作成、起動状態の表示、起動、前面表示、終了ができます。

### 起動

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

### 現在の制約

- macOS専用です。
- ChatGPT.appが `/Applications/ChatGPT.app` にある前提です。
- 初回ログインのコールバックが複数インスタンス間で正しく配送されるかは、実際の複数アカウントで確認が必要です。
- アプリの署名、公証、DMG配布はまだ実装していません。

### 謝辞

本プロジェクトの設計と構成は、[Claude Desktop Switcher](https://github.com/matsumotory/claude-desktop-switcher) を参考にしています。
