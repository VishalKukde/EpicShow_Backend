import { Resend } from "resend";

export async function sendPasswordChangedEmail({ to, name, changedAt }) {
  if (!to) return false;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("sendPasswordChangedEmail: RESEND_API_KEY is missing");
    return false;
  }

  const emailFrom = process.env.EMAIL_FROM;
  if (!emailFrom) {
    console.error("sendPasswordChangedEmail: EMAIL_FROM is missing");
    return false;
  }

  const when = new Date(changedAt || new Date()).toLocaleString("en-IN");

  try {
    const resend = new Resend(apiKey);


const result = await resend.emails.send({
  from: emailFrom,
  to,
  subject: "Security Alert: Your Epic Show Password Was Changed",
  html: `
  <div style="background-color:#f4f6f9;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div style="background:linear-gradient(90deg,#4f46e5,#7c3aed);padding:24px 32px;color:#ffffff;">
        <h1 style="margin:0;font-size:22px;font-weight:600;">Epic Show</h1>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">
          Account Security Notification
        </p>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        <h2 style="margin-top:0;color:#111827;font-size:20px;font-weight:600;">
          Your Password Was Successfully Updated
        </h2>

        <p style="font-size:15px;color:#374151;line-height:1.6;">
          Hello <strong>${name || "User"}</strong>,
        </p>

        <p style="font-size:15px;color:#374151;line-height:1.6;">
          This email confirms that the password associated with your Epic Show account
          was changed on:
        </p>

        <p style="font-size:16px;font-weight:600;color:#111827;margin:18px 0;">
          ${when}
        </p>

        <p style="font-size:15px;color:#374151;line-height:1.6;">
          If you initiated this change, no further action is required.
        </p>

        <!-- Warning Box -->
        <div style="background:#fff4f4;border:1px solid #fecaca;padding:16px;border-radius:10px;margin:20px 0;">
          <p style="margin:0;font-size:14px;color:#b91c1c;font-weight:600;">
            If you did not make this change, please contact our support team immediately
            to secure your account.
          </p>
        </div>

        <p style="font-size:14px;color:#374151;margin-bottom:6px;">
          Support Contact:
        </p>

        <p style="font-size:14px;font-weight:600;color:#4f46e5;margin-top:0;">
          support@epicshow.com
        </p>

        <hr style="margin:28px 0;border:none;border-top:1px solid #e5e7eb;" />

        <p style="font-size:12px;color:#6b7280;line-height:1.6;">
          This is an automated security notification. Please do not reply to this email.
        </p>

        <!-- Development Notice -->
        <div style="margin-top:16px;background:#f9fafb;border:1px dashed #d1d5db;padding:12px;border-radius:8px;">
          <p style="margin:0;font-size:12px;color:#6b7280;">
            ⚠️ This email was generated for development and testing purposes only.
            It is not an official production security notification.
          </p>
        </div>

      </div>

      <!-- Footer -->
      <div style="background:#f9fafb;padding:18px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">
          © ${new Date().getFullYear()} Epic Show. All rights reserved.
        </p>
      </div>

    </div>
  </div>
  `,
});


    if (result?.error) {
      console.error("sendPasswordChangedEmail: Resend API error", result.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("sendPasswordChangedEmail: Failed to send email", error);
    return false;
  }
}
