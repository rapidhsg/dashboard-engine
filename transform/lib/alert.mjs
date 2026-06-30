// Failure alerts via Resend (zero deps; global fetch). No-op (logs) if no key.

export async function sendAlert(subject, lines, recipients, apiKey) {
  if (!apiKey) {
    console.error("[alert] RESEND_API_KEY not set — would have emailed:", subject);
    return false;
  }
  const html =
    `<h2>${subject}</h2><ul>` +
    lines.map((l) => `<li>${String(l)}</li>`).join("") +
    `</ul><p style="color:#888">The dashboards are still showing the last good numbers. ` +
    `— dashboard-engine</p>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "onboarding@resend.dev", // swap to a verified-domain sender to reach all recipients
        to: recipients,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("[alert] Resend HTTP", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[alert] send failed:", err.message);
    return false;
  }
}
