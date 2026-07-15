import socket
from pathlib import Path

from app.server import create_listeners


BACKEND_DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"


def test_backend_container_binds_to_railway_public_edge() -> None:
    dockerfile = BACKEND_DOCKERFILE.read_text(encoding="utf-8")

    assert 'CMD ["python", "-m", "app.server"]' in dockerfile


def test_backend_server_listens_on_ipv4_and_ipv6() -> None:
    listeners = create_listeners(0)

    try:
        assert [listener.family for listener in listeners] == [
            socket.AF_INET,
            socket.AF_INET6,
        ]
        assert listeners[1].getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY) == 1
    finally:
        for listener in listeners:
            listener.close()


def test_backend_dependencies_are_cached_before_source_copy() -> None:
    dockerfile = BACKEND_DOCKERFILE.read_text(encoding="utf-8")

    dependency_copy = dockerfile.index("COPY pyproject.toml .")
    dependency_install = dockerfile.index("pip install --no-cache-dir .")
    source_copy = dockerfile.index("COPY . .")
    package_install = dockerfile.index("pip install --no-cache-dir --no-deps .")

    assert dependency_copy < dependency_install < source_copy < package_install
