# 精算機補助

駐車場での駐車証明発行・精算記録を、スマホで素早く残すためのローカル保存型Webアプリです。

## 起動方法

必要なものは Node.js 18 以上です。

```bash
npm install
npm run dev
```

表示されたURL（通常は `http://localhost:5173`）をブラウザで開きます。

本番ビルドの確認は以下です。

```bash
npm run build
npm run preview
```

## 使い方

1. 「記録」画面で駐車位置番号をタップします。タップ時刻を駐車開始時刻としてタイマーが始まります。番号が見えないときは「番号未入力でタイマー開始」を押します。
2. 証明書を発行したら「証明書発行＋番号入力」をタップします。駐車位置番号の確認シートが開くので、利用者さまから聞いた番号を入力（または1〜21の候補をタップ）してから発行を確定します。開始時の番号が違っていても、この時点で修正できます。
3. 「発行済み・精算待ち」画面で該当レコードの「精算」をタップします。精算時刻が確定します。
4. 例外がある場合は各レコードの「メモ」から定型メモを選択するか、自由メモを入力します。
5. 精算後、お客様の退店が完了したら履歴の「退店完了」を押します。続けて「報告設定」から、通常・入店時証明書未発行・発行不具合・入店時誤操作・未発行＋サービス券・自由入力を選択できます。
6. 「履歴」画面の「LINE用テキストを生成」から、退店完了済みで駐車から証明書発行まで90秒以内の記録だけを報告文にまとめ、「コピー」でクリップボードへコピーできます。90秒超、退店未完了、発行済み・精算待ち、駐車中の記録は含まれません。発行不具合や誤操作を選んだ記録は、例の報告形式で出力されます。
7. 「勤務報告」画面で、2店舗への到着、再起動、水曜・土曜の復旧結果、10:00開始・12:00休憩・15:00再開・18:00終了を記録できます。店舗名は画面右上の設定から端末内だけに保存できます。勤務報告もLINE用に生成・コピーできます。

スマホでは「記録」「発行済み・精算待ち」「履歴」を画面下の固定タブから切り替えます。使用頻度の低い「勤務報告」は、画面上部の日付欄にある小さなリンクから開けます。PCでは従来どおり上部の4タブを使用します。駐車番号ボタンは実際の駐車場配置に合わせ、左側1〜8番・右側21〜9番（11番なし）の2列で表示します。

記録中・発行済み・履歴の各画面にある「編集」「削除」は同じ記録データへ反映されます。記録中・発行済みの番号を変更すると、表示・精算待ち一覧・履歴・LINE用テキストにも反映されます。記録画面の「待ち」「対応中」になっている駐車位置番号をタップすると、その記録の詳細編集ポップアップを開けます。履歴では退店完了時刻とLINE報告パターンも同じ記録へ保存されます。LINE用テキストは履歴画面の精算済み・退店完了済み記録のうち90秒以内だけを対象にします。記録を削除すると表示中の生成済みLINE文面もクリアされ、残った記録で再生成できます。削除は確認ダイアログ付きです。

90秒を超えて証明書を発行した記録は、通常の記録と区別して「90秒超」と表示されます。

### 駐車番号が見えない場合

駐車位置番号が確認できない場合でも、タイマーは止めずに「番号未入力でタイマー開始」を押します。タイマー動作中は「番号未入力 #1」のように表示されるため、複数台を同時に追えます。証明書発行時に利用者さまへ番号を確認して入力すると、その確定番号が発行済み一覧・履歴・LINE報告へ反映されます。通常は番号入力が必須で、どうしても分からない場合だけ「番号不明のまま発行（例外）」を使います。

番号は1〜21以外にも入力できるため、区画の枝番などにも対応できます。過去の記録は従来どおり表示されます。

## ファイル構成

```text
.
├── index.html                 # エントリHTML、PWAメタ情報
├── capacitor.config.ts        # Androidアプリ化用のCapacitor設定
├── package.json               # Vite / Reactの依存関係とスクリプト
├── android/                   # Capacitorが生成するAndroid Studioプロジェクト
├── public/
│   ├── icon.svg               # アプリアイコン
│   ├── manifest.webmanifest   # PWAマニフェスト
│   └── sw.js                  # 最小構成のService Worker
└── src/
    ├── main.jsx               # 画面、駐車記録・番号確定・勤務報告、localStorage、各操作
    └── styles.css             # モバイル優先のUIスタイル
```

Android版では、アプリ更新時に古いWebViewのService Workerキャッシュを削除してから新しい画面を読み込みます。記録本体のlocalStorageは削除しません。

## Android APK化

このプロジェクトはCapacitorでAndroidアプリとしてパッケージできます。Android Studio、Android SDK、JDKがインストール済みの環境で実行してください。

### デバッグAPKを作る

macOSでAndroid Studio付属のJDKを使う場合は、必要に応じて先に環境変数を設定します。

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
```

その後、以下を実行します。

```bash
npm install
npm run android:debug
```

生成物は以下です。

```text
android/app/build/outputs/apk/debug/v0.1.17.apk
```

APK名はAndroidの`versionName`から自動生成されます。次回バージョンを`0.1.18`にすると、`v0.1.18.apk`になります。

Android端末へUSB接続してインストールする場合は、USBデバッグを有効にしてから以下を実行できます。

```bash
adb install -r android/app/build/outputs/apk/debug/v0.1.17.apk
```

### Android Studioで開く

```bash
npx cap open android
```

### Playストア用AAB

署名設定を用意したうえで、以下を実行します。

```bash
npm run android:release
```

生成物は `android/app/build/outputs/bundle/release/app-release.aab` です。公開用にはAndroid StudioまたはGradleでリリース署名を設定してください。署名鍵はリポジトリやREADMEへ保存しないでください。

Capacitor版でも記録データはWebView内のlocalStorageに保存されます。既存のPWA版と同じく端末内保存で、アプリ削除・アプリデータ削除を行うと消える点に注意してください。

## データ保存方法

バックエンドは使用していません。記録はブラウザの `localStorage` に、日付ごとに以下のキーで保存します。

```text
parking-assist-records:YYYY-MM-DD
parking-assist-work:YYYY-MM-DD
```

ページを再読み込みしたりブラウザを閉じたりしても、同じ端末・同じブラウザの保存領域が残っている限り当日の記録を復元できます。ブラウザのサイトデータを削除した場合や別端末では共有されません。

## PWAとしてホーム画面に追加する方法

PWAとして使うには、スマホからアクセスできるHTTPSのURLで配信する必要があります。開発中の `localhost` は同じ端末上での確認に使えます。

公開版URL（GitHub Pages）:

```text
https://aki-labo65.github.io/parking-assist/
```

- iPhone（Safari）: ページを開く → 共有ボタン → 「ホーム画面に追加」 → 追加
- Android（Chrome）: ページを開く → 右上メニュー → 「ホーム画面に追加」または「アプリをインストール」

公開時は `manifest.webmanifest` と `sw.js` を同じドメインで配信してください。Service Workerが登録されると、アプリシェルをキャッシュして通信が一時的に不安定でも画面を開きやすくなります。

## 今後Supabaseなどへ移行する場合の拡張ポイント

- `records` の読み書きを担当する処理を `src/main.jsx` からリポジトリ層へ切り出し、`loadRecords` / `localStorage.setItem` をSupabaseのテーブル操作へ置き換える
- `records` テーブルに `id`, `work_date`, `spot`, `started_at`, `issued_at`, `settled_at`, `exit_completed_at`, `status`, `note_presets`, `memo`, `report_type`, `report_flags`, `report_memo` を持たせる
- 複数スタッフで使う場合はユーザーID・担当者ID・駐車場IDを追加し、Row Level Securityで閲覧範囲を制御する
- 通信が切れた現場向けには、localStorageまたはIndexedDBを一時キューとして残し、通信復旧時に同期する
- LINE送信用テキストは現在クライアントで生成しているため、そのまま継続利用できる。報告履歴を保存する場合だけサーバー側の生成・保存を追加する
