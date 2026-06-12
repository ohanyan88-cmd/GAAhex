"""Wire the ``order.activated`` choreography subscribers (PERFECT-TARGET I3).

Importing this module registers the CRM / Care / Billing domain reactions on the kernel event bus, in
that order — **registration order matters**: CRM sets ``order.customer_id``, which Care + Billing then
read. ``main.py`` imports this once at startup so the subscribers are live before any order activates.

The order publisher (orders.py → workflow.complete_transition firing the transition's config-declared
``publish: order.activated``) knows nothing about these subscribers — this bootstrap is the only seam
that ties the domains to the event.
"""
from . import crm_activation, care_activation, billing_activation  # noqa: F401  (import == registration)
