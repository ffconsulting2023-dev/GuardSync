/**
 * メール送信ライブラリ（Nodemailer使用）
 * サーバーサイドから呼び出す
 */

export interface EmailConfig {
  host: string
  port: number
  auth: { user: string; pass: string }
  from: string
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export function getEmailConfig(): EmailConfig {
  return {
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
      user: process.env.SMTP_USER || 'apikey',
      pass: process.env.SMTP_PASS || process.env.SENDGRID_API_KEY || '',
    },
    from: process.env.SMTP_FROM || 'noreply@guardsync.jp',
  }
}

/**
 * 前日確認メールのHTMLテンプレート
 */
export function buildDayBeforeConfirmEmail(params: {
  guardName: string
  siteName: string
  siteAddress: string
  date: string
  startTime: string
  endTime: string
  companyName: string
}): { subject: string; html: string; text: string } {
  const subject = `【前日確認】${params.date} ${params.siteName} 出動のご確認`

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #1e3a5f; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">明日の出動確認</h2>
    <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">GuardSync</p>
  </div>
  <div style="background: white; border: 1px solid #ddd; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
    <p>${params.guardName} 様</p>
    <p>明日の出動についてご確認ください。</p>

    <div style="background: #f5f6fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #666; padding: 4px 0;">日時</td><td style="font-weight: bold;">${params.date} ${params.startTime}〜${params.endTime}</td></tr>
        <tr><td style="color: #666; padding: 4px 0;">現場名</td><td style="font-weight: bold;">${params.siteName}</td></tr>
        <tr><td style="color: #666; padding: 4px 0;">住所</td><td>${params.siteAddress}</td></tr>
      </table>
    </div>

    <p style="font-size: 13px; color: #666;">不明点・変更がある場合は管理者にご連絡ください。</p>

    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="font-size: 12px; color: #999;">${params.companyName} | GuardSync</p>
  </div>
</body>
</html>`

  const text = `${params.guardName} 様\n\n明日の出動確認\n日時: ${params.date} ${params.startTime}〜${params.endTime}\n現場: ${params.siteName}\n住所: ${params.siteAddress}\n\n${params.companyName}`

  return { subject, html, text }
}

/**
 * 電子契約署名依頼メールテンプレート
 */
export function buildEContractSignEmail(params: {
  signerName: string
  contractTitle: string
  signUrl: string
  expiresAt: string
  companyName: string
}): { subject: string; html: string } {
  const subject = `【署名依頼】${params.contractTitle}`

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #1e3a5f; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">電子契約 署名依頼</h2>
    <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">GuardSync 電子契約システム</p>
  </div>
  <div style="background: white; border: 1px solid #ddd; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
    <p>${params.signerName} 様</p>
    <p>下記の契約書への電子署名をお願いします。</p>

    <div style="background: #f5f6fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; font-weight: bold;">${params.contractTitle}</p>
      <p style="margin: 8px 0 0; font-size: 13px; color: #666;">署名期限: ${params.expiresAt}</p>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${params.signUrl}" style="background: #1e3a5f; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
        署名する
      </a>
    </div>

    <p style="font-size: 12px; color: #999;">このリンクは署名後に無効になります。URLを第三者に共有しないでください。</p>
    <p style="font-size: 12px; color: #999;">署名はRFC 3161タイムスタンプにより時刻が証明されます。</p>

    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="font-size: 12px; color: #999;">${params.companyName} | GuardSync</p>
  </div>
</body>
</html>`

  return { subject, html }
}

/**
 * 警備報告書承認依頼メールテンプレート
 */
export function buildSecurityReportApprovalEmail(params: {
  clientName: string
  guardName: string
  siteName: string
  reportDate: string
  approvalUrl: string
  companyName: string
}): { subject: string; html: string } {
  const subject = `【承認依頼】${params.reportDate} ${params.siteName} 警備報告書`

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #1e3a5f; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">警備報告書 承認依頼</h2>
  </div>
  <div style="background: white; border: 1px solid #ddd; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
    <p>${params.clientName} 担当者様</p>
    <p>下記の警備報告書のご確認・承認をお願いします。</p>

    <div style="background: #f5f6fa; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px;">
      <table style="width: 100%;">
        <tr><td style="color: #666; padding: 4px 0;">報告日</td><td>${params.reportDate}</td></tr>
        <tr><td style="color: #666; padding: 4px 0;">現場</td><td>${params.siteName}</td></tr>
        <tr><td style="color: #666; padding: 4px 0;">担当隊員</td><td>${params.guardName}</td></tr>
      </table>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${params.approvalUrl}" style="background: #27ae60; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
        報告書を承認する
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="font-size: 12px; color: #999;">${params.companyName} | GuardSync</p>
  </div>
</body>
</html>`

  return { subject, html }
}
