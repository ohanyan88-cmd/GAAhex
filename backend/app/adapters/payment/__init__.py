"""Payment gateway adapters package (A33/E33).

Each adapter implements the ``PaymentGateway`` ABC defined in
``app.payment_gateway``.  A33's ``configure_payment_gateway()`` lazy-imports
the appropriate class when merchant keys are present in the environment; this
package just makes the sub-modules importable.

Adapter import paths (used by A33's registry):
    from app.adapters.payment.idram   import IdramGateway
    from app.adapters.payment.telcell import TelcellGateway
    from app.adapters.payment.arca    import ArcaGateway

All three adapters are DORMANT SCAFFOLDS — correct HMAC discipline + structural
redirect-URL composition, but no real provider HTTP call until merchant
credentials are supplied and the real API spec is wired.  Each file marks the
exact spot with a ``# TODO: real <provider> API`` comment.
"""
