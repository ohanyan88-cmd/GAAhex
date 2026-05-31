"""Payment gateway adapters package.

Each adapter implements the PaymentGateway ABC (app.payment_gateway).
configure_payment_gateway() lazy-imports the right class when credentials are set.

Import paths:
    from app.adapters.payment.idram   import IdramGateway
    from app.adapters.payment.telcell import TelcellGateway
    from app.adapters.payment.arca    import ArcaGateway
    from app.adapters.payment.easypay import EasypayGateway

ACTIVATION STATUS per adapter (see each module for slot details):
    idram   — redirect URL complete; MD5 checksum verification complete; needs merchant creds
    telcell — redirect URL + HMAC complete; needs merchant creds + URL confirmation
    arca    — server-to-server register + HMAC + status-check complete; needs merchant creds
    easypay — redirect URL + HMAC complete; needs API docs from EasyPay + merchant creds
"""
