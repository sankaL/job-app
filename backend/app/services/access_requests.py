from __future__ import annotations

import html
from dataclasses import dataclass
from typing import Literal, Optional

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.services.email import EmailMessage, EmailSender, build_email_sender


@dataclass
class AccessRequestService:
    settings: Settings
    email_sender: EmailSender

    async def submit_request(
        self,
        *,
        full_name: str,
        email: str,
        interested_plan: Literal["standard", "pro", "not_sure"],
        note: Optional[str],
    ) -> None:
        recipients = self.settings.admin_email_list
        if not recipients:
            raise ValueError("Access request recipient is not configured.")
        if not self.settings.email.notifications_enabled:
            raise ValueError("Access request delivery is not configured.")

        clean_name = full_name
        clean_email = email
        clean_note = note or ""

        plan_label = {
            "standard": "Standard",
            "pro": "Pro",
            "not_sure": "Not sure",
        }.get(interested_plan, interested_plan)

        safe_name = clean_name.translate(str.maketrans("", "", "\n\r\t\v\f\x00"))
        subject = f"Applix early access request: {safe_name}"
        text = (
            "New Applix early access request\n\n"
            f"Name: {clean_name}\n"
            f"Email: {clean_email}\n"
            f"Interested plan: {plan_label}\n"
            f"Note: {(clean_note or 'None provided').replace(chr(10), ' ').replace(chr(13), ' ')}\n\n"
            "Review this request and send an invite from the admin user management screen if approved."
        )
        html_body = f"""
        <div style="font-family: Arial, sans-serif; color: #101828; line-height: 1.5;">
          <h2 style="margin: 0 0 12px;">New Applix early access request</h2>
          <p><strong>Name:</strong> {html.escape(clean_name)}</p>
          <p><strong>Email:</strong> {html.escape(clean_email)}</p>
          <p><strong>Interested plan:</strong> {html.escape(plan_label)}</p>
          <p><strong>Note:</strong><br />{html.escape(clean_note or "None provided")}</p>
          <p style="margin-top: 20px; color: #667085;">
            Review this request and send an invite from the admin user management screen if approved.
          </p>
        </div>
        """

        delivery_id = await self.email_sender.send(
            EmailMessage(
                to=recipients,
                subject=subject,
                text=text,
                html=html_body,
            )
        )
        if not delivery_id:
            raise ValueError("Access request delivery did not return a provider receipt.")


def get_access_request_service(
    settings: Settings = Depends(get_settings),
) -> AccessRequestService:
    return AccessRequestService(
        settings=settings,
        email_sender=build_email_sender(settings),
    )
