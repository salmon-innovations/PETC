from pathlib import Path

import pytest

from petc.config import ConfigError, load_config, mask_secret, parse_properties, write_config


def test_properties_parse_and_mask_key(tmp_path: Path):
    path = tmp_path / "petc.properties"
    path.write_text("# comment\npetc.profile=dev\npetc.cloud.url=http://cloud.test\npetc.cloud.key=issued-secret-key\npetc.expected.center=C-1\npetc.expected.lane=2\n")
    config = load_config(path)
    assert config.expected_lane == 2
    assert config.public()["keyMasked"] == "••••••••-key"
    assert "issued-secret-key" not in str(config.public())


def test_missing_or_invalid_lane_config_fails_closed(tmp_path: Path):
    with pytest.raises(ConfigError):
        load_config(tmp_path / "missing.properties")
    with pytest.raises(ConfigError):
        write_config(
            cloud_url="http://cloud.test", cloud_key="key", expected_center="C-1",
            expected_lane="lane-2", profile="dev", path=tmp_path / "petc.properties",
        )


def test_properties_rejects_malformed_line():
    with pytest.raises(ConfigError):
        parse_properties("petc.profile=dev\nbroken")


def test_readiness_fails_closed_for_missing_config(monkeypatch, tmp_path: Path):
    from petc.api.server import _readiness_status
    monkeypatch.delenv("PETC_TEST_ALLOW_UNCONFIGURED", raising=False)
    monkeypatch.setenv("PETC_CONFIG_PATH", str(tmp_path / "missing.properties"))
    _config, readiness = _readiness_status(None, None)
    assert readiness["ready"] is False
    assert "commissioning" in readiness["reason"].lower()


def test_readiness_blocks_identity_wallet_and_quota(monkeypatch, tmp_path: Path):
    from datetime import datetime, timezone
    from petc.api.server import _readiness_status, _MANILA
    config_path = tmp_path / "petc.properties"
    write_config(cloud_url="http://cloud.test", cloud_key="issued-key", expected_center="CENTER-1", expected_lane=2, profile="dev", path=config_path)
    monkeypatch.delenv("PETC_TEST_ALLOW_UNCONFIGURED", raising=False)
    monkeypatch.setenv("PETC_CONFIG_PATH", str(config_path))
    now = datetime.now(timezone.utc)
    _config, readiness = _readiness_status({
        "center_id": "OTHER", "lane_id": "lane-9", "lane_number": 9, "active": True,
        "remaining": 0, "business_date": datetime.now(_MANILA).date().isoformat(), "fetched_at": now,
    }, {
        "balance_centavos": 0, "charge_per_upload_centavos": 100, "negative": False, "fetched_at": now,
    })
    assert readiness["ready"] is False
    assert "does not match" in readiness["reason"]
    assert "wallet" in readiness["reason"].lower()
    assert "quota" in readiness["reason"].lower()


def test_startup_production_compliance_error_blocks_readiness(monkeypatch, tmp_path: Path):
    from datetime import datetime, timezone
    from petc.api.server import _readiness_status
    path = tmp_path / "petc.properties"
    write_config(cloud_url="https://cloud.test", cloud_key="issued-key", expected_center="CENTER-1", expected_lane=1, profile="production", path=path)
    monkeypatch.delenv("PETC_TEST_ALLOW_UNCONFIGURED", raising=False)
    monkeypatch.setenv("PETC_CONFIG_PATH", str(path))
    monkeypatch.setenv("PETC_STARTUP_COMPLIANCE_ERROR", "Production profile is not compliant: PETC_GOV_MOCK must be false")
    now = datetime.now(timezone.utc)
    _config, readiness = _readiness_status({"center_id": "CENTER-1", "lane_number": 1, "active": True, "remaining": 1, "business_date": datetime.now().date().isoformat(), "fetched_at": now}, {"balance_centavos": 100, "charge_per_upload_centavos": 100, "negative": False, "fetched_at": now})
    assert readiness["ready"] is False
    assert "PETC_GOV_MOCK" in readiness["reason"]
