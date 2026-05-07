/**
 * ローマの生き恥 — うまい店投稿フォーム
 * Google Apps Script
 *
 * 【スクリプトプロパティに設定する値】
 *   OWNER_EMAIL      : 通知・承認メールの送先
 *   GITHUB_TOKEN     : GitHub Fine-grained Token（Contents: Read & write）
 *   TOKEN_SECRET     : 任意のランダム文字列（改ざん防止）
 *   SITE_URL         : https://www.roman-ease.com
 *   DRIVE_FOLDER_ID  : 画像を保存するGoogle DriveフォルダのID
 *                      （フォルダURLの /folders/XXXX の部分）
 *
 * 【スプレッドシート】
 *   "submissions" という名前のシートが自動作成されます
 */

// ============================================================
// 設定
// ============================================================
function cfg() {
  const p = PropertiesService.getScriptProperties();
  return {
    ownerEmail:    p.getProperty('OWNER_EMAIL'),
    githubToken:   p.getProperty('GITHUB_TOKEN'),
    secret:        p.getProperty('TOKEN_SECRET'),
    siteUrl:       p.getProperty('SITE_URL') || 'https://roman-ease-site.pages.dev',
    driveFolderId: p.getProperty('DRIVE_FOLDER_ID'),
    repo:          'roman-ease/roman-ease-site',
    branch:        'main',
  };
}

// ============================================================
// POST受信（Astroフォームから送信）
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // フォーム種別で振り分け
    if (data.type === 'kaoty') return handleKaoty(data);

    // バリデーション（うまい店フォーム）
    for (const key of ['shopName', 'area', 'recommendation']) {
      if (!data[key] || !String(data[key]).trim()) {
        return json({ ok: false, error: `${key} は必須です` });
      }
    }

    const config = cfg();

    // 画像をDriveに保存
    const imageFiles = saveImagesToDrive(config, data);

    const submission = {
      shopName:       String(data.shopName).trim(),
      area:           String(data.area).trim(),
      genre:          Array.isArray(data.genre) ? data.genre.join('、') : String(data.genre || '').trim(),
      recommendation: String(data.recommendation).trim(),
      budget:         String(data.budget || '不明').trim(),
      link:           String(data.link || '').trim(),
      submitterName:  String(data.submitterName || '匿名').trim() || '匿名',
      submittedAt:    new Date().toISOString(),
      imageFiles:     imageFiles, // [{ driveId, name, mimeType }]
    };

    const row   = saveToSheet(submission);
    const token = makeToken(row);
    getSheet().getRange(row, getColIndex('token')).setValue(token);

    sendApprovalEmail(config, submission, row, token, imageFiles);

    return json({ ok: true });

  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err.message });
  }
}

// ============================================================
// GET受信（メールの承認/却下リンク）
// ============================================================
function doGet(e) {
  const action = e.parameter.action;
  const row    = parseInt(e.parameter.row, 10);
  const token  = e.parameter.token;

  if (!action || !row || !token) return page('エラー', '不正なリクエストです。');
  if (token !== makeToken(row))  return page('エラー', 'トークンが無効です。');

  const sheet     = getSheet();
  const statusCol = getColIndex('status');
  const status    = sheet.getRange(row, statusCol).getValue();

  if (status !== 'pending') return page('処理済み', 'この投稿はすでに処理済みです。');

  if (action === 'reject') {
    sheet.getRange(row, statusCol).setValue('rejected');
    return page('却下完了', '投稿を却下しました。');
  }

  if (action === 'approve') {
    const config     = cfg();
    const submission = getSubmission(row);
    const imageFiles = submission.imageFiles;

    // Drive画像 → GitHubにアップロード → パスを取得
    const imagePaths = uploadImagesToGitHub(config, imageFiles, submission);

    const result = commitArticleToGitHub(config, submission, imagePaths);
    if (!result.ok) return page('エラー', `GitHubへの投稿に失敗しました。<br><code>${result.error}</code>`);

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
// Driveに画像を保存
// ============================================================
function saveImagesToDrive(config, data) {
  if (!data.images || !Array.isArray(data.images) || data.images.length === 0) return [];

  const parentFolder = DriveApp.getFolderById(config.driveFolderId);
  const date         = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  const folderName   = `${date}_${sanitize(data.shopName).substring(0, 20)}`;
  const folder       = parentFolder.createFolder(folderName);

  return data.images.map(img => {
    const bytes = Utilities.base64Decode(img.data);
    const blob  = Utilities.newBlob(bytes, img.mimeType, img.name);
    const file  = folder.createFile(blob);
    // 承認後に画像URLで参照できるよう公開設定
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { driveId: file.getId(), name: img.name, mimeType: img.mimeType };
  });
}

// ============================================================
// GitHubに画像をアップロード（public/uploads/YYYY/MM/）
// ============================================================
function uploadImagesToGitHub(config, imageFiles, submission) {
  if (!imageFiles || imageFiles.length === 0) return [];

  const date  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM');
  const paths = [];

  imageFiles.forEach((img, i) => {
    try {
      const file  = DriveApp.getFileById(img.driveId);
      const blob  = file.getBlob();
      const bytes = blob.getBytes();
      const b64   = Utilities.base64Encode(bytes);

      // 重複しないファイル名を生成
      const ext       = img.name.split('.').pop() || 'jpg';
      const base      = sanitize(submission.shopName).substring(0, 20);
      const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmss');
      const filename  = `${timestamp}_${base}_${i + 1}.${ext}`;
      const ghPath    = `public/uploads/${date}/${filename}`;

      const res = UrlFetchApp.fetch(
        `https://api.github.com/repos/${config.repo}/contents/${ghPath}`,
        {
          method: 'put',
          headers: {
            Authorization:  `Bearer ${config.githubToken}`,
            'Content-Type': 'application/json',
            'User-Agent':   'roman-ease-gas',
          },
          payload: JSON.stringify({
            message: `upload image: ${filename}`,
            content: b64,
            branch:  config.branch,
          }),
          muteHttpExceptions: true,
        }
      );

      if (res.getResponseCode() === 201) {
        paths.push(`/uploads/${date}/${filename}`);
      } else {
        console.error(`Image upload failed: ${res.getContentText().substring(0, 200)}`);
        // Driveのフォールバックを使用
        paths.push(`https://drive.google.com/uc?id=${img.driveId}&export=view`);
      }
    } catch (err) {
      console.error(`Image error: ${err.message}`);
    }
  });

  return paths;
}

// ============================================================
// GitHubにMarkdown記事をコミット
// ============================================================
function commitArticleToGitHub(config, s, imagePaths) {
  const date     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const slugBase = sanitize(s.shopName).substring(0, 30) || 'spot';
  const slug     = `${date}-umai-${slugBase}`;
  const filename = `${slug}.md`;

  const imageMarkdown = imagePaths.map(p => `![${s.shopName}](${p})`).join('\n\n');

  const genres = s.genre ? s.genre.split('、').map(g => `"${esc(g)}"`).join(', ') : '';
  const areas  = s.area ? `"${esc(s.area)}"` : '';

  // 1枚目をアイキャッチ（OGP・記事一覧サムネイルにも使用）
  const eyecatch = imagePaths.length > 0 ? imagePaths[0] : '';
  // 2枚目以降を本文に掲載
  const bodyImages = imagePaths.slice(1).map(p => `![${s.shopName}](${p})`).join('\n\n');

  const lines = [
    '---',
    `title: "${esc(s.shopName)}（${esc(s.area)}）"`,
    `date: ${date}`,
    `categories: ["うまい店"]`,
    `tags: [${[areas, genres].filter(Boolean).join(', ')}]`,
    eyecatch ? `image: "${eyecatch}"` : null,
    '---',
    '',
    `**エリア**: ${s.area}  `,
    `**ジャンル**: ${s.genre || '—'}  `,
    `**予算**: ${s.budget || '—'}`,
    '',
    s.recommendation,
  ].filter(l => l !== null);

  if (s.link) {
    lines.push('', `**リンク**: [${s.shopName}](${s.link})`);
  }

  if (bodyImages) {
    lines.push('', bodyImages);
  }

  lines.push('', '---', `*投稿者: ${s.submitterName}*`);

  const content = lines.join('\n');
  const encoded = Utilities.base64Encode(content, Utilities.Charset.UTF_8);

  const res = UrlFetchApp.fetch(
    `https://api.github.com/repos/${config.repo}/contents/src/content/posts/${filename}`,
    {
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
    }
  );

  const code = res.getResponseCode();
  if (code !== 201) {
    return { ok: false, error: `HTTP ${code}: ${res.getContentText().substring(0, 300)}` };
  }
  return { ok: true, slug };
}

// ============================================================
// メール送信
// ============================================================
function sendApprovalEmail(config, submission, row, token, imageFiles) {
  const webAppUrl  = ScriptApp.getService().getUrl();
  const approveUrl = `${webAppUrl}?action=approve&row=${row}&token=${encodeURIComponent(token)}`;
  const rejectUrl  = `${webAppUrl}?action=reject&row=${row}&token=${encodeURIComponent(token)}`;

  // Drive画像のサムネイルHTML
  const thumbHtml = imageFiles.map(f =>
    `<img src="https://drive.google.com/thumbnail?id=${f.driveId}&sz=w300"
          style="max-width:300px;margin:4px;border-radius:4px;" />`
  ).join('\n');

  const html = `
<div style="font-family:sans-serif;max-width:580px;">
  <h2 style="color:#316460;">📮 うまい店 — 新しい投稿</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
    <tr><th style="${thStyle()}">店舗名</th><td style="${tdStyle()}">${submission.shopName}</td></tr>
    <tr><th style="${thStyle()}">場所</th><td style="${tdStyle()}">${submission.area}</td></tr>
    <tr><th style="${thStyle()}">ジャンル</th><td style="${tdStyle()}">${submission.genre || '—'}</td></tr>
    <tr><th style="${thStyle()}">予算</th><td style="${tdStyle()}">${submission.budget || '—'}</td></tr>
    <tr><th style="${thStyle()}">投稿者</th><td style="${tdStyle()}">${submission.submitterName}</td></tr>
    ${submission.link ? `<tr><th style="${thStyle()}">リンク</th><td style="${tdStyle()}"><a href="${submission.link}">${submission.link}</a></td></tr>` : ''}
    <tr><th style="${thStyle()}">おすすめポイント</th><td style="${tdStyle()};white-space:pre-wrap;">${submission.recommendation}</td></tr>
  </table>
  ${thumbHtml ? `<div style="margin-bottom:16px;">${thumbHtml}</div>` : ''}
  <a href="${approveUrl}" style="${btnStyle('#316460')}">✓ 承認して投稿する</a>
  <a href="${rejectUrl}"  style="${btnStyle('#888')}">✗ 却下する</a>
  <p style="color:#999;font-size:11px;margin-top:16px;">
    このリンクの有効期限はありません。Sheetsで status を変更すると無効になります。
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
  <h2 style="color:#316460;">✅ 投稿完了</h2>
  <p><strong>${submission.shopName}（${submission.area}）</strong></p>
  <p>デプロイ完了後（約1分）に公開されます。</p>
  <p><a href="${postUrl}" style="color:#316460;">${postUrl}</a></p>
</div>`,
    }
  );
}

// ============================================================
// Sheetsヘルパー
// ============================================================
const SHEET_NAME = 'submissions';
const COLUMNS = [
  'timestamp', 'shopName', 'area', 'genre', 'recommendation',
  'budget', 'link', 'submitterName', 'imageFilesJson', 'token', 'status'
];

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

function getColIndex(name) { return COLUMNS.indexOf(name) + 1; }

function saveToSheet(submission) {
  const sheet = getSheet();
  sheet.appendRow([
    new Date(),
    submission.shopName,
    submission.area,
    submission.genre,
    submission.recommendation,
    submission.budget,
    submission.link,
    submission.submitterName,
    JSON.stringify(submission.imageFiles || []),
    '',         // token
    'pending',
  ]);
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
    budget:         get('budget'),
    link:           get('link'),
    submitterName:  get('submitterName'),
    imageFiles:     JSON.parse(get('imageFilesJson') || '[]'),
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

function sanitize(str) {
  return String(str)
    .replace(/[\s　]/g, '-')
    .replace(/[^\w぀-鿿-]/g, '')
    .toLowerCase();
}

function esc(str) { return String(str).replace(/"/g, '\\"'); }

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function thStyle() {
  return 'text-align:left;padding:6px 12px;background:#f5f0e8;border:1px solid #c8bea0;white-space:nowrap;vertical-align:top;';
}
function tdStyle() { return 'padding:6px 12px;border:1px solid #c8bea0;'; }
function btnStyle(bg) {
  return `display:inline-block;background:${bg};color:#fff;padding:12px 28px;` +
         `text-decoration:none;border-radius:4px;font-size:15px;margin-right:10px;`;
}

// ============================================================
// KAOTY ノミネートフォーム
// ============================================================

/**
 * KAOTYノミネートを受信してシートに記録する。
 * シート名: kaoty_{season}（例: kaoty_25s）
 * 新年度は season を変えるだけで自動的に新シートが作成される。
 *
 * 期待するデータ:
 *   { type: 'kaoty', season: '25s', submitterName: '...', nominations: [...], comment: '...' }
 */
function handleKaoty(data) {
  const season       = String(data.season || '').trim();
  const nominations  = Array.isArray(data.nominations)
    ? data.nominations.map(n => String(n).trim()).filter(Boolean)
    : [];
  const comment      = String(data.comment || '').trim();
  const submitterName = String(data.submitterName || '匿名').trim() || '匿名';

  if (!season)              return json({ ok: false, error: 'season が未指定です' });
  if (nominations.length === 0) return json({ ok: false, error: 'ノミネート作品がありません' });

  const sheetName = `kaoty_${season}`;
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  let sheet       = ss.getSheetByName(sheetName);

  // 年度シートが未作成なら自動作成
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 4).setValues([['timestamp', 'submitterName', 'nominations', 'comment']]);
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date(),
    submitterName,
    nominations.join(' / '),  // 複数作品を「/」区切りで記録
    comment,
  ]);

  return json({ ok: true });
}

/**
 * 集計用ヘルパー（GASエディタで手動実行して使う）
 * 引数: season 文字列（例: '25s'）
 * 実行すると「kaoty_25s_tally」シートに集計結果を書き出す
 */
function tallyKaoty(season) {
  season = season || '25s';
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const sheet     = ss.getSheetByName(`kaoty_${season}`);
  if (!sheet) { Logger.log(`kaoty_${season} シートが見つかりません`); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) { Logger.log('データがありません'); return; }

  const rows = sheet.getRange(2, 3, lastRow - 1, 1).getValues(); // nominations 列
  const counts = {};
  rows.forEach(([cell]) => {
    String(cell).split('/').map(s => s.trim()).filter(Boolean).forEach(title => {
      counts[title] = (counts[title] || 0) + 1;
    });
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // 集計シートに書き出し
  const tallyName  = `kaoty_${season}_tally`;
  let tallySheet   = ss.getSheetByName(tallyName);
  if (!tallySheet) { tallySheet = ss.insertSheet(tallyName); }
  tallySheet.clearContents();
  tallySheet.getRange(1, 1, 1, 2).setValues([['作品名', 'ノミネート数']]);
  if (sorted.length > 0) {
    tallySheet.getRange(2, 1, sorted.length, 2).setValues(sorted);
  }

  Logger.log(`集計完了: ${sorted.length} 作品`);
  sorted.slice(0, 10).forEach(([title, count]) => Logger.log(`${count}票 ${title}`));
}

function page(title, body) {
  return HtmlService.createHtmlOutput(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:'EB Garamond',serif;background:#e9debe;color:#1e3030;
  display:flex;justify-content:center;padding:4rem 1rem;}
.box{max-width:480px;text-align:center;}h1{color:#316460;font-size:1.6rem;}
a{color:#316460;}</style></head>
<body><div class="box"><h1>${title}</h1><p>${body}</p></div></body></html>`).setTitle(title);
}
