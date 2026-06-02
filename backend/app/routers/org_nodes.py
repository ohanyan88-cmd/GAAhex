"""Org-structure CRUD — create / rename / move / delete nodes of the recursive org spine.

The org spine (Group → Region → OpCo → BU → Division → Department → Team → Squad) is one
`org_node` row per node. `path` is a Postgres ltree (dot-separated, ltree-safe `code` labels,
e.g. `grp.yerevan.sales1`) so subtree / ancestor queries and rollups stay cheap. The READ side is
the public `/org-tree` endpoint (see main.py); these are the tenant-scoped WRITE endpoints.

All three are tenant-scoped and gated on `config.manage` (super_admin's `*` covers it) — the same
gate Studio and the entity Configure drawer use. Every write emits an audit Event through the usual
`workflow.emit` chokepoint.

Children policy on DELETE: a node with children is NOT cascaded — DELETE returns 409 and the caller
must delete leaves first (the UI can walk up the tree). This keeps the destructive blast radius to a
single node and avoids silently orphaning grants/assignments that scope to descendant paths.

Path recompute on MOVE: a moved node gets `new_parent_path + '.' + label`, and every descendant has
its path prefix rewritten (old subtree prefix → new subtree prefix) so the whole subtree stays
consistent. The tenant's node set is small, so we recompute in Python (consistent with how the rest
of the codebase reads OrgNode rows for a tenant) rather than with an in-DB ltree UPDATE.

NOTE: fixed path under /api ("/api/org/nodes"), so register BEFORE records.router ("/api/{slug}").
Post-commit `s.refresh()` fails under the RLS app role ("Could not refresh instance"), so every
handler returns the values it already holds rather than refreshing (see page_config.py / records.py).
"""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy_utils import Ltree

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User, OrgNode
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/org", tags=["org-structure"])

_LABEL_RE = re.compile(r"[^a-z0-9]+")


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage org structure")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="org_node",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


def _slug_label(raw: str) -> str:
    """An ltree-safe label: lowercase, [a-z0-9_] only. ltree labels can't be empty and must start
    with a letter/underscore — we prefix `n_` if it would otherwise start with a digit."""
    s = _LABEL_RE.sub("_", (raw or "").strip().lower()).strip("_")
    if not s:
        raise HTTPException(422, "code/name must contain at least one alphanumeric character")
    if s[0].isdigit():
        s = "n_" + s
    if len(s) > 50:
        s = s[:50].rstrip("_")
    return s


def _node_out(n: OrgNode) -> dict:
    return {
        "id": str(n.id),
        "type": n.type,
        "name": n.name,
        "code": n.code,
        "path": str(n.path),
        "parent_id": str(n.parent_id) if n.parent_id else None,
    }


async def _get_node(s: AsyncSession, tenant_id, node_id: uuid.UUID) -> OrgNode:
    n = (await s.execute(
        select(OrgNode).where(OrgNode.id == node_id, OrgNode.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if n is None:
        raise HTTPException(404, "Org node not found")
    return n


async def _tenant_nodes(s: AsyncSession, tenant_id) -> list[OrgNode]:
    return list((await s.execute(
        select(OrgNode).where(OrgNode.tenant_id == tenant_id)
    )).scalars().all())


def _unique_path(existing_paths: set[str], parent_path: str | None, label: str) -> str:
    """`parent_path.label` (or bare `label` at root), de-duplicated with a numeric suffix so two
    siblings sharing a code never collide on the ltree unique-ish path."""
    base = f"{parent_path}.{label}" if parent_path else label
    if base not in existing_paths:
        return base
    i = 2
    while f"{base}{i}" in existing_paths:
        i += 1
    return f"{base}{i}"


@router.get("/nodes")
async def list_nodes(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List org nodes for the current tenant.
    Read-only mirror of `/org-tree` flattened; primarily exists so GET /api/org/nodes
    returns a real shape instead of being captured by the /api/{slug} catch-all (422).
    """
    rows = (await s.execute(
        select(OrgNode).where(OrgNode.tenant_id == user.tenant_id).order_by(OrgNode.path)
    )).scalars().all()
    return {
        "nodes": [
            {
                "id": str(n.id),
                "type": n.type,
                "name": n.name,
                "code": n.code,
                "path": str(n.path),
                "parent_id": str(n.parent_id) if n.parent_id else None,
            }
            for n in rows
        ]
    }


@router.post("/nodes")
async def create_node(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a node under a parent (or at root). Gated on config.manage; emits an audit Event.

    Request:  { type, name, code?, parent_id? }
              - parent_id omitted/null ⇒ root node (path = label).
              - code defaults to a slug of name.
    Response: the created node {id, type, name, code, path, parent_id}.
    """
    await _require_config_manage(s, user)

    type_ = (payload.get("type") or "").strip()
    name = (payload.get("name") or "").strip()
    if not type_:
        raise HTTPException(422, "type is required")
    if not name:
        raise HTTPException(422, "name is required")
    code = (payload.get("code") or "").strip() or None
    label = _slug_label(code or name)

    parent_id_raw = payload.get("parent_id")
    parent: OrgNode | None = None
    if parent_id_raw:
        try:
            parent_id = uuid.UUID(str(parent_id_raw))
        except (ValueError, TypeError):
            raise HTTPException(422, "parent_id is not a valid id")
        parent = await _get_node(s, user.tenant_id, parent_id)

    existing = {str(n.path) for n in await _tenant_nodes(s, user.tenant_id)}
    parent_path = str(parent.path) if parent else None
    new_path = _unique_path(existing, parent_path, label)

    node = OrgNode(
        tenant_id=user.tenant_id,
        parent_id=parent.id if parent else None,
        type=type_,
        name=name,
        code=code,
        path=Ltree(new_path),
    )
    s.add(node)
    await s.flush()  # assign node.id for the audit Event / response (no post-commit refresh)

    out = _node_out(node)
    await workflow.emit(s, user.tenant_id, "CREATE", "org_node", node.id, user.id,
                        {"type": type_, "name": name, "path": new_path})
    await s.commit()
    # Post-commit s.refresh() 500s under the RLS app role; return the values we hold.
    return out


@router.patch("/nodes/{node_id}")
async def update_node(
    node_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Rename and/or move a node. Gated on config.manage; emits an audit Event.

    Request (all optional):
      - name        rename
      - code        re-code (also re-slugs this node's path label)
      - parent_id   MOVE under a new parent (null/"" ⇒ move to root)

    On move OR re-code the node's path label/prefix changes, so this node's path AND every
    descendant's path are recomputed. Response: the updated node.
    """
    await _require_config_manage(s, user)
    node = await _get_node(s, user.tenant_id, node_id)
    old_path = str(node.path)

    # --- rename / re-code -----------------------------------------------------------------------
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(422, "name cannot be empty")
        node.name = name
    recode = "code" in payload
    if recode:
        code = (payload.get("code") or "").strip() or None
        node.code = code

    # --- decide whether the path changes (move and/or re-code re-slugs the label) ---------------
    move = "parent_id" in payload
    new_parent: OrgNode | None = None
    if move:
        pid_raw = payload.get("parent_id")
        if pid_raw:
            try:
                pid = uuid.UUID(str(pid_raw))
            except (ValueError, TypeError):
                raise HTTPException(422, "parent_id is not a valid id")
            if pid == node.id:
                raise HTTPException(422, "a node cannot be its own parent")
            new_parent = await _get_node(s, user.tenant_id, pid)
            # Block moving a node under one of its own descendants (would orphan the subtree).
            np = str(new_parent.path)
            if np == old_path or np.startswith(old_path + "."):
                raise HTTPException(422, "cannot move a node under its own descendant")
        node.parent_id = new_parent.id if new_parent else None

    if move or recode:
        all_nodes = await _tenant_nodes(s, user.tenant_id)
        existing = {str(n.path) for n in all_nodes if n.id != node.id}
        # label: re-slug from the (possibly new) code/name when re-coding; else keep the old leaf label.
        if recode:
            label = _slug_label((node.code or node.name))
        else:
            label = old_path.rsplit(".", 1)[-1]
        # New parent prefix: the moved-to parent's path; if moving to root → None; if NOT moving
        # (re-code only) → keep the current parent prefix derived from the old path.
        if move:
            parent_path = str(new_parent.path) if new_parent else None
        else:
            parent_path = old_path.rsplit(".", 1)[0] if "." in old_path else None
        new_path = _unique_path(existing, parent_path, label)

        if new_path != old_path:
            node.path = Ltree(new_path)
            # Rewrite every descendant's path: old subtree prefix → new subtree prefix.
            prefix = old_path + "."
            for d in all_nodes:
                dp = str(d.path)
                if d.id != node.id and dp.startswith(prefix):
                    d.path = Ltree(new_path + "." + dp[len(prefix):])

    out = _node_out(node)
    await workflow.emit(s, user.tenant_id, "UPDATE", "org_node", node.id, user.id,
                        {"name": node.name, "old_path": old_path, "path": out["path"], "moved": move})
    await s.commit()
    # Post-commit s.refresh() 500s under the RLS app role; return the values we hold.
    return out


@router.delete("/nodes/{node_id}")
async def delete_node(
    node_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete a node. Gated on config.manage; emits an audit Event.

    Children policy: a node WITH children is NOT deleted — returns 409 with a clear message. Delete
    leaves first (the UI walks up the tree). This bounds the destructive blast radius to one node.

    Response: { ok: true, id }.
    """
    await _require_config_manage(s, user)
    node = await _get_node(s, user.tenant_id, node_id)

    child_count = sum(
        1 for n in await _tenant_nodes(s, user.tenant_id) if n.parent_id == node.id
    )
    if child_count:
        raise HTTPException(
            409,
            f"Cannot delete a node with {child_count} child node(s). Delete or move the children first.",
        )

    nid = node.id
    path = str(node.path)
    await s.delete(node)
    await workflow.emit(s, user.tenant_id, "DELETE", "org_node", nid, user.id, {"path": path})
    await s.commit()
    return {"ok": True, "id": str(nid)}
