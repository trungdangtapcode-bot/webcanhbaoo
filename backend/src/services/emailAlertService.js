const nodemailer = require('nodemailer');

const DEFAULT_RECIPIENT = 'chuleductrung06@gmail.com';

let transporter = null;
let warnedMissingConfig = false;

function cleanList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRecipients() {
  const recipients = cleanList(process.env.ALERT_EMAIL_TO || DEFAULT_RECIPIENT);
  return recipients.length ? recipients : [DEFAULT_RECIPIENT];
}

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user, pass },
  });
  return transporter;
}

function getEventLabel(eventType) {
  return {
    fire: 'Cháy',
    flood: 'Lũ lụt',
    traffic_jam: 'Tắc đường',
  }[eventType] || eventType || 'Sự cố';
}

function getSeverityLabel(severity) {
  return {
    critical: 'Nghiêm trọng',
    high: 'Cao',
    medium: 'Trung bình',
    low: 'Thấp',
  }[severity] || severity || 'Không rõ';
}

function buildMapLink(alert) {
  if (!Number.isFinite(Number(alert.lat)) || !Number.isFinite(Number(alert.lng))) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(`${alert.lat},${alert.lng}`)}`;
}

function buildMail(alert) {
  const eventLabel = getEventLabel(alert.event_type);
  const severityLabel = getSeverityLabel(alert.severity);
  const mapLink = buildMapLink(alert);
  const time = alert.last_seen || alert.timestamp || new Date().toISOString();
  const subject = `[Smart Alert] ${eventLabel} - ${alert.camera_name || alert.camera_id}`;
  const textLines = [
    `Smart Alert phát hiện ${eventLabel}.`,
    '',
    `Camera: ${alert.camera_name || alert.camera_id}`,
    `Mã camera: ${alert.camera_id}`,
    `Mức độ: ${severityLabel}`,
    `Thời gian: ${time}`,
    mapLink ? `Vị trí: ${mapLink}` : null,
    '',
    'Vui lòng mở dashboard để kiểm tra và xử lý.',
  ].filter(Boolean);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#18212b">
      <h2 style="margin:0 0 12px;color:#d33">Smart Alert phát hiện ${eventLabel}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:620px">
        <tr><td style="padding:6px 0;color:#667">Camera</td><td><strong>${escapeHtml(alert.camera_name || alert.camera_id)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#667">Mã camera</td><td>${escapeHtml(alert.camera_id)}</td></tr>
        <tr><td style="padding:6px 0;color:#667">Mức độ</td><td>${escapeHtml(severityLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#667">Thời gian</td><td>${escapeHtml(time)}</td></tr>
      </table>
      ${mapLink ? `<p><a href="${mapLink}">Mở vị trí trên Google Maps</a></p>` : ''}
      <p>Vui lòng mở dashboard để kiểm tra và xử lý.</p>
    </div>
  `;

  return { subject, text: textLines.join('\n'), html };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

async function sendAlertEmail(alert) {
  const mailer = getTransporter();
  const recipients = getRecipients();
  const mail = buildMail(alert);

  if (!mailer) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn('[EmailAlert] SMTP is not configured. Email alerts will be logged only.');
    }
    console.log(`[EmailAlert] Would send to ${recipients.join(', ')}: ${mail.subject}`);
    return { sent: false, dry_run: true, recipients };
  }

  const info = await mailer.sendMail({
    from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
    to: recipients.join(','),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  console.log(`[EmailAlert] Sent ${info.messageId || ''} to ${recipients.join(', ')}`);
  return { sent: true, message_id: info.messageId, recipients };
}

function notifyAlert(alert) {
  sendAlertEmail(alert).catch((err) => {
    console.error('[EmailAlert] send failed:', err.message);
  });
}

module.exports = {
  notifyAlert,
  sendAlertEmail,
};
