# WordPress → Cloudflare Pages 移行マニュアル

> 作成日: 2026-05-07  
> 対象: レンタルサーバ上のWordPressサイトをCloudflare Pages（静的サイト）へ移行する手順

---

## 目次

1. [この移行でやること（概要）](#1-この移行でやること概要)
2. [使用ツール解説](#2-使用ツール解説)
3. [事前準備](#3-事前準備)
4. [WordPressエクスポートと解析](#4-wordpressエクスポートと解析)
5. [GitHubリポジトリの準備](#5-githubリポジトリの準備)
6. [Astroプロジェクトのセットアップ](#6-astroプロジェクトのセットアップ)
7. [コンテンツ移行](#7-コンテンツ移行)
8. [画像の移行](#8-画像の移行)
9. [ブログ機能の実装](#9-ブログ機能の実装)
10. [Cloudflare Pagesへのデプロイ](#10-cloudflare-pagesへのデプロイ)
11. [旧URLのリダイレクト設定](#11-旧urlのリダイレクト設定)
12. [Sveltia CMSの設定（ブラウザ投稿）](#12-sveltia-cmsの設定ブラウザ投稿)
13. [GAS連携フォームの設定](#13-gas連携フォームの設定)
14. [よくあるエラーと解決策](#14-よくあるエラーと解決策)
15. [カスタムドメインの設定](#15-カスタムドメインの設定)
16. [デザインカスタマイズ](#16-デザインカスタマイズ)
17. [Formsページの構成（ハブ型拡張設計）](#17-formsページの構成ハブ型拡張設計)
18. [検索エンジン対策（noindex）](#18-検索エンジン対策noindex)
19. [RSプラン解約とドメインの扱い](#19-rsプラン解約とドメインの扱い)

---

## 1. この移行でやること（概要）

```
[WordPress（レンタルサーバ）]
        ↓ エクスポート（WXR/XML）
[XMLを解析してコンテンツ・画像を抽出]
        ↓ 変換スクリプト
[Astroプロジェクト（Markdownファイル群）]
        ↓ git push
[GitHub リポジトリ]
        ↓ 自動連携
[Cloudflare Pages（静的サイトとして公開）]
```

### WordPressとの違い

| | WordPress（移行前） | Cloudflare Pages（移行後） |
|--|--------------------|-----------------------------|
| サーバー | PHPが動くレンタルサーバ | CDN（サーバーレス） |
| 記事の保存場所 | MySQLデータベース | GitHubのMarkdownファイル |
| ページ生成 | アクセスのたびにPHPで生成 | ビルド時にすべてHTMLを生成済み |
| 記事投稿 | WordPress管理画面 | Sveltia CMS or git push |
| 費用 | レンタルサーバ代 | **無料**（Cloudflare Pages無料枠） |
| 表示速度 | サーバー性能に依存 | CDN配信で高速 |

### なぜ静的サイトにするのか

WordPressはPHPとDBが必要なため、レンタルサーバが必要。  
個人ブログ程度であれば、あらかじめHTMLを生成しておく「静的サイト」で十分。  
静的サイトはサーバーが不要になるため**無料で高速なCDN（Cloudflare Pages）**で運用できる。

---

## 2. 使用ツール解説

### Astro（アストロ）

**静的サイトジェネレーター**。Markdownファイルや設定をもとに、公開用のHTML/CSS/JSを生成するNode.jsのツール。

```
src/content/posts/2025-01-15-記事タイトル.md  ← 記事をMarkdownで書く
        ↓ npm run build
dist/posts/2025-01-15-記事タイトル/index.html ← HTMLに変換される
```

- **開発サーバー**: `npm run dev` → `http://localhost:4321` でローカルプレビュー
- **ビルド**: `npm run build` → `dist/` フォルダにHTML一式を生成
- **Content Collections**: `src/content/` 以下のMarkdownを型安全に管理する仕組み

### WXR（WordPress eXtended RSS）

WordPressのエクスポート機能が出力するXMLファイル。  
`.xml` 拡張子で、RSS形式を拡張した独自フォーマット。

```xml
<rss version="2.0"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
>
  <channel>
    <title>サイトタイトル</title>
    <wp:category>...</wp:category>   ← カテゴリ定義
    <wp:tag>...</wp:tag>             ← タグ定義
    <item>                           ← 記事1件
      <title>記事タイトル</title>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <content:encoded><![CDATA[
        <!-- wp:paragraph -->
        <p>本文HTML</p>
        <!-- /wp:paragraph -->
      ]]></content:encoded>
    </item>
  </channel>
</rss>
```

**含まれる情報:**
- `<item wp:post_type="post">`: ブログ記事
- `<item wp:post_type="page">`: 固定ページ
- `<item wp:post_type="attachment">`: 画像などのメディアファイルURL
- カテゴリ・タグの定義と階層
- 投稿ステータス（`publish` / `draft` / `private`）

**含まれない情報:**
- 画像ファイル本体（URLのみ記録）→ 別途ダウンロードが必要
- テーマのデザイン・CSSファイル
- プラグインのデータ

### Gutenbergブロック

WordPress 5.0以降のブロックエディタが本文HTMLに埋め込むコメント形式のメタデータ。

```html
<!-- wp:paragraph -->
<p>本文テキスト</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>見出し</h2>
<!-- /wp:heading -->
```

移行時はこのコメントを除去してHTMLに変換し、さらにMarkdownに変換する。

### XMLパース時の名前空間

WXRはXML名前空間を使っているため、通常のDOMパースだけではフィールドを取得できない。

```powershell
# PowerShellでの名前空間指定
$nsmgr = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
$nsmgr.AddNamespace("wp",      "http://wordpress.org/export/1.2/")
$nsmgr.AddNamespace("content", "http://purl.org/rss/1.0/modules/content/")
$nsmgr.AddNamespace("dc",      "http://purl.org/dc/elements/1.1/")

# 名前空間を使ったXPathクエリ
$postType = $item.SelectSingleNode("wp:post_type", $nsmgr).InnerText
$body     = $item.SelectSingleNode("content:encoded", $nsmgr).InnerText
```

```js
// Node.js (@xmldom/xmldom) での名前空間指定
const WP_NS      = 'http://wordpress.org/export/1.2/';
const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';

const postType = item.getElementsByTagNameNS(WP_NS, 'post_type')[0].textContent;
const body     = item.getElementsByTagNameNS(CONTENT_NS, 'encoded')[0].textContent;
```

### Markdown（フロントマター付き）

Astroが記事として読み込む形式。YAMLのメタデータ（frontmatter）+ 本文の2段構成。

```markdown
---
title: "記事タイトル"
date: 2025-01-15
categories: ["日記"]
tags: ["仕事", "愚痴"]
image: /uploads/2025/01/photo.jpg
---

ここから本文。**太字**や# 見出しなどMarkdown記法で書く。
```

### Cloudflare Pages

CloudflareのCDN上で静的ファイルをホスティングするサービス。  
GitHubリポジトリと連携し、`main` ブランチにpushすると自動でビルド・デプロイされる。

```
git push origin main
    ↓ Cloudflare Pagesが検知
    ↓ npm run build を実行
    ↓ dist/ をCDNにデプロイ
    ↓ https://your-site.pages.dev に反映（約1〜2分）
```

---

## 3. 事前準備

### 必要なツール・アカウント

| ツール | 用途 |
|--------|------|
| Node.js v20以上 | Astroのビルド環境 |
| Git | バージョン管理 |
| GitHubアカウント | ソース管理・デプロイ連携 |
| Cloudflareアカウント | ホスティング |
| Google Workspace（任意） | フォーム連携（GAS） |

### ディレクトリ構成

```
プロジェクトルート/
├── docs/                        ← このマニュアルの場所
├── scripts/                     ← 変換スクリプト
│   ├── convert-wp-to-md.mjs    ← WXR→Markdown変換
│   └── umai-form.gs            ← GASスクリプト（フォーム連携）
└── <サイト名>/                  ← Astroプロジェクト
    ├── src/
    │   ├── content/posts/       ← Markdownの記事
    │   ├── components/
    │   ├── layouts/
    │   ├── pages/
    │   └── styles/
    ├── public/
    │   ├── uploads/             ← WordPressからダウンロードした画像
    │   ├── admin/               ← Sveltia CMS管理画面
    │   └── _redirects           ← 旧URLリダイレクト
    └── functions/
        └── oauth/               ← Sveltia CMS用OAuthプロキシ
```

---

## 4. WordPressエクスポートと解析

### エクスポート手順

WordPress管理画面 → ツール → エクスポート → **すべてのコンテンツ** → ダウンロード

出力されるファイル: `WordPress.YYYY-MM-DD.xml`（WXR形式）

### XMLの解析（PowerShell）

```powershell
$xml = [xml](Get-Content "WordPress.YYYY-MM-DD.xml" -Encoding UTF8)
$nsmgr = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
$nsmgr.AddNamespace("wp", "http://wordpress.org/export/1.2/")
$nsmgr.AddNamespace("content", "http://purl.org/rss/1.0/modules/content/")

$allItems = $xml.SelectNodes("//item")

# 種別ごとの件数確認
$typeGroups = @{}
foreach ($item in $allItems) {
    $t = $item.SelectSingleNode("wp:post_type", $nsmgr).InnerText
    if (-not $typeGroups[$t]) { $typeGroups[$t] = 0 }
    $typeGroups[$t]++
}
$typeGroups.GetEnumerator() | Sort-Object Value -Descending

# 添付ファイルURLの一覧
foreach ($item in $allItems) {
    $t = $item.SelectSingleNode("wp:post_type", $nsmgr).InnerText
    if ($t -eq "attachment") {
        $url = $item.SelectSingleNode("wp:attachment_url", $nsmgr).InnerText
        Write-Output $url
    }
}
```

### 確認すべき項目

- [ ] サイトURL・タイトル・言語
- [ ] 投稿数（post）・固定ページ数（page）・添付ファイル数（attachment）
- [ ] カテゴリ・タグの階層構造
- [ ] 使用されているGutenbergブロック種別
- [ ] 非公開・下書き記事の扱い

---

## 5. GitHubリポジトリの準備

```bash
# リポジトリをクローン（または新規作成）
git clone https://github.com/<org>/<repo>.git
cd <repo>
```

> **注意**: プライベートリポジトリの場合、Cloudflare PagesのGitHub App に対してリポジトリへのアクセスを許可すること。  
> GitHub → Settings → Applications → Installed GitHub Apps → Cloudflare Pages → Configure → Repository access

---

## 6. Astroプロジェクトのセットアップ

### package.json

```json
{
  "name": "<site-name>",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "new": "node scripts/new-post.mjs"
  },
  "dependencies": {
    "@astrojs/rss": "^4.x",
    "@astrojs/sitemap": "^3.x",
    "astro": "^5.x"
  }
}
```

### astro.config.mjs

```js
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  site: 'https://your-domain.com',
  integrations: [sitemap()],
});
```

> **注意**: `@astrojs/cloudflare` はWorkersデプロイ用。静的サイトなら**不要**。インポートだけして使わないとビルド警告が出るので削除すること。

### tsconfig.json

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

### .gitignore

```
dist/
node_modules/
.astro/
.env
.env.*
!.env.example
```

---

## 7. コンテンツ移行

### WXR → Markdown 変換スクリプト

`scripts/convert-wp-to-md.mjs` を実行して公開済み記事をMarkdownに変換する。

```bash
npm install @xmldom/xmldom --save-dev
node scripts/convert-wp-to-md.mjs
```

### 変換のポイント

- Gutenbergブロックコメント（`<!-- wp:xxx -->`）は**非欲張りマッチ**で除去  
  `html.replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '')`  
  ※ `[^>]*` ではJSONに含まれる `>` でマッチが途切れるので注意

- 日本語スラッグはURLデコードして使用
- frontmatterのフィールド: `title`, `date`, `categories`, `tags`, `draft`, `image`, `description`

### content/config.ts

```ts
import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    image: z.string().optional(),      // アイキャッチ画像
    description: z.string().optional(), // OGP・RSS用
  }),
});

export const collections = { posts };
```

### 変換後の確認

- HTMLタグの残骸がないか確認: `</li>`, `</ul>`, `<li>` など
- ネストしたリストは変換が崩れやすいので目視確認

---

## 8. 画像の移行

### WordPressサーバーからの一括ダウンロード（PowerShell）

```powershell
$baseUrl = "https://your-wp-site.com/wp-content/uploads/"
$outBase = ".\<astro-project>\public\uploads"

foreach ($url in $urls) {
    $relativePath = $url.Substring($baseUrl.Length)
    $localPath = Join-Path $outBase $relativePath
    $dir = Split-Path $localPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Invoke-WebRequest -Uri $url -OutFile $localPath -TimeoutSec 30
}
```

ディレクトリ構造: `public/uploads/YYYY/MM/ファイル名` （WordPress と同じ構造を維持）

### 記事内URLの書き換え

```powershell
$files = Get-ChildItem "src\content\posts" -Filter "*.md"
foreach ($f in $files) {
    $content = Get-Content $f.FullName -Raw -Encoding UTF8
    $newContent = $content -replace 'https://your-wp-site\.com/wp-content/uploads/', '/uploads/'
    Set-Content $f.FullName $newContent -Encoding UTF8 -NoNewline
}
```

---

## 9. ブログ機能の実装

### 実装すべき機能チェックリスト

- [ ] 記事一覧（index.astro）
- [ ] 記事詳細（posts/[slug].astro）
- [ ] カテゴリページ（category/[cat].astro）
- [ ] タグページ（tag/[tag].astro）
- [ ] ページネーション（page/[page].astro）
- [ ] RSSフィード（rss.xml.ts）
- [ ] サイトマップ（@astrojs/sitemap）
- [ ] OGP・Twitter Cardメタタグ（BaseLayout）
- [ ] 目次コンポーネント（3見出し以上で表示）
- [ ] 前後記事ナビ
- [ ] アイキャッチ画像（image frontmatter）
- [ ] カスタム404ページ
- [ ] 新記事作成スクリプト（scripts/new-post.mjs）

### 共通コンポーネント

```
src/components/
├── PostList.astro      ← 記事一覧（サムネイル対応）
├── Pagination.astro    ← ページネーション
└── TableOfContents.astro ← 目次
```

### ページネーションの注意点

`getStaticPaths` 内で使う定数は関数の**外側**ではなく**内側**で定義すること。

```js
// NG: 外側で定義するとビルドエラー
const POSTS_PER_PAGE = 10;
export async function getStaticPaths() { ... }

// OK: 内側で定義
export async function getStaticPaths() {
  const POSTS_PER_PAGE = 10;
  ...
}
```

### RSSフィード

```ts
// src/pages/rss.xml.ts
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'サイトタイトル',
    description: 'サイト説明',
    site: context.site,
    items: posts.map(post => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: `/posts/${post.slug}/`,
    })),
    customData: '<language>ja</language>',
  });
}
```

---

## 10. Cloudflare Pagesへのデプロイ

### ⚠️ 重要：PagesとWorkerの違い

Cloudflareには **Pages**（静的サイト）と **Workers**（サーバーサイド）の2種類がある。  
静的Astroサイトは必ず **Pages** として作成すること。

| | Pages | Workers |
|--|-------|---------|
| 用途 | 静的サイト・SPAホスティング | サーバーサイド処理 |
| デプロイコマンド | **不要**（ビルド後に自動デプロイ） | `npx wrangler deploy` |
| ドメイン | `*.pages.dev` | `*.workers.dev` |

### Pagesプロジェクトの作成手順

1. Cloudflareダッシュボード → Workers & Pages → **アプリケーションを作成する**
2. **「Pages を導入しようとお考えですか？始める」** のリンクをクリック（← ここが紛らわしい）
3. **既存の Git リポジトリをインポートする** → 始める
4. GitHubリポジトリを選択

### ビルド設定

| 項目 | 値 |
|------|-----|
| フレームワーク プリセット | Astro |
| ビルドコマンド | `npm run build` |
| ビルド出力ディレクトリ | `dist` |
| デプロイコマンド | **空欄**（Pagesは不要） |

### 環境変数

| 変数名 | 値 |
|--------|-----|
| `NODE_VERSION` | `20` |

> **デプロイコマンドは空欄にする。** `npx wrangler pages deploy dist` はCI外部からデプロイする場合のコマンドであり、Pages GitHub連携では不要。入力するとAPIトークン認証エラーになる。

---

## 11. 旧URLのリダイレクト設定

`public/_redirects` ファイルを作成。Cloudflare Pagesが自動で読み込む。

```
# WordPress旧URL → 新URL
/旧スラッグ/ /posts/新スラッグ/ 301
/another-post/ /posts/2025-01-15-another-post/ 301
```

### WordPressスラッグから新URLへのマッピング（PowerShell自動生成）

```powershell
$xml = [xml](Get-Content "WordPress.xml" -Encoding UTF8)
# ... XMLパース処理
# スラッグをURLデコードして対応するAstroのファイル名と紐付け
```

---

## 12. Sveltia CMSの設定（ブラウザ投稿）

スマホ含めブラウザから記事投稿できるCMS。`/admin/` に配置。

### ファイル構成

```
public/admin/
├── index.html   ← Sveltia CMS読み込み
└── config.yml   ← コレクション・フィールド定義
```

### index.html

```html
<!doctype html>
<html lang="ja">
<head><meta charset="utf-8" /><title>管理画面</title></head>
<body>
  <script src="https://unpkg.com/@sveltia/cms/dist/sveltia-cms.js" type="module"></script>
</body>
</html>
```

### config.yml（GitHub OAuthプロキシ使用時）

```yaml
backend:
  name: github
  repo: <org>/<repo>
  branch: main
  base_url: https://<your-site>.pages.dev
  auth_endpoint: oauth   # Pages Functionsで実装したOAuthプロキシ

media_folder: public/uploads/{{year}}/{{month}}
public_folder: /uploads/{{year}}/{{month}}
locale: ja
```

> **⚠️ PKCEは使用不可**: GitHubはOAuth AppのPKCE認証を現時点でサポートしていない。  
> `auth_type: pkce` を設定しても `CMS設定に問題が見つかりました` エラーになる。  
> 代わりにPages FunctionsでOAuthプロキシを実装する（後述）。

### GitHub OAuth Appの作成

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://<your-site>.pages.dev/oauth/callback`
3. Client ID と Client Secret を取得

### OAuthプロキシ（Pages Functions）

```
functions/oauth/
├── index.js      → GET /oauth/?provider=github → GitHubへリダイレクト
└── callback.js   → GET /oauth/callback → トークン取得・CMSへ返却
```

```js
// functions/oauth/index.js
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('provider') !== 'github') {
    return new Response('Unsupported provider', { status: 400 });
  }
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', (env.GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID').trim());
  authUrl.searchParams.set('scope', 'repo,user');
  authUrl.searchParams.set('redirect_uri', `${url.origin}/oauth/callback`);
  return Response.redirect(authUrl.toString());
}
```

```js
// functions/oauth/callback.js
export async function onRequestGet({ request, env }) {
  const code = new URL(request.url).searchParams.get('code');
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id:     (env.GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID').trim(),
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await tokenRes.json();
  const message = `authorization:github:success:${JSON.stringify({ token: data.access_token, provider: 'github' })}`;
  return new Response(
    `<script>(function(){function r(e){window.opener.postMessage(${JSON.stringify(message)},e.origin);window.close();}window.addEventListener('message',r,false);window.opener.postMessage('authorizing:github','*');})()</script>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
```

### Cloudflare Pages 環境変数

| 変数名 | 値 | 種別 |
|--------|-----|------|
| `GITHUB_CLIENT_ID` | OAuthアプリのClient ID | Plaintext |
| `GITHUB_CLIENT_SECRET` | OAuthアプリのClient Secret | **Secret** |

> **⚠️ 環境変数に末尾スペースが入ると認証失敗する。**  
> GitHub OAuth `authorize` エンドポイントで404になる場合、URL中の `client_id=XXXX+` のように `+` が付いていたら末尾スペースが原因。  
> `.trim()` で対処するか、環境変数を入力し直す。

---

## 13. GAS連携フォームの設定

フォーム投稿 → オーナーにメール → 承認クリック → GitHubへ記事コミット → 自動デプロイ のフロー。

### 必要なもの

- Google Spreadsheet（スクリプトのコンテナ）
- GAS Web App（スプレッドシートから「拡張機能 → Apps Script」）
- Google Drive フォルダ（画像の一時保存）
- GitHub Fine-grained Token（Contents: Read & write）

### GASスクリプトプロパティ

| プロパティ | 値 |
|-----------|-----|
| `OWNER_EMAIL` | 通知メール送先 |
| `GITHUB_TOKEN` | GitHub Fine-grained Token |
| `TOKEN_SECRET` | 任意のランダム文字列 |
| `SITE_URL` | `https://your-domain.com` |
| `DRIVE_FOLDER_ID` | 画像保存DriveフォルダID |

### GAS Web Appのデプロイ設定

| 項目 | 値 |
|------|-----|
| 次のユーザーとして実行 | 自分 |
| アクセスできるユーザー | 全員 |

### フォームからGAS Web Appへの送信

```js
// Astroフォーム側（mode: 'no-cors' で CORS回避）
await fetch(GAS_URL, {
  method: 'POST',
  mode: 'no-cors',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify(formData),
});
```

### 画像の流れ

```
ブラウザ（base64変換）→ GAS doPost（Driveに保存）→ 承認後にGitHub APIでアップロード → /public/uploads/YYYY/MM/
```

---

## 14. よくあるエラーと解決策

### Cloudflare Pages

| エラー | 原因 | 解決策 |
|--------|------|--------|
| `Must specify a project name` | デプロイコマンドに `--project-name` なし | `npx wrangler pages deploy dist --project-name <name>` または**デプロイコマンドを空欄に** |
| `Authentication error [code: 10000]` | APIトークンに `Cloudflare Pages: Edit` 権限なし | トークンに権限を追加 |
| 設定変更後も反映されない | 環境変数変更後の再デプロイ未実施 | Retry deployment を実行 |

### Sveltia CMS / GitHub OAuth

| エラー | 原因 | 解決策 |
|--------|------|--------|
| `CMS設定に問題が見つかりました（PKCE非対応）` | `auth_type: pkce` を設定している | Pages FunctionsでOAuthプロキシを実装 |
| GitHub OAuth で404 | `client_id` 不正（末尾スペースなど） | URLに `client_id=XXX+` があれば末尾スペースが原因。`.trim()` を追加 |
| ポップアップで `Not Found` | OAuth AppのCallback URLが未設定 | GitHub OAuth App → Authorization callback URL を設定 |

### Astro ビルド

| エラー | 原因 | 解決策 |
|--------|------|--------|
| `XXX is not defined` in getStaticPaths | モジュールスコープの変数をgetStaticPaths内で参照 | 定数をgetStaticPaths**内部**で定義する |
| Gutenbergコメントが残る | `[^>]*` でJSONの `>` にマッチが途切れる | `[\s\S]*?` 非欲張りマッチを使用 |

### GAS

| エラー | 原因 | 解決策 |
|--------|------|--------|
| `myFunction を実行しようとしましたが、削除されました` | エディタの関数選択が古いまま | ドロップダウンで実行したい関数を選択してから実行 |
| メールが届かない / submissionsシートが作られない | スクリプトプロパティ未設定でエラーになり途中終了 | `testDoPost` 関数でプロパティを1つずつ確認 |
| `Invalid argument: id` | `DRIVE_FOLDER_ID` が未設定（null） | スクリプトプロパティに `DRIVE_FOLDER_ID` を追加 |
| doPostは完了しているがメールが来ない | スクリプトをスタンドアロンで作成（スプシに紐付いていない） | スプレッドシート「拡張機能 → Apps Script」からスクリプトを作成し直す |

---

## 15. カスタムドメインの設定

Cloudflare Pagesのデプロイ完了後、`*.pages.dev` から独自ドメインへ切り替える。

### 手順

1. Workers & Pages → プロジェクト → **カスタム ドメイン** タブ → `カスタムドメインを設定する`
2. `www.roman-ease.com` を入力
3. ドメインがCloudflare DNS管理下なら**CNAMEレコードが自動作成**されアクティブになる（数分〜数時間）

### カスタムドメイン設定後の更新箇所

| ファイル | 変更内容 |
|---------|---------|
| `public/admin/config.yml` | `base_url` を `pages.dev` → カスタムドメインへ |
| `functions/oauth/index.js` | `redirect_uri` をカスタムドメインへ固定 |
| GitHub OAuth App | Authorization callback URL をカスタムドメインの `/oauth/callback` へ変更 |
| GAS スクリプトプロパティ | `SITE_URL` をカスタムドメインへ更新 |

---

## 16. デザインカスタマイズ

### 背景テクスチャ

元WordPressテーマ（lowfi-wpcom）の `texture.png` を流用するのが最も確実。

```
# テーマのtexture.pngを取得
Invoke-WebRequest -Uri "https://元サイト/wp-content/themes/lowfi-wpcom/assets/images/texture.png" `
  -OutFile "public/texture.png"
```

CSS:
```css
body {
  background-color: #e9debe;
  background-image: url('/texture.png');
  background-size: auto;
}
```

### フォント構成

| 用途 | フォント |
|------|---------|
| サイトタイトル・記事タイトル・見出し | Kaisei Decol（装飾的明朝体） |
| 本文・ナビ | Kaisei Tokumin（読みやすい明朝体） |
| メタ情報・UI要素 | Inter（サンセリフ） |

```css
@import url('https://fonts.googleapis.com/css2?family=Kaisei+Decol:wght@400;700&family=Kaisei+Tokumin:wght@400;500&family=Inter:wght@400;500&display=swap');

:root {
  --serif: 'Kaisei Tokumin', Georgia, serif;
  --decol: 'Kaisei Decol', serif;
  --sans:  'Inter', system-ui, sans-serif;
}
```

### レイアウト

- **固定幅**: `max-width: 680px; width: 100%;`（スマホでは画面幅に収まり横スクロールなし）
- **セパレータ**: `✦ ◆ ✦` + グラデーションライン

### 記事一覧カード

```css
.post-list-item {
  background: rgba(255, 252, 244, 0.65);
  border: 1px solid var(--rule);
  border-radius: 5px;
  transition: box-shadow 0.2s, transform 0.2s;
}
.post-list-item:hover {
  box-shadow: 0 3px 12px rgba(49,100,96,0.1);
  transform: translateY(-1px);
}
```

### シンタックスハイライト

`astro.config.mjs` に追加するだけで有効化（Shiki使用）:

```js
export default defineConfig({
  markdown: {
    shikiConfig: { theme: 'github-light', wrap: true },
  },
});
```

---

## 17. Formsページの構成（ハブ型拡張設計）

複数フォームの追加を想定した階層構造。

```
/forms/              ← ハブページ（カード一覧）
/forms/umai/         ← うまい店投稿フォーム
/forms/kaoty/25s/    ← KAOTY 25s' ノミネートフォーム
/forms/kaoty/26s/    ← （翌年コピーして追加）
```

### フォームの追加手順

**1. `forms/index.astro` の `forms` 配列にカードを追加**

```js
const forms = [
  { title: 'うまい店フォーム', description: '...', href: '/forms/umai/', emoji: '🍜' },
  { title: 'KAOTY 25s\'',     description: '...', href: '/forms/kaoty/25s/', emoji: '🏆' },
  // ここに追加
];
```

**2. 対応するページファイルを作成**

```
src/pages/forms/新フォーム名.astro
```

### KAOTYフォームの年度複製手順

1. `forms/kaoty/25s.astro` を `26s.astro` にコピー
2. props の `season` / `title` / `description` / `period` を書き換える
3. `forms/index.astro` に新カードを追加
4. GASはそのまま（`kaoty_26s` シートが自動作成される）

```astro
<!-- 変更箇所はここだけ -->
<KaotyForm
  season="26s"
  title="🏆 KAOTY 26s' ノミネート"
  description="2026年放映アニメの中から..."
  period="2026/10/01 〜 2027/03/31"
  maxNominations={3}
/>
```

### GAS集計コマンド（KAOTY）

GASエディタで手動実行:

```javascript
tallyKaoty('25s');  // → kaoty_25s_tally シートに集計結果を出力
```

---

## 18. 検索エンジン対策（noindex）

身内向けブログなど検索エンジンにインデックスされたくない場合の設定。

### robots.txt

`public/robots.txt` を作成:

```
User-agent: *
Disallow: /
```

### meta robots タグ

`BaseLayout.astro` の `<head>` に追加:

```html
<meta name="robots" content="noindex, nofollow" />
```

### サイトマップの無効化

noindex と矛盾するため `@astrojs/sitemap` を外す:

```js
// astro.config.mjs
export default defineConfig({
  integrations: [],  // sitemapを除外
});
```

> **注意**: `robots.txt` はあくまでクローラーへの「お願い」。悪意あるクローラーは無視する。完全非公開が必要な場合は Cloudflare Access でアクセス制限をかける。

---

## 19. RSプラン解約とドメインの扱い

### 解約前の確認チェックリスト

- [ ] RSプラン上で稼働している他のサービスがないか確認
- [ ] ドメインの継続手段を確保済みか（先に設定してから解約）
- [ ] メール設定が独立して動作しているか確認

### ドメイン継続の選択肢

RSプランに「ドメイン永久無料」特典が含まれている場合、**解約前に必ずドメインの有料継続設定を行うこと**。

| 選択肢 | 手順 | 年額目安 |
|--------|------|---------|
| **お名前.comで継続** | 自動更新をONにしてクレカ登録 | 約¥1,800〜2,000 |
| **Cloudflare Registrarへ移管** | 移管ロック解除→Auth Code取得→CF側で移管申請 | 約¥1,500（原価） |

### 解約の順番（重要）

```
① ドメイン継続設定を完了
        ↓
② ドメインが正常に継続されることを確認
        ↓
③ RSプラン解約
```

**この順番を逆にするとドメインが失効するリスクあり。**

---

## 参考：本プロジェクトの構成情報（最終状態）

- サイト: ローマの生き恥（`roman-ease.com`）
- リポジトリ: `roman-ease/roman-ease-site`
- 本番URL: `https://www.roman-ease.com`（Cloudflare Pages）
- テーマ: ベージュ(`#e9debe`) × ヴェルデグリ(`#316460`)、max-width 680px
- フォント: Kaisei Decol（タイトル・見出し）+ Kaisei Tokumin（本文）+ Inter（UI）
- 検索エンジン: noindex設定済み（身内向け非公開運用）

### コスト比較

| 項目 | 移行前 | 移行後 |
|------|--------|--------|
| Webホスティング | RSプラン ¥1,911/月 | Cloudflare Pages 無料 |
| ドメイン | RSプラン込み（無料） | 単体継続 約¥1,800/年 |
| メール | Google Workspace（別途） | Google Workspace（変わらず） |
| **合計（年換算）** | **¥22,932+** | **約¥1,800** |
| **年間削減額** | | **約¥21,100** |
