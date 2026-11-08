@echo off
setlocal

set "ROOT=%~dp0"
set "DESKTOP=%ROOT%desktop"
set "RENDERER=%ROOT%desktop\renderer"
set "VENV_PY=%ROOT%desktop\.venv\Scripts\python.exe"
set "MOCK_DATA=%ROOT%desktop\.mock-data"
set "MODE=menu"

if /I "%~1"=="install" set "MODE=single" & goto install_desktop
if /I "%~1"=="minio" set "MODE=single" & goto run_minio
if /I "%~1"=="renderer" set "MODE=single" & goto run_renderer
if /I "%~1"=="frontend" set "MODE=single" & goto run_renderer
if /I "%~1"=="electron" set "MODE=single" & goto run_electron
if /I "%~1"=="sidecar" set "MODE=single" & goto run_sidecar
if /I "%~1"=="stop" set "MODE=single" & goto stop_localhost

:menu
cls
echo PETC Desktop Localhost Launcher
echo.
echo Choose what to do:
echo   1. Install Desktop App requirements
echo   2. Start Docker / MinIO
echo   3. Start Renderer localhost
echo   4. Start Electron desktop app
echo   5. Optional manual sidecar API
echo   6. Stop localhost app processes
echo   7. Exit
echo.
echo Recommended run order: 1, 2, 3, 4
echo Use option 5 only if Electron does not start the sidecar automatically.
echo.
set /p "CHOICE=Enter choice [1-7]: "

if "%CHOICE%"=="1" goto install_desktop
if "%CHOICE%"=="2" goto start_minio_window
if "%CHOICE%"=="3" goto start_renderer_window
if "%CHOICE%"=="4" goto start_electron_window
if "%CHOICE%"=="5" goto start_sidecar_window
if "%CHOICE%"=="6" goto stop_localhost
if "%CHOICE%"=="7" exit /b 0

echo Invalid choice.
pause
goto menu

:install_desktop
echo Installing Electron desktop dependencies...
cd /d "%DESKTOP%"
call npm.cmd install
if errorlevel 1 goto action_failed

echo.
echo Installing renderer dependencies...
cd /d "%RENDERER%"
call npm.cmd install
if errorlevel 1 goto action_failed

echo.
echo Creating Python virtual environment...
cd /d "%DESKTOP%"
python -m venv .venv
if errorlevel 1 goto action_failed

echo.
echo Installing Python sidecar dependencies...
"%VENV_PY%" -m pip install -e ".[dev]"
if errorlevel 1 goto action_failed

echo.
echo Desktop app requirements installed.
goto action_done

:start_minio_window
echo Starting Docker / MinIO in a new window...
echo Make sure Docker Desktop is open first.
start "PETC MinIO" cmd /k call "%~f0" minio
goto action_done

:run_minio
cd /d "%ROOT%"
docker compose up minio
exit /b %ERRORLEVEL%

:start_renderer_window
if not exist "%RENDERER%\node_modules" (
  echo Renderer dependencies were not found. Run option 1 first.
  goto action_failed
)
echo Starting renderer in a new window: http://127.0.0.1:5173
start "PETC Renderer" cmd /k call "%~f0" renderer
goto action_done

:start_electron_window
if not exist "%DESKTOP%\node_modules" (
  echo Electron desktop dependencies were not found. Run option 1 first.
  goto action_failed
)
echo Starting Electron in a new window...
start "PETC Electron" cmd /k call "%~f0" electron
goto action_done

:start_sidecar_window
if not exist "%VENV_PY%" (
  echo Python sidecar venv was not found. Run option 1 first.
  goto action_failed
)
echo Starting optional manual sidecar in a new window: http://127.0.0.1:8765
start "PETC Sidecar API" cmd /k call "%~f0" sidecar
goto action_done

:run_renderer
if not exist "%RENDERER%\node_modules" (
  echo Renderer dependencies were not found. Run option 1 first.
  exit /b 1
)
cd /d "%RENDERER%"
call npm.cmd run dev -- --host 127.0.0.1
exit /b %ERRORLEVEL%

:run_electron
if not exist "%DESKTOP%\node_modules" (
  echo Electron desktop dependencies were not found. Run option 1 first.
  exit /b 1
)
cd /d "%DESKTOP%"
echo Building Electron main process...
call npm.cmd run build:electron
if errorlevel 1 exit /b %ERRORLEVEL%
echo Launching Electron desktop app...
call npm.cmd run electron
exit /b %ERRORLEVEL%

:run_sidecar
if not exist "%VENV_PY%" (
  echo Python sidecar venv was not found. Run option 1 first.
  exit /b 1
)
cd /d "%DESKTOP%"
if not exist "%MOCK_DATA%" mkdir "%MOCK_DATA%"
set "PETC_DATA_DIR=%MOCK_DATA%"
set "PETC_PORT=8765"
set "PETC_GOV_MOCK=true"
"%VENV_PY%" -m petc.service
exit /b %ERRORLEVEL%

:stop_localhost
echo Stopping PETC Electron processes launched from this repo...
powershell -NoProfile -Command "$root = '%ROOT%'; Get-CimInstance Win32_Process -Filter 'Name = ''electron.exe''' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ('*' + $root + '*') } | ForEach-Object { Write-Host ('Stopping Electron PID {0}' -f $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Stopping localhost processes on ports 5173 and 8765...
powershell -NoProfile -Command "$ports = @(5173, 8765); foreach ($port in $ports) { $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach ($connection in $connections) { Write-Host ('Stopping PID {0} on port {1}' -f $connection.OwningProcess, $port); Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue } }"
echo Done.
goto action_done

:action_done
if /I "%MODE%"=="single" exit /b 0
pause
goto menu

:action_failed
if /I "%MODE%"=="single" exit /b 1
pause
goto menu
