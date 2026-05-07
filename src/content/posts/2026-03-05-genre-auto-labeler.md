---
title: Genre Auto Labeler
date: 2026-03-05
categories:
  - 技術
  - 日記
tags:
  - Antigravity
  - DJ
  - 開発
image: https://github.com/roman-ease/roman-ease-site/blob/main/public/uploads/2026/03/661d5558b47597a7dfd6ff69a0347e67-1.jpg?raw=true
description: ''
---

## はじめに

みなさんお久しぶりです。去年の10月から更新をサボりにサボり年も明けてもう3月です。あ、あけましておめでとうございます。

私の近況としましては昨年12月に引っ越したり、年明けて1月には人生2回目のDJを回したりと色々やってました。2月は解放された快感から一生カードショップに潜ってEDHしまくったり。さて3月は何をしたのかというとMac用のツール作ってました。

***

## Google Antigravity

みなさんは「Google Antigravity」というツールをご存知でしょうか。これはGoogleが出してるAI機能付きのVScodeです。VScodeはマイクロソフトの出してるコード書いたりするエディタと呼ばれるいわゆる高機能なメモ帳です。

件のAntigravityですが、画面の左っかわにあるチャットに「こういうアプリ作って～」と要件を投げたらなんと全自動でそれを作ってくれる夢のようなツールです。

![](https://github.com/roman-ease/roman-ease-site/blob/main/public/uploads/2026/03/661d5558b47597a7dfd6ff69a0347e67-1.jpg?raw=true)

![](https://github.com/roman-ease/roman-ease-site/blob/main/public/uploads/2026/03/f489ca1a72bae94c20c76320de3c168d.jpg?raw=true)

### Genre更新ルール

- 既存ジャンルは**必ず維持**（消しません）
- AI推定ジャンルを最大3枠に収まる範囲で追記
- 区切り文字は `"/"` に統一
- 例: 既存 `"Rock"` + AI推定 `"Blues", "Pop"` → `"Rock/Blues/Pop"`

### ロールバック（元に戻す）

1. 「実行履歴」タブを開く
2. 戻したい実行の「↩ 戻す」ボタンをクリック
3. 確認ダイアログで「ロールバック実行」をクリック

***

## あとがき

という感じでこんなツールを作ってみました。<br>これのお陰で信じられないくらいインテリジェントプレイリスト作りが捗っております。

ご利用**に際しては、各自の環境でビルドしていただく形になります。**

あくまで「自分のMacで動けばOK」という超個人的な動機で、Antigravityという相棒に丸投げして作ったものです。そのため、不具合報告をいただいても「ごめん、わからん！」としか答えられないのが現状です。

動作保証はありませんが、インテリジェントプレイリストの精度に革命を起こしたい方は、ぜひフォークして自分好みに改造してみてください。
