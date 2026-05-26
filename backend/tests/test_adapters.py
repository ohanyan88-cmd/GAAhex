"""Coverage for the channel adapter registry + configure_adapters (channels.py, E17).

The dev adapters (log-only, no external calls) are registered at import time. configure_adapters()
swaps in real providers ONLY when env-configured; with no env it must leave email/sms as the dev
adapters so a fresh clone / the test suite behaves exactly as before. We assert by adapter identity
(no network send is ever performed) and restore the dev adapter afterwards so the registry stays
clean for the rest of the suite.
"""

from app import channels


def test_dev_adapters_registered_by_default():
    reg = channels.registered()
    assert {"inapp", "console", "email", "sms", "webhook"} <= set(reg)
    # email/sms are the dev (log-only) adapters, not the real providers
    assert reg["email"] is channels._email_adapter
    assert reg["sms"] is channels._sms_adapter


def test_configure_adapters_is_noop_without_env():
    # default settings (email_provider/sms_provider = "dev") → no real provider registered
    channels.configure_adapters()
    reg = channels.registered()
    assert reg["email"] is channels._email_adapter and reg["email"] is not channels._smtp_adapter
    assert reg["sms"] is channels._sms_adapter and reg["sms"] is not channels._twilio_adapter


def test_configure_adapters_swaps_email_to_smtp_when_configured(monkeypatch):
    monkeypatch.setattr(channels.settings, "email_provider", "smtp")
    monkeypatch.setattr(channels.settings, "smtp_host", "smtp.example.test")
    try:
        channels.configure_adapters()
        # email is now the real SMTP adapter; no message is sent (we never invoke it)
        assert channels.registered()["email"] is channels._smtp_adapter
        # sms is untouched (no Twilio env) → still the dev adapter
        assert channels.registered()["sms"] is channels._sms_adapter
    finally:
        # restore the dev email adapter so later tests/suite see the default registry
        channels.register("email", channels._email_adapter)
