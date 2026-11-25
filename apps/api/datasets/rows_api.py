"""DuckDB-powered paginated Data Grid API with cell diagnostics and PII masking."""

from __future__ import annotations

import logging
import math
from typing import Any

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.policy import role_for

from .api import authorized_project
from .formats import AdmissionError, connect_duckdb_dataset
from .models import Dataset, DatasetProfile
from .pii import SENTINEL_NULLS, detect_pii_kind, is_sentinel_null, mask_cell_value

logger = logging.getLogger(__name__)

_SENTINEL_LIST_SQL = ", ".join(f"'{token}'" for token in sorted(SENTINEL_NULLS))


class DatasetRowsNotReady(APIException):
    status_code = 409
    default_detail = "Dataset must finish admission before rows can be explored."
    default_code = "dataset_not_ready"


class DatasetRowsSourceError(APIException):
    status_code = 422
    default_detail = "The dataset source could not be read for grid exploration."
    default_code = "source_unreadable"


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _parse_int(raw: str | None, default: int, minimum: int, maximum: int) -> int:
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValidationError({"query": "Pagination parameters must be integers."}) from exc
    return max(minimum, min(maximum, value))


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None or raw == "":
        return default
    lowered = raw.strip().lower()
    if lowered in {"true", "1", "yes"}:
        return True
    if lowered in {"false", "0", "no"}:
        return False
    return default


def _profile_column_meta(dataset: Dataset) -> tuple[dict[str, set[str]], dict[str, tuple[float, float]]]:
    """Read saved PII column flags and IQR outlier bounds if a profile exists."""
    pii_map: dict[str, set[str]] = {}
    outlier_bounds: dict[str, tuple[float, float]] = {}

    profile = DatasetProfile.objects.filter(
        dataset=dataset,
        status=DatasetProfile.Status.READY,
    ).first()
    if not profile or not isinstance(profile.result, dict):
        return pii_map, outlier_bounds

    for col in profile.result.get("columns", []):
        if not isinstance(col, dict):
            continue
        name = col.get("name")
        if not isinstance(name, str):
            continue
        signals = col.get("pii_signals") or []
        kinds = {
            sig["kind"]
            for sig in signals
            if isinstance(sig, dict) and isinstance(sig.get("kind"), str)
        }
        if kinds:
            pii_map[name] = kinds
        dist = col.get("distribution")
        if isinstance(dist, dict):
            bounds = dist.get("outlier_bounds")
            if (
                isinstance(bounds, dict)
                and isinstance(bounds.get("lower"), (int, float))
                and isinstance(bounds.get("upper"), (int, float))
                and (dist.get("iqr") or 0) > 0
            ):
                outlier_bounds[name] = (float(bounds["lower"]), float(bounds["upper"]))

    return pii_map, outlier_bounds


def _is_numeric_outlier(raw: str, bounds: tuple[float, float] | None) -> bool:
    if bounds is None:
        return False
    stripped = raw.strip()
    if not stripped:
        return False
    try:
        val = float(stripped)
    except ValueError:
        return False
    if not math.isfinite(val):
        return False
    return val < bounds[0] or val > bounds[1]


class DatasetRowsView(APIView):
    """Explore paginated rows via isolated in-memory DuckDB queries."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["datasets"],
        parameters=[
            OpenApiParameter("limit", int, required=False),
            OpenApiParameter("offset", int, required=False),
            OpenApiParameter("sort_by", str, required=False),
            OpenApiParameter("sort_dir", str, required=False),
            OpenApiParameter("search", str, required=False),
            OpenApiParameter("filter_col", str, required=False),
            OpenApiParameter("filter_op", str, required=False),
            OpenApiParameter("filter_val", str, required=False),
            OpenApiParameter("issue_only", str, required=False),
            OpenApiParameter("mask_pii", bool, required=False),
        ],
        responses={
            200: OpenApiResponse(description="Paginated rows with cell diagnostics"),
            403: OpenApiResponse(description="Unmasking PII requires editor or owner access"),
            409: OpenApiResponse(description="Dataset is not ready"),
        },
    )
    def get(self, request, workspace_id, project_id, dataset_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)

        if dataset.status != Dataset.Status.READY:
            raise DatasetRowsNotReady()

        user_role = role_for(request.user, workspace)
        can_unmask = user_role in {"owner", "editor"}
        mask_pii = _parse_bool(request.query_params.get("mask_pii"), default=True)
        if not mask_pii and not can_unmask:
            raise PermissionDenied("Only workspace owners and editors can reveal unmasked PII cells.")
        if not mask_pii:
            from governance.services import record_audit_event

            record_audit_event(
                workspace,
                actor=request.user,
                action="pii.unmasked",
                resource_type="dataset",
                resource_id=str(dataset.id),
                outcome="warning",
                metadata={"filename": dataset.filename},
            )

        limit = _parse_int(request.query_params.get("limit"), default=50, minimum=1, maximum=200)
        offset = _parse_int(request.query_params.get("offset"), default=0, minimum=0, maximum=250_000)
        sort_by = (request.query_params.get("sort_by") or "").strip()
        sort_dir = (request.query_params.get("sort_dir") or "asc").strip().lower()
        if sort_dir not in {"asc", "desc"}:
            sort_dir = "asc"
        search = (request.query_params.get("search") or "").strip()[:120]
        filter_col = (request.query_params.get("filter_col") or "").strip()
        filter_op = (request.query_params.get("filter_op") or "").strip().lower()
        filter_val = (request.query_params.get("filter_val") or "")[:200]
        issue_only = (request.query_params.get("issue_only") or "all").strip().lower()

        pii_map, outlier_bounds = _profile_column_meta(dataset)

        conn = None
        try:
            conn, columns, total_rows = connect_duckdb_dataset(dataset)
            col_set = set(columns)

            where_clauses: list[str] = []
            params: list[Any] = []

            if search:
                # Never allow searching inside masked PII columns when mask_pii is enabled.
                searchable = [
                    col for col in columns
                    if not (mask_pii and col in pii_map)
                ]
                if searchable:
                    like_exprs = [
                        f"LOWER(COALESCE({_quote_ident(col)}, '')) LIKE LOWER(?)"
                        for col in searchable
                    ]
                    where_clauses.append("(" + " OR ".join(like_exprs) + ")")
                    pattern = f"%{search}%"
                    params.extend([pattern] * len(searchable))
                else:
                    where_clauses.append("1 = 0")

            if filter_col:
                if filter_col not in col_set:
                    raise ValidationError({"filter_col": "Unknown column name."})
                qcol = _quote_ident(filter_col)
                if filter_op == "is_null":
                    where_clauses.append(f"TRIM(COALESCE({qcol}, '')) = ''")
                elif filter_op == "not_null":
                    where_clauses.append(f"TRIM(COALESCE({qcol}, '')) <> ''")
                elif filter_op == "has_whitespace":
                    where_clauses.append(
                        f"COALESCE({qcol}, '') <> '' AND COALESCE({qcol}, '') <> TRIM(COALESCE({qcol}, ''))"
                    )
                elif filter_op == "is_sentinel_null":
                    where_clauses.append(
                        f"LOWER(TRIM(COALESCE({qcol}, ''))) IN ({_SENTINEL_LIST_SQL})"
                    )
                elif filter_op == "is_outlier":
                    bounds = outlier_bounds.get(filter_col)
                    if bounds is None:
                        where_clauses.append("1 = 0")
                    else:
                        where_clauses.append(
                            f"(TRY_CAST(TRIM({qcol}) AS DOUBLE) < ? OR TRY_CAST(TRIM({qcol}) AS DOUBLE) > ?)"
                        )
                        params.extend([bounds[0], bounds[1]])
                elif filter_op == "eq":
                    if mask_pii and filter_col in pii_map:
                        where_clauses.append("1 = 0")
                    else:
                        where_clauses.append(f"COALESCE({qcol}, '') = ?")
                        params.append(filter_val)
                elif filter_op == "contains":
                    if mask_pii and filter_col in pii_map:
                        where_clauses.append("1 = 0")
                    else:
                        where_clauses.append(f"LOWER(COALESCE({qcol}, '')) LIKE LOWER(?)")
                        params.append(f"%{filter_val}%")

            if issue_only in {"any", "nulls", "whitespace", "sentinel", "outliers"}:
                issue_parts: list[str] = []
                if issue_only in {"any", "nulls"}:
                    issue_parts.extend(
                        f"TRIM(COALESCE({_quote_ident(col)}, '')) = ''"
                        for col in columns
                    )
                if issue_only in {"any", "whitespace"}:
                    issue_parts.extend(
                        f"(COALESCE({_quote_ident(col)}, '') <> '' AND COALESCE({_quote_ident(col)}, '') <> TRIM(COALESCE({_quote_ident(col)}, '')))"
                        for col in columns
                    )
                if issue_only in {"any", "sentinel"}:
                    issue_parts.extend(
                        f"LOWER(TRIM(COALESCE({_quote_ident(col)}, ''))) IN ({_SENTINEL_LIST_SQL})"
                        for col in columns
                    )
                if issue_only in {"any", "outliers"}:
                    for col, bounds in outlier_bounds.items():
                        if col in col_set:
                            qcol = _quote_ident(col)
                            issue_parts.append(
                                f"(TRY_CAST(TRIM({qcol}) AS DOUBLE) < ? OR TRY_CAST(TRIM({qcol}) AS DOUBLE) > ?)"
                            )
                            params.extend([bounds[0], bounds[1]])

                if issue_parts:
                    where_clauses.append("(" + " OR ".join(issue_parts) + ")")
                else:
                    where_clauses.append("1 = 0")

            where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

            order_sql = ' ORDER BY "_row_index" ASC'
            if sort_by:
                if sort_by not in col_set:
                    raise ValidationError({"sort_by": "Unknown sort column."})
                qsort = _quote_ident(sort_by)
                direction = "DESC" if sort_dir == "desc" else "ASC"
                order_sql = (
                    f" ORDER BY COALESCE(TRY_CAST(TRIM({qsort}) AS DOUBLE), NULL) {direction} NULLS LAST, "
                    f"{qsort} {direction} NULLS LAST, \"_row_index\" ASC"
                )

            filtered_rows = int(
                conn.execute(f"SELECT COUNT(*) FROM dataset_rows{where_sql}", params).fetchone()[0]
            )

            select_cols = ", ".join(['"_row_index"'] + [_quote_ident(c) for c in columns])
            query_sql = f"SELECT {select_cols} FROM dataset_rows{where_sql}{order_sql} LIMIT ? OFFSET ?"
            raw_rows = conn.execute(query_sql, [*params, limit, offset]).fetchall()

            result_rows: list[dict[str, Any]] = []
            detected_pii_cols: set[str] = set(pii_map.keys())

            for record in raw_rows:
                row_index = int(record[0])
                cells: dict[str, str] = {}
                flags: dict[str, list[str]] = {}
                for col_name, raw_val in zip(columns, record[1:], strict=True):
                    text = "" if raw_val is None else str(raw_val)
                    cell_flags: list[str] = []
                    stripped = text.strip()

                    if not stripped:
                        cell_flags.append("null")
                    else:
                        if text != stripped:
                            cell_flags.append("whitespace")
                        if is_sentinel_null(text):
                            cell_flags.append("sentinel_null")
                        if _is_numeric_outlier(text, outlier_bounds.get(col_name)):
                            cell_flags.append("outlier")

                    col_pii_kinds = pii_map.get(col_name)
                    if not col_pii_kinds and stripped:
                        inline_pii = detect_pii_kind(stripped)
                        if inline_pii is not None:
                            detected_pii_cols.add(col_name)
                            col_pii_kinds = {inline_pii}

                    display_text = text
                    if mask_pii and col_pii_kinds:
                        masked, was_masked = mask_cell_value(text, col_pii_kinds)
                        if was_masked:
                            display_text = masked
                            cell_flags.append("pii_masked")

                    cells[col_name] = display_text
                    if cell_flags:
                        flags[col_name] = cell_flags

                result_rows.append(
                    {
                        "row_index": row_index,
                        "cells": cells,
                        "flags": flags,
                    }
                )

            return Response(
                {
                    "total_rows": total_rows,
                    "filtered_rows": filtered_rows,
                    "limit": limit,
                    "offset": offset,
                    "mask_pii": mask_pii,
                    "can_unmask_pii": can_unmask,
                    "pii_columns": sorted(detected_pii_cols),
                    "columns": columns,
                    "rows": result_rows,
                },
                status=status.HTTP_200_OK,
            )
        except (ValidationError, PermissionDenied):
            raise
        except (AdmissionError, OSError, ValueError) as exc:
            logger.warning("Failed to query dataset rows for %s: %s", dataset.pk, exc)
            raise DatasetRowsSourceError() from exc
        finally:
            if conn is not None:
                conn.close()
