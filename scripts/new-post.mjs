/**
 * 新記事テンプレート生成スクリプト
 * 使い方: npm run new "記事タイトル"
 */
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const title = process.argv[2];

if (!title) {
  console.error('使い方: npm run new "記事タイトル"');
  process.exit(1);
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'post';
}

const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
const slug   = slugify(title);
const filename = `${today}-${slug}.md`;
const outPath  = join(__dirname, '..', 'src', 'content', 'posts', filename);

if (existsSync(outPath)) {
  console.error(`既に存在します: ${filename}`);
  process.exit(1);
}

const template = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${today}
categories: []
tags: []
# image: /uploads/${today.slice(0, 7).replace('-', '/')}/ファイル名.jpg
# description: "OGP・RSS用の説明文（省略可）"
---

ここから本文を書く。

`;

writeFileSync(outPath, template, 'utf8');
console.log(`\n✓ 作成しました`);
console.log(`  ${outPath}`);
console.log(`\n次のステップ:`);
console.log(`  1. ファイルを編集して記事を書く`);
console.log(`  2. git add src/content/posts/${filename}`);
console.log(`  3. git commit -m "post: ${title}"`);
console.log(`  4. git push  → Cloudflare Pages が自動デプロイ`);
