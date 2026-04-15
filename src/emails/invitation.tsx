interface InvitationCopy {
  preview: string;
  greeting: string;
  body: string;
  cta: string;
  footer: string;
}

const COPY: Record<string, InvitationCopy> = {
  en: {
    preview: "Your Postimi invitation is ready",
    greeting: "Welcome to Postimi",
    body: "You're invited to join Postimi — your AI co-pilot for content. Click below to claim your spot and finish setup.",
    cta: "Accept invitation",
    footer: "If you didn't request this, you can ignore this email.",
  },
  ru: {
    preview: "Приглашение в Postimi готово",
    greeting: "Добро пожаловать в Postimi",
    body: "Вы приглашены в Postimi — AI-помощник для контента. Нажмите кнопку ниже, чтобы активировать аккаунт.",
    cta: "Принять приглашение",
    footer: "Если вы не запрашивали это письмо — просто проигнорируйте его.",
  },
  it: {
    preview: "Il tuo invito a Postimi è pronto",
    greeting: "Benvenuto su Postimi",
    body: "Sei stato invitato a Postimi — il tuo co-pilota AI per i contenuti. Clicca qui sotto per attivare il tuo account.",
    cta: "Accetta l'invito",
    footer: "Se non hai richiesto questa email, puoi ignorarla.",
  },
};

function pickCopy(locale: string): InvitationCopy {
  return COPY[locale] ?? COPY.en;
}

export interface InvitationEmail {
  subject: string;
  html: string;
  text: string;
}

export function invitationEmailTemplate({
  signupUrl,
  locale,
}: {
  signupUrl: string;
  locale: string;
}): InvitationEmail {
  const c = pickCopy(locale);
  const subject = c.greeting;

  const html = `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${c.preview}</title>
</head>
<body style="margin:0;padding:24px;background:#0a0a0a;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#171717;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#fafafa;">${c.greeting}</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#d4d4d4;">${c.body}</p>
    <p style="margin:0 0 24px;">
      <a href="${signupUrl}" style="display:inline-block;padding:12px 20px;background:#fafafa;color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:500;font-size:14px;">${c.cta}</a>
    </p>
    <p style="margin:0;font-size:12px;color:#737373;">${c.footer}</p>
  </div>
</body>
</html>`;

  const text = `${c.greeting}\n\n${c.body}\n\n${c.cta}: ${signupUrl}\n\n${c.footer}`;

  return { subject, html, text };
}
