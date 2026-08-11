import pytest

from petc.runtime import ProductionConfigError, validate_desktop_startup_config


def test_production_profile_rejects_mock_and_placeholder_settings(monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "production")
    with pytest.raises(ProductionConfigError) as exc:
        validate_desktop_startup_config(
            {
                "analyzer": "mock",
                "camera": "mock",
                "printer": "mock",
                "gov_mock": True,
                "cloud_url": "http://localhost:8080",
                "center_id": "dev-center",
                "cloud_key": "dev-insecure-key",
            }
        )
    message = str(exc.value)
    assert "PETC_GOV_MOCK" in message
    assert "PETC_ANALYZER" in message
    assert "PETC_CLOUD_KEY" in message


def test_production_profile_accepts_issued_settings(monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "production")
    runtime = validate_desktop_startup_config(
        {
            "analyzer": "serial_gas",
            "camera": "opencv",
            "printer": "system",
            "gov_mock": False,
            "cloud_url": "https://petc-api.example.gov",
            "center_id": "PETC-001",
            "cloud_key": "issued-center-key",
        }
    )
    assert runtime.profile == "production"


def test_production_commissioning_can_temporarily_defer_hardware_enforcement(monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "production")
    runtime = validate_desktop_startup_config(
        {
            "analyzer": "mock",
            "camera": "mock",
            "printer": "mock",
            "gov_mock": True,
            "enforce_hardware": False,
            "cloud_url": "https://app.petc.siiportal.com",
            "center_id": "makati-etc",
            "cloud_key": "issued-center-key",
        }
    )
    assert runtime.enforce_hardware is False
