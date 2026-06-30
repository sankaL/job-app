from pathlib import Path


BACKEND_DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"


def test_backend_container_binds_to_railway_public_edge() -> None:
    dockerfile = BACKEND_DOCKERFILE.read_text(encoding="utf-8")

    assert "--host 0.0.0.0" in dockerfile
    assert "--port ${PORT:-8000}" in dockerfile


def test_backend_dependencies_are_cached_before_source_copy() -> None:
    dockerfile = BACKEND_DOCKERFILE.read_text(encoding="utf-8")

    dependency_copy = dockerfile.index("COPY pyproject.toml .")
    dependency_install = dockerfile.index("pip install --no-cache-dir .")
    source_copy = dockerfile.index("COPY . .")
    package_install = dockerfile.index("pip install --no-cache-dir --no-deps .")

    assert dependency_copy < dependency_install < source_copy < package_install
