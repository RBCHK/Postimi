import { Resend } from "resend";

let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (resendInstance) return resendInstance;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  resendInstance = new Resend(apiKey);
  return resendInstance;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set");

  const { data, error } = await getResend().emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error) throw new Error(`Resend send failed: ${error.message}`);
  if (!data?.id) throw new Error("Resend returned no message id");
  return { id: data.id };
}
