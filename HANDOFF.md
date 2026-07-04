# ポケットバトル CHAMPIONS — 開発引き継ぎメモ

Claude Code で開発しているブラウザ製ポケモン風対戦ゲーム。このリポジトリ 1 つで開発・公開が完結する。

## 公開URL
https://ohayougohan-droid.github.io/pocket-battle/
（GitHub Pages。`main` に push すると 1〜2 分で自動デプロイ）

## ファイル構成（すべてこのリポジトリ内）
- `index.html` … ゲーム本体。**これ 1 ファイルが本編**（HTML+CSS+JS 全部入り）。開発は基本これを直接編集する。
- `pokedex-extra.js` … 追加ポケモンのデータ（`gen-pokedex.mjs` の生成物）。`window.EXTRA_SPECIES` / `window.EXTRA_ABILITIES` を index.html にマージ。
- `gen-pokedex.mjs` … PokeAPI からポケモンデータを取得して `pokedex-extra.js` を自動生成する Node スクリプト。ポケモンを増やすときは `TARGETS` 配列に追記して `node gen-pokedex.mjs` を実行。
- `sprites/` … ポケモンのアニメGIF（Pokémon Showdown 由来。表 `名前.gif`／裏 `名前-back.gif`）。
- `sw.js` … Service Worker。HTML/JS はネット優先・画像はキャッシュ優先。**更新時は先頭の `pocketbattle-vNN` を上げる**とキャッシュが確実に切り替わる。
- `manifest.json` … PWA 設定（iPhone のホーム画面追加でアプリ化できる）。

## バージョン管理
- `index.html` 内の `const GAME_VER = "vNN"` … タイトル画面に表示。更新のたびに上げる。
- `sw.js` の `pocketbattle-vNN` … 同じ番号に合わせる。

## 開発ワークフロー（このリポジトリをクローンした状態で）
1. `python -m http.server` 等で index.html をローカル表示して動作確認（または VSCode Live Server）。
2. `index.html` を編集。ポケモンを増やすなら `gen-pokedex.mjs` の `TARGETS` に追記 → `node gen-pokedex.mjs`。
3. `GAME_VER` と `sw.js` のキャッシュ番号を上げる。
4. `git add -A && git commit -m "..." && git push` → GitHub Pages が自動更新。

## ゲーム設計メモ
- Lv50 固定。能力ポイント制（合計66・各32まで・1pt=実数値+1、IV31固定）＝ポケモンチャンピオンズ準拠。
- `SPECIES` … ポケモン図鑑。`MOVES` … 技辞書。`ABILITIES` / `ITEMS` / `NATURES`。
- `BUILD_OVERRIDES` … 主要ポケモンの「よくある型」（champs.pokedb.tokyo の使用率データ準拠）。`defMoves` があれば最優先。
- 型データの参照元: https://champs.pokedb.tokyo/ （使用率DB。個体ページは `/pokemon/show/図鑑番号-00?season=3&rule=0`）。
- バトルは 6体編成→3体選出→3対3。通信対戦は PeerJS(WebRTC)。ロックステップ同期（共有シード `battleRandom()`）。
- 実装済み: 天候(晴/雨/砂)、フィールド(エレキ)、状態異常、設置技、積み技、連続技、メガシンカ14形態、多数の特性。

## 未対応 TODO
- ゆき天候、とんぼがえり/ボルトチェンジの交代効果、通信対戦の実機2台検証。

## 検証のコツ
- ローカルのプレビュー用ブラウザが固まることがあるため、ロジック検証は「index.html から `<script>` を抜き出して DOM をスタブ化し node で実行」するヘッドレステストが確実。
