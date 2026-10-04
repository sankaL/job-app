from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.services.email import EmailMessage, EmailSender, build_email_sender
from app.services.email_templates import render_branded_email


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
        note = (clean_note or "None provided").replace("\r", " ")
        email = render_branded_email(
            eyebrow="Early access",
            heading="New early access request",
            body="Review this request and send an invite from the admin user management screen if approved.",
            details=[
                ("Name", clean_name),
                ("Email", clean_email),
                ("Interested plan", plan_label),
                ("Note", note),
            ],
        )

        delivery_id = await self.email_sender.send(
            EmailMessage(
                to=recipients,
                subject=subject,
                text=email.text,
                html=email.html,
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
