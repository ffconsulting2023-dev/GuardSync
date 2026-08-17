# PDF用フォント

`server.ts` の PDF 生成（給与明細・賞与明細・源泉徴収票など）は、
このディレクトリに置かれた日本語フォントを使用します。

## 必要なファイル

```
fonts/NotoSansJP-Regular.ttf
```

- ファイル名は **`NotoSansJP-Regular.ttf`** 固定です（`server.ts` が参照）。
- このファイルが存在しない場合、PDFは **Helvetica + 英語ラベルにフォールバック**します。
  日本語（氏名・会社名など）は文字化け／空白になります。

## 入手方法

Noto Sans JP（SIL Open Font License 1.1）を利用します。

- Google Fonts: https://fonts.google.com/noto/specimen/Noto+Sans+JP
- GitHub: https://github.com/notofonts/noto-cjk

ダウンロードした `NotoSansJP-Regular.ttf`（Variable フォントの場合は
Regular ウェイトを static 化した TTF）をこのディレクトリに配置してください。

## ビルドへの取り込み

`npm run build` 実行時、`scripts/copy-assets.mjs` が
`fonts/` を `dist/fonts/` へコピーします。Docker イメージは `dist/` を
`COPY` するため、`dist/fonts/NotoSansJP-Regular.ttf` としてイメージに含まれます。

> リポジトリにフォントを含めたくない場合は、CI のビルド前ステップで
> ダウンロードして `fonts/` に配置する方法でも構いません。
