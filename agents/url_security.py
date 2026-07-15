from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urlsplit

MAX_OUTBOUND_URL_LENGTH = 2048
DNS_LOOKUP_TIMEOUT_SECONDS = 2.0


def _resolved_addresses(
    hostname: str,
    port: int,
    resolver: Callable[..., list[tuple]],
) -> set[str]:
    return {
        item[4][0]
        for item in resolver(hostname, port, type=socket.SOCK_STREAM)
        if item[4]
    }


async def validate_public_http_url(
    value: str,
    *,
    resolver: Callable[..., list[tuple]] = socket.getaddrinfo,
) -> None:
    if len(value) > MAX_OUTBOUND_URL_LENGTH:
        raise ValueError("Job URL is too long.")

    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Job URL must use HTTP or HTTPS.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Job URL credentials are not allowed.")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError("Job URL must resolve to a public network address.")

    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None
    if literal_ip is not None:
        if not literal_ip.is_global:
            raise ValueError("Job URL must resolve to a public network address.")
        return

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = await asyncio.wait_for(
            asyncio.to_thread(_resolved_addresses, hostname, port, resolver),
            timeout=DNS_LOOKUP_TIMEOUT_SECONDS,
        )
    except (OSError, asyncio.TimeoutError, ValueError) as error:
        raise ValueError("Job URL host could not be safely resolved.") from error

    if not addresses:
        raise ValueError("Job URL host could not be safely resolved.")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Job URL must resolve only to public network addresses.")
