"""PyInstaller entry point that preserves the ``petc`` package context."""

from petc.service import run


if __name__ == "__main__":
    run()
