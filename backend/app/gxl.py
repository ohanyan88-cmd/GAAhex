"""GXL — the shared expression language (M4 slice).

Used for workflow transition guards (and later: validation, ABAC, KPIs). Evaluated in a
sandbox (no builtins, no attribute access) via simpleeval. The production target is CEL
(per the blueprint); this is a safe subset to prove the engine.
"""
from simpleeval import EvalWithCompoundTypes, NameNotDefined


def evaluate(expr: str | None, context: dict) -> bool:
    """Evaluate a boolean guard expression against a context of field values.

    Empty/None guard → always True (no guard). Unknown names resolve to None so a missing
    field reads as null rather than erroring.
    """
    if not expr:
        return True
    evaluator = EvalWithCompoundTypes(names=dict(context))
    # missing names → None (so `phone != None` works when phone was never set)
    evaluator.names.setdefault  # noqa
    try:
        return bool(_eval_with_default_none(evaluator, expr))
    except Exception:
        # a broken guard is treated as not-satisfied (fail closed)
        return False


def _eval_with_default_none(evaluator: EvalWithCompoundTypes, expr: str):
    try:
        return evaluator.eval(expr)
    except NameNotDefined as e:
        # define the missing name as None and retry (bounded by number of distinct names)
        name = getattr(e, "name", None)
        if not name:
            raise
        evaluator.names[name] = None
        return _eval_with_default_none(evaluator, expr)
