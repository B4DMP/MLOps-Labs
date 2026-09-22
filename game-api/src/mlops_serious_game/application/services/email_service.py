from email.message import EmailMessage
from loguru import logger
import aiosmtplib

from mlops_serious_game.config import settings

def render_code_email_html(username: str, code: str, title: str, instruction: str, ttl_minutes: int) -> str:
    """Same content as the plain-text code email, styled to match the game's own light
    dialog/card UI (--dialog-surface white card, --primary-bg teal header bar, left-accented
    info box - see PrePhaseDialog.module.css's .missionCard/.missionCardHeader/.objectivesBox)
    instead of default email-client formatting."""
    return f"""\
<div style="background-color:#f1f5f9;padding:32px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;margin:0 auto;">
    <tr>
      <td style="background:#266682;border-radius:12px 12px 0 0;padding:18px 28px;">
        <span style="color:#ffffff;font-size:17px;font-weight:700;">MLOps Labs</span>
      </td>
    </tr>
    <tr>
      <td style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;
                 border-radius:0 0 12px 12px;padding:28px;">
        <p style="color:#1e293b;font-size:15px;line-height:1.5;margin:0 0 20px;">
          Hi {username}, {instruction}
        </p>
        <div style="background:#f1f5f9;border-left:4px solid #266682;border-radius:0 8px 8px 0;
                    padding:16px 20px;margin:0 0 20px;text-align:center;">
          <span style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;
                       letter-spacing:1px;display:block;margin-bottom:6px;">
            {title}
          </span>
          <span style="color:#1e293b;font-size:28px;font-weight:700;letter-spacing:8px;
                       font-family:'Courier New',monospace;">
            {code}
          </span>
        </div>
        <p style="color:#64748b;font-size:13px;line-height:1.5;margin:0;
                  padding-top:16px;border-top:1px solid #e2e8f0;">
          This code expires in {ttl_minutes} minutes. If you didn't request it, you can ignore this email.
        </p>
      </td>
    </tr>
  </table>
</div>
"""


CODE_EMAIL_COPY = {
    "verification": (
        "Verification Code",
        "thanks for registering for MLOps Labs - enter this code in the game to verify your account and start playing.",
    ),
    "password_reset": (
        "Password Reset Code",
        "enter this code in the game to confirm it's you and set a new password.",
    ),
}


def build_code_email(purpose: str, username: str, code: str, ttl_minutes: int) -> tuple[str, str, str]:
    """Builds the (subject, plain-text body, html body) for a verification/password-reset code
    email. Shared by the real auth flow (auth_service) and the admin panel's test-send tool, so
    a test send exercises the exact same template a player would receive."""
    title, instruction = CODE_EMAIL_COPY[purpose]
    subject = f"{code} is your MLOps Labs {title.lower()}"
    body = (
        f"Hi {username}, {instruction}\n\n"
        f"{title}: {code}\n"
        f"This code expires in {ttl_minutes} minutes.\n\n"
        f"If you didn't request it, you can ignore this email."
    )
    html = render_code_email_html(username, code, title, instruction, ttl_minutes)
    return subject, body, html


def get_email_status() -> dict:
    """Return non-sensitive SMTP configuration details for admin inspection."""
    return {
        "host": settings.SMTP_HOST,
        "port": settings.SMTP_PORT,
        "username": settings.SMTP_USERNAME or "",
        "from_email": settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME or "",
        "use_tls": settings.SMTP_USE_TLS,
        "is_configured": bool(settings.SMTP_USERNAME and settings.SMTP_PASSWORD),
        "has_password": bool(settings.SMTP_PASSWORD),
    }


async def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
) -> None:
    """
    Send an email using configured SMTP settings (supports Gmail STARTTLS).
    """
    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        raise ValueError(
            "SMTP credentials are not fully configured. Please set SMTP_USERNAME and SMTP_PASSWORD in your environment (.env)."
        )

    if not to_email or "@" not in to_email:
        raise ValueError(f"Invalid recipient email address: {to_email}")

    sender = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    if html_body:
        message.add_alternative(html_body, subtype="html")

    logger.info(
        f"Attempting to send email to {to_email} via {settings.SMTP_HOST}:{settings.SMTP_PORT} (TLS={settings.SMTP_USE_TLS})"
    )

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            start_tls=settings.SMTP_USE_TLS,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            timeout=30,
        )
        logger.info(f"Email successfully delivered to {to_email}")
    except aiosmtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP authentication failed: {e}")
        raise ValueError(
            f"SMTP Authentication failed: Check your Gmail address and App Password. Details: {e.message}"
        ) from e
    except aiosmtplib.SMTPException as e:
        logger.error(f"SMTP error occurred: {e}")
        raise ValueError(f"SMTP sending failed: {e.message}") from e
    except Exception as e:
        logger.error(f"Unexpected error while sending email: {e}")
        raise ValueError(f"Failed to send email: {str(e)}") from e
