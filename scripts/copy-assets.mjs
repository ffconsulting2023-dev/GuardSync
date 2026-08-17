// ビルド後、ランタイムが参照する静的アセットを dist/ 配下へコピーする。
// 特に PDFKit が使う日本語フォント（fonts/NotoSansJP-Regular.ttf）は、
// tsc / vite のビルド対象外のため、この手順で dist/fonts/ に含める必要がある。
// server.ts は path.join(__dirname, 'fonts', 'NotoSansJP-Regular.ttf')
// （= dist/fonts/...）を参照する。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** srcDir が存在すれば destDir へ再帰コピーする */
function copyDir(srcDir, destDir, label) {
  const src = path.join(root, srcDir)
  const dest = path.join(root, destDir)
  if (!fs.existsSync(src)) {
    console.warn(`[copy-assets] ${srcDir} が存在しないためスキップします（${label}）`)
    return
  }
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[copy-assets] ${srcDir} -> ${destDir} をコピーしました`)
}

// 日本語フォント（PDF生成用）
copyDir('fonts', 'dist/fonts', 'PDF日本語フォント')

// フォント未同梱の場合の注意喚起（本番でPDFが英語フォールバックになる）
const fontFile = path.join(root, 'dist', 'fonts', 'NotoSansJP-Regular.ttf')
if (!fs.existsSync(fontFile)) {
  console.warn(
    '[copy-assets] 警告: dist/fonts/NotoSansJP-Regular.ttf が見つかりません。\n' +
    '            PDFの日本語が英語ラベルにフォールバックします。\n' +
    '            fonts/NotoSansJP-Regular.ttf を配置してから再ビルドしてください。'
  )
}
