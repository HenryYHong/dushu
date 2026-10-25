// The sign-in emails. The Worker only sees Mailer, so the service behind it can change (Resend now; another service, or a
// mail server of the owner's own, later) without touching the rest.
export interface Mailer {
  /** Sends one plain-text email; throws when it was not sent. */
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** The email with a sign-in code. */
export function codeEmail(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your Dushu sign-in code`,
    text: `Your Dushu sign-in code is ${code}.\n\nType it in Dushu within 10 minutes. If you did not ask for it, you can ignore this email: nobody can sign in without the code.`,
  };
}

/** Resend (resend.com). `from` must be on a domain verified there; its test address only reaches the Resend account's owner. */
export function resendMailer(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mailer {
  return {
    async send({ to, subject, text }) {
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    },
  };
}

/** Local testing: the email is logged, not sent. */
export function logMailer(): Mailer {
  return { async send({ to, subject }) { console.log(`Dushu email to ${to}: ${subject}`); } };
}
