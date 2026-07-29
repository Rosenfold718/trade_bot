import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mail.ru',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 's-ch-1910@mail.ru';
const FROM_NAME = 'Trade Bot Support';

export async function sendSupportTicket(data: {
  username: string;
  userEmail: string;
  message: string;
  requestFaster?: boolean;
}) {
  const subject = data.requestFaster
    ? `🚀 СРОЧНО: Запрос активации от ${data.username} (${data.userEmail})`
    : `💬 Обращение в техподдержку от ${data.username} (${data.userEmail})`;

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:'Inter',system-ui,sans-serif;background:#0d0d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
      <div style="padding:24px 28px;background:linear-gradient(135deg,#0f4f2e,#0a3520);border-bottom:1px solid rgba(34,197,94,0.2);">
        <h2 style="margin:0;color:#22c55e;font-size:18px;">${data.requestFaster ? '🚀 Запрос срочной активации' : '💬 Новое обращение в техподдержку'}</h2>
      </div>
      <div style="padding:24px 28px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;border-bottom:1px solid rgba(255,255,255,0.06);">Логин</td>
            <td style="padding:8px 0;color:#fff;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid rgba(255,255,255,0.06);">${data.username}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;border-bottom:1px solid rgba(255,255,255,0.06);">
              Email для ответа
            </td>
            <td style="padding:8px 0;text-align:right;border-bottom:1px solid rgba(255,255,255,0.06);">
              <a href="mailto:${data.userEmail}" style="color:#22c55e;font-size:14px;font-weight:600;text-decoration:none;">${data.userEmail}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;border-bottom:1px solid rgba(255,255,255,0.06);">Тип запроса</td>
            <td style="padding:8px 0;color:${data.requestFaster ? '#f59e0b' : '#22c55e'};font-size:14px;font-weight:500;text-align:right;border-bottom:1px solid rgba(255,255,255,0.06);">${data.requestFaster ? '⚡ Срочная активация' : 'Вопрос'}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;">Время</td>
            <td style="padding:8px 0;color:rgba(255,255,255,0.5);font-size:13px;text-align:right;">${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
          </tr>
        </table>

        <div style="margin-top:16px;padding:16px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0 0 8px;color:rgba(255,255,255,0.3);font-size:11px;text-transform:uppercase;letter-spacing:1px;">Сообщение</p>
          <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px;line-height:1.6;">${data.message.replace(/\n/g, '<br>')}</p>
        </div>

        ${data.requestFaster ? `
        <div style="margin-top:12px;padding:12px 16px;background:rgba(245,158,11,0.08);border-radius:10px;border:1px solid rgba(245,158,11,0.15);">
          <p style="margin:0;color:#f59e0b;font-size:13px;">⚡ Пользователь просит активировать аккаунт быстрее обычного.</p>
        </div>` : ''}

        <div style="margin-top:16px;padding:12px 16px;background:rgba(59,130,246,0.06);border-radius:10px;border:1px solid rgba(59,130,246,0.12);">
          <p style="margin:0;color:rgba(255,255,255,0.5);font-size:12px;">
            Для ответа пользователю отправьте письмо на: <a href="mailto:${data.userEmail}" style="color:#60a5fa;text-decoration:underline;">${data.userEmail}</a>
          </p>
        </div>
      </div>
    </div>
  `;

  const info = await transporter.sendMail({
    from: `${FROM_NAME} <${process.env.SMTP_USER}>`,
    to: SUPPORT_EMAIL,
    replyTo: data.userEmail,
    subject,
    html,
  });

  return info.messageId;
}
