// Sends the portal's emails from the practice's own Microsoft 365 mailbox, using the server's
// Microsoft Graph sign-in (Mail.Send, restricted to that one mailbox in Exchange).
// A mailer is { send({ to, subject, text, html }) }. Tests use a recording one.

function createGraphMailer({ from, getToken, fetch = globalThis.fetch }) {
  return {
    configured: Boolean(from),
    async send({ to, subject, text, html }) {
      if (!from) throw new Error("No mailbox is set up for the portal");
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: { subject, body: { contentType: html ? "HTML" : "Text", content: html || text }, toRecipients: [{ emailAddress: { address: to } }] },
          saveToSentItems: true,
        }),
      });
      if (!res.ok) throw new Error(`The mailbox refused the message (${res.status})`);
    },
  };
}

function createRecordingMailer() {
  const sent = [];
  return { configured: true, sent, async send(m) { sent.push(m); } };
}

module.exports = { createGraphMailer, createRecordingMailer };
