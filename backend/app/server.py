from __future__ import annotations

import os
import socket

import uvicorn


def create_listeners(port: int) -> list[socket.socket]:
    listeners: list[socket.socket] = []
    addresses = (
        (socket.AF_INET, ("0.0.0.0", port)),
        (socket.AF_INET6, ("::", port)),
    )

    try:
        for family, address in addresses:
            listener = socket.socket(family, socket.SOCK_STREAM)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if family == socket.AF_INET6:
                listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            listener.bind(address)
            listener.listen(2048)
            listeners.append(listener)
    except Exception:
        for listener in listeners:
            listener.close()
        raise

    return listeners


def main() -> None:
    port = int(os.getenv("PORT", "8000"))
    listeners = create_listeners(port)
    config = uvicorn.Config("app.main:app", proxy_headers=True)
    server = uvicorn.Server(config)
    server.run(sockets=listeners)


if __name__ == "__main__":
    main()
