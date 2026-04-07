from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Protocol

import httpx

from app.core.config import EmailSettings, Settings, get_settings

logger = logging.getLogger(__name__)
RESEND_API_URL = "https://api.resend.com/emails"


@dataclass
class EmailMessage:
    to: list[str]
    subject: str
    html: Optional[str] = None
    text: Optional[str] = None


class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> Optional[str]:
        ...


class NoOpEmailSender:
    async def send(self, message: EmailMessage) -> Optional[str]:
        logger.info("Email notifications disabled; skipping provider send.")
        return None


class ResendEmailSender:
    def __init__(
        self,
        settings: EmailSettings,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._settings = settings
        self._client = client

    async def send(self, message: EmailMessage) -> Optional[str]:
        if not message.html and not message.text:
            raise ValueError("EmailMessage requires html or text content.")

        payload = {
            "from": self._settings.email_from,
            "to": message.to,
            "subject": message.subject,
        }
        if message.html:
            payload["html"] = message.html
        if message.text:
            payload["text"] = message.text

        if self._client is not None:
            return await self._deliver(self._client, payload)

        async with httpx.AsyncClient(timeout=10.0) as client:
            return await self._deliver(client, payload)

    async def _deliver(
        self,
        client: httpx.AsyncClient,
        payload: dict[str, object],
    ) -> Optional[str]:
        response = await client.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {self._settings.resend_api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json().get("id")


def build_email_sender(
    settings: Optional[Settings] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> EmailSender:
    active_settings = settings or get_settings()
    if not active_settings.email.notifications_enabled:
        return NoOpEmailSender()
    return ResendEmailSender(active_settings.email, client=client)
