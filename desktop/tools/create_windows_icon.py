"""Create the Windows icon used by the PETC installer and executable."""

from pathlib import Path

from PIL import Image


desktop_dir = Path(__file__).resolve().parent.parent
source = desktop_dir.parent / "SoftwareIcon" / "PETC.png"
destination = desktop_dir / "build" / "PETC.ico"
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    if not source.is_file():
        raise FileNotFoundError(f"PETC application icon was not found: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        icon = image.convert("RGBA")
        icon.save(destination, format="ICO", sizes=sizes)

    print(f"Created Windows icon: {destination}")


if __name__ == "__main__":
    main()
