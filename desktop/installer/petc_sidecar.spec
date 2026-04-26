# PyInstaller spec for PETC sidecar
# Run from desktop/sidecar/: pyinstaller ../installer/petc_sidecar.spec
# Output: sidecar/dist/petc  (directory bundle, not one-file, for faster cold start)

block_cipher = None

a = Analysis(
    ['petc/service.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        ('petc', 'petc'),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'httpx',
        'pydantic',
        'sqlalchemy.dialects.sqlite',
        'alembic',
        'alembic.runtime.migration',
        'alembic.operations',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'pywin32'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='petc',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

# Directory bundle — electron main.ts reads resources/petc-sidecar/petc (or petc.exe on Windows)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='petc',
)
