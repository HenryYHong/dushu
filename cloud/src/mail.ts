// The sign-in emails and the follow-ups (followups.ts). The Worker only sees Mailer, so the service behind it can change (Resend
// now; another service, or a mail server of the owner's own, later) without touching the rest.
export interface Mailer {
  /**
   * Sends one plain-text email; throws when it was not sent. `headers` are extra ones: a follow-up's List-Unsubscribe and
   * List-Unsubscribe-Post (RFC 8058), so a mail app can offer its own unsubscribe button. A sign-in code has none.
   */
  send(message: { to: string; subject: string; text: string; headers?: Record<string, string> }): Promise<void>;
}

/** The email with a sign-in code. */
export function codeEmail(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your LinguPengu sign-in code`,
    text: `Your LinguPengu sign-in code is ${code}.\n\nType it in LinguPengu within 10 minutes. If you did not ask for it, you can ignore this email: nobody can sign in without the code.`,
  };
}

/** Resend (resend.com). `from` must be on a domain verified there; its test address only reaches the Resend account's owner. */
export function resendMailer(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mailer {
  return {
    async send({ to, subject, text, headers }) {
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // Resend takes extra headers as an object; a sign-in code sends exactly what it always did.
        body: JSON.stringify({ from, to: [to], subject, text, ...(headers ? { headers } : {}) }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    },
  };
}

/** Local testing: the email is logged, not sent. */
export function logMailer(): Mailer {
  return { async send({ to, subject }) { console.log(`LinguPengu email to ${to}: ${subject}`); } };
}
