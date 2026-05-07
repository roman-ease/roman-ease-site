/**
 * ローマの生き恥 — うまい店投稿フォーム
 * Google Apps Script
 *
 * 【スクリプトプロパティに設定する値】
 *   OWNER_EMAIL   : 通知・承認メールの送先（自分のメールアドレス）
 *   GITHUB_TOKEN  : GitHub Fine-grained Token（Contents: Read & write）
 *   TOKEN_SECRET  : 任意のランダム文字列（承認リンクの改ざん防止）
 *   SITE_URL      : https://www.roman-ease.com（本番URL）
 *
 * 【スプレッドシートのシート名】
 *   "submissions" という名前のシートを作成してください
 */

// ============================================================
// 設定
// ============================================================
function cfg() {
  const p = PropertiesService.getScriptProperties();
  return {
    ownerEmail:  p.getProperty('OWNER_EMAIL'),
    githubToken: p.getProperty('GITHUB_TOKEN'),
    secret:      p.getProperty('TOKEN_SECRET'),
    siteUrl:     p.getProperty('SITE_URL') || 'https://roman-ease-site.pages.dev',
    repo:        'roman-ease/roman-ease-site',
    branch:      'main',
  };
}

// ============================================================
// Astroフォームからの POST 受信
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // バリデーション
    const required = ['shopName', 'area', 'genre', 'recommendation'];
    for (const key of required) {
      if (!data[key] || !data[key].trim()) {
        return json({ ok: false, error: `${key} は必須です` });
      }
    }

    const submission = {
      shopName:       data.shopName.trim(),
      area:           data.area.trim(),
      genre:          data.genre.trim(),
      recommendation: data.recommendation.trim(),
      submitterName:  (data.submitterName || '匿名').trim() || '匿名',
      siteUrl:        (data.siteUrl || '').trim(),
      submittedAt:    new Date().toISOString(),
    };

    // Sheetsに記録してトークン取得
    const row = saveToSheet(submission);
    const token = makeToken(row);

    // シートにトークンを書き込み
    const sheet = getSheet();
    sheet.getRange(row, getColIndex('token')).setValue(token);

    // 承認メール送信
    sendApprovalEmail(submission, row, token);

    return json({ ok: true });

  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// ============================================================
// 承認 / 却下リンクのハンドラ（メールからのGET）
// ============================================================
function doGet(e) {
  const action = e.parameter.action;
  const row    = parseInt(e.parameter.row, 10);
  const token  = e.parameter.token;

  if (!action || !row || !token) {
    return page('エラー', '不正なリクエストです。');
  }
  if (token !== makeToken(row)) {
    return page('エラー', 'トークンが無効です。');
  }

  const sheet    = getSheet();
  const statusCol = getColIndex('status');
  const status   = sheet.getRange(row, statusCol).getValue();

  if (status !== 'pending') {
    return page('処理済み', 'この投稿はすでに処理済みです。');
  }

  if (action === 'reject') {
    sheet.getRange(row, statusCol).setValue('rejected');
    return page('却下完了', '投稿を却下しました。');
  }

  if (action === 'approve') {
    const submission = getSubmission(row);
    const config     = cfg();
    const result     = commitToGitHub(config, submission);

    if (!result.ok) {
      return page('エラー', `GitHubへの投稿に失敗しました。<br><code>${result.error}</code>`);
    }

    sheet.getRange(row, statusCol).setValue('approved');

    const postUrl = `${config.siteUrl}/posts/${result.slug}/`;
    sendCompletionEmail(config, submission, postUrl);

    return page('投稿完了 🎉',
      `<strong>${submission.shopName}</strong> を投稿しました。<br><br>` +
      `デプロイ完了後（約1分）に公開されます。<br><br>` +
      `<a href="${postUrl}" style="color:#316460;">${postUrl}</a>`
    );
  }

  return page('エラー', '不明なアクションです。');
}

// ============================================================
// GitHub API — Markdownファイルをコミット
// ============================================================
function commitToGitHub(config, s) {
  const date     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const slugBase = s.shopName
    .replace(/[\s　]/g, '-')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~「」【】『』。、・]/g, '')
    .toLowerCase()
    .substring(0, 40) || 'spot';
  const slug     = `${date}-umai-${slugBase}`;
  const filename = `${slug}.md`;

  const lines = [
    '---',
    `title: "${esc(s.shopName)}（${esc(s.area)}）"`,
    `date: ${date}`,
    `categories: ["うまい店"]`,
    `tags: ["${esc(s.area)}", "${esc(s.genre)}"]`,
    '---',
    '',
    `**エリア**: ${s.area}  `,
    `**ジャンル**: ${s.genre}`,
    '',
    s.recommendation,
  ];
  if (s.siteUrl) {
    lines.push('', `**リンク**: [${s.shopName}](${s.siteUrl})`);
  }
  lines.push('', '---', `*投稿者: ${s.submitterName}*`);

  const content = lines.join('\n');
  const encoded = Utilities.base64Encode(content, Utilities.Charset.UTF_8);

  const url = `https://api.github.com/repos/${config.repo}/contents/src/content/posts/${filename}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: {
      Authorization:  `Bearer ${config.githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent':   'roman-ease-gas',
    },
    payload: JSON.stringify({
      message: `post(うまい店): ${s.shopName}（${s.area}）`,
      content: encoded,
      branch:  config.branch,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 201) {
    return { ok: false, error: `HTTP ${code}: ${res.getContentText().substring(0, 200)}` };
  }
  return { ok: true, slug };
}

// ============================================================
// メール送信
// ============================================================
function sendApprovalEmail(submission, row, token) {
  const config      = cfg();
  const webAppUrl   = ScriptApp.getService().getUrl();
  const approveUrl  = `${webAppUrl}?action=approve&row=${row}&token=${encodeURIComponent(token)}`;
  const rejectUrl   = `${webAppUrl}?action=reject&row=${row}&token=${encodeURIComponent(token)}`;

  const html = `
<div style="font-family:sans-serif;max-width:560px;">
  <h2 style="color:#316460;">📮 うまい店 — 新しい投稿</h2>
  <table style="border-collapse:collapse;width:100%;">
    <tr><th style="text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;">店名</th>
        <td style="padding:6px 12px;border:1px solid #c8bea0;">${submission.shopName}</td></tr>
    <tr><th style="text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;">エリア</th>
        <td style="padding:6px 12px;border:1px solid #c8bea0;">${submission.area}</td></tr>
    <tr><th style="text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;">ジャンル</th>
        <td style="padding:6px 12px;border:1px solid #c8bea0;">${submission.genre}</td></tr>
    <tr><th style="text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;">投稿者</th>
        <td style="padding:6px 12px;border:1px solid #c8bea0;">${submission.submitterName}</td></tr>
    ${submission.siteUrl ? `<tr><th style="text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;">URL</th>
        <td style="padding:6px 12px;border:1px solid #c8bea0;"><a href="${submission.siteUrl}">${submission.siteUrl}</a></td></tr>` : ''}
    <tr><th style="text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;">おすすめポイント</th>
        <td style="padding:6px 12px;border:1px solid #c8bea0;white-space:pre-wrap;">${submission.recommendation}</td></tr>
  </table>
  <br>
  <a href="${approveUrl}"
     style="display:inline-block;background:#316460;color:#fff;padding:12px 28px;
            text-decoration:none;border-radius:4px;font-size:15px;margin-right:10px;">
    ✓ 承認して投稿する
  </a>
  <a href="${rejectUrl}"
     style="display:inline-block;background:#888;color:#fff;padding:12px 28px;
            text-decoration:none;border-radius:4px;font-size:15px;">
    ✗ 却下する
  </a>
  <p style="color:#999;font-size:12px;margin-top:16px;">
    このリンクの有効期限はありません。スプレッドシートで「rejected」に変更すると無効化できます。
  </p>
</div>`;

  GmailApp.sendEmail(
    config.ownerEmail,
    `【うまい店投稿】${submission.shopName}（${submission.area}）`,
    '',
    { htmlBody: html }
  );
}

function sendCompletionEmail(config, submission, postUrl) {
  GmailApp.sendEmail(
    config.ownerEmail,
    `【投稿完了】${submission.shopName}（${submission.area}）`,
    '',
    {
      htmlBody: `
<div style="font-family:sans-serif;">
  <h2 style="color:#316460;">✅ 投稿が完了しました</h2>
  <p><strong>${submission.shopName}（${submission.area}）</strong></p>
  <p>デプロイ完了後（約1分）に以下のURLで公開されます。</p>
  <p><a href="${postUrl}" style="color:#316460;">${postUrl}</a></p>
</div>`,
    }
  );
}

// ============================================================
// Sheets ヘルパー
// ============================================================
const SHEET_NAME = 'submissions';
const COLUMNS = ['timestamp', 'shopName', 'area', 'genre', 'recommendation',
                 'submitterName', 'siteUrl', 'token', 'status'];

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getColIndex(name) {
  return COLUMNS.indexOf(name) + 1; // 1-indexed
}

function saveToSheet(submission) {
  const sheet = getSheet();
  const row = [
    new Date(),
    submission.shopName,
    submission.area,
    submission.genre,
    submission.recommendation,
    submission.submitterName,
    submission.siteUrl,
    '',       // token（あとで書き込み）
    'pending',
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function getSubmission(row) {
  const sheet   = getSheet();
  const rowData = sheet.getRange(row, 1, 1, COLUMNS.length).getValues()[0];
  const get     = (col) => rowData[getColIndex(col) - 1];
  return {
    shopName:       get('shopName'),
    area:           get('area'),
    genre:          get('genre'),
    recommendation: get('recommendation'),
    submitterName:  get('submitterName'),
    siteUrl:        get('siteUrl'),
  };
}

// ============================================================
// ユーティリティ
// ============================================================
function makeToken(row) {
  const secret = cfg().secret;
  const bytes  = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${row}:${secret}`,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').substring(0, 40);
}

function esc(str) {
  return String(str).replace(/"/g, '\\"');
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function page(title, body) {
  const html = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>${title} — ローマの生き恥</title>
<style>
  body { font-family: 'EB Garamond', serif; background: #e9debe; color: #1e3030;
         display: flex; justify-content: center; padding: 4rem 1rem; }
  .box { max-width: 480px; text-align: center; }
  h1 { color: #316460; font-size: 1.6rem; margin-bottom: 1rem; }
  a { color: #316460; }
</style></head>
<body><div class="box"><h1>${title}</h1><p>${body}</p></div></body>
</html>`;
  return HtmlService.createHtmlOutput(html).setTitle(title);
}
