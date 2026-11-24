"""One-click realistic multi-format demo dataset seeder for instant exploration."""

from __future__ import annotations

import csv
import io
import json
import math
import random

import polars as pl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.policy import require_role

from .api import authorized_project
from .ingestion import inspect_csv
from .models import Dataset, DatasetProfile
from .profiling import profile_dataset
from .quality import assess_quality
from .serializers import DatasetSerializer
from .storage import infer_file_format, save_upload, storage_path


def _build_saas_billing_csv() -> bytes:
    """Realistic B2B SaaS billing ledger with PII, outliers, whitespace, sentinel nulls, dupes."""
    rng = random.Random(20261124)
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "invoice_id",
            "account_code",
            "customer_name",
            "billing_email",
            "support_phone",
            "plan_tier",
            "region",
            "seats",
            "mrr_usd",
            "discount_pct",
            "billed_on",
        ]
    )

    companies = [
        "Helvetia Analytics",
        "Northstar Bio",
        "Kestrel Robotics",
        "Vanguard Logistics",
        "Meridian Cloud",
        "Solstice FinTech",
        "Cobalt Health",
        "Arcadia Retail",
        "Stratos Energy",
        "Lumen Security",
    ]
    tiers = ["Enterprise", "Growth", "Starter"]
    regions = ["US-EAST", "EU-CENTRAL", "APAC", "US-WEST"]

    rows: list[list[str]] = []
    for i in range(1, 117):
        inv_id = f"INV-{10000 + i}"
        acct = f"00{4100 + (i % 38)}"
        company = companies[i % len(companies)]
        if i % 7 == 0:
            company = f"  {company} "
        slug = company.strip().lower().replace(" ", "")
        email = f"billing.{i}@{slug}.io"
        if i % 11 == 0:
            email = ""
        phone = f"+1-415-555-{1000 + (i * 17) % 8999}"
        if i % 13 == 0:
            phone = "N/A"
        tier = tiers[i % len(tiers)]
        if i % 9 == 0:
            tier = tier.lower()
        elif i % 15 == 0:
            tier = f" {tier.upper()} "
        region = regions[i % len(regions)]
        if i % 14 == 0:
            region = "null"
        elif i % 19 == 0:
            region = ""
        seats = rng.randint(5, 140)
        base_price = 48 if tier.strip().lower() == "enterprise" else (29 if tier.strip().lower() == "growth" else 14)
        mrr = round(seats * base_price + rng.uniform(-80, 120), 2)
        if i in {22, 67, 103}:
            # Extreme billing spikes (IQR outliers)
            mrr = round(rng.uniform(34000, 78500), 2)
        discount = round(rng.choice([0, 0, 5, 10, 15, 20]), 2)
        if i % 17 == 0:
            discount_str = ""
        else:
            discount_str = f"{discount:.2f}"
        day = 1 + (i % 28)
        month = 10 + (i % 3)
        billed_on = f"2026-{month:02d}-{day:02d}"
        row = [
            inv_id,
            acct,
            company,
            email,
            phone,
            tier,
            region,
            str(seats),
            f"{mrr:.2f}",
            discount_str,
            billed_on,
        ]
        rows.append(row)

    # Inject 4 exact duplicate rows to exercise uniqueness & remediation flows
    rows.extend(rows[:4])
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _build_ml_churn_parquet() -> bytes:
    """Realistic ML churn feature dataset in Apache Parquet format."""
    rng = random.Random(9001)
    n = 160
    customer_ids = [f"CUST-{5000 + i}" for i in range(n)]
    tenure = [rng.randint(1, 60) for _ in range(n)]
    monthly_spend = [round(25.0 + t * 2.4 + rng.gauss(0, 18), 2) for t in tenure]
    # Add outliers
    monthly_spend[12] = 980.50
    monthly_spend[88] = 1245.00
    monthly_spend[141] = 1120.75

    # Skewed inactivity metric
    days_since_login = [int(round(math.exp(rng.uniform(0.2, 3.6)))) for _ in range(n)]
    days_since_login[33] = 340
    days_since_login[119] = 412

    support_tickets = [max(0, int(round(days / 28 + rng.gauss(1.2, 1.5)))) for days in days_since_login]
    nps_score = [None if i % 3 == 0 else rng.randint(-100, 100) for i in range(n)]
    churned = [days > 24 or tickets > 5 for days, tickets in zip(days_since_login, support_tickets, strict=True)]
    cohort = ["2026-Q4-PROD"] * n

    frame = pl.DataFrame(
        {
            "customer_id": customer_ids,
            "tenure_months": tenure,
            "monthly_spend": monthly_spend,
            "days_since_login": days_since_login,
            "support_tickets": support_tickets,
            "nps_score": nps_score,
            "churn_label": churned,
            "model_cohort": cohort,
        }
    )
    buffer = io.BytesIO()
    frame.write_parquet(buffer)
    return buffer.getvalue()


def _build_vendor_orders_json() -> bytes:
    """Vendor fulfillment feed in JSON array format with leading zeros, URLs, IPs, emails."""
    rng = random.Random(4242)
    statuses = ["Shipped", "Delivered", "Pending", "shipped", "DELIVERED", " - "]
    records = []
    for i in range(1, 79):
        records.append(
            {
                "order_id": f"000{200 + i}",
                "vendor_sku": f"SKU-{100 + (i % 19)}",
                "contact_email": f"ops{i}@vendor-hub.test" if i % 9 != 0 else "",
                "source_ip": f"192.168.{i % 12}.{10 + (i * 3) % 230}",
                "tracking_url": f"https://track.logistics.example/pkg/{880000 + i}",
                "fulfillment_status": statuses[i % len(statuses)],
                "unit_count": rng.randint(1, 45),
                "order_total_usd": round(rng.uniform(45.0, 950.0) if i != 40 else 18450.00, 2),
            }
        )
    records.append(dict(records[2]))
    records.append(dict(records[5]))
    return json.dumps(records, indent=2).encode("utf-8")


def seed_demo_datasets(*, project, user) -> list[Dataset]:
    """Create, admit, and profile 3 realistic multi-format datasets in a project."""
    specs = [
        ("saas_billing_q4.csv", "text/csv", _build_saas_billing_csv()),
        ("ml_churn_features.parquet", "application/octet-stream", _build_ml_churn_parquet()),
        ("vendor_orders_dirty.json", "application/json", _build_vendor_orders_json()),
    ]
    created: list[Dataset] = []
    stored_keys: list[str] = []

    try:
        with transaction.atomic():
            for filename, content_type, payload in specs:
                uploaded = SimpleUploadedFile(filename, payload, content_type=content_type)
                key, checksum, size = save_upload(uploaded)
                stored_keys.append(key)

                dataset = Dataset.objects.create(
                    project=project,
                    uploaded_by=user,
                    filename=filename,
                    file_format=infer_file_format(filename),
                    storage_key=key,
                    sha256=checksum,
                    size_bytes=size,
                    status=Dataset.Status.QUEUED,
                )
                validated = inspect_csv(dataset)
                now = timezone.now()
                dataset.status = Dataset.Status.READY
                dataset.row_count = validated.row_count
                dataset.column_count = len(validated.columns)
                dataset.columns = validated.columns
                dataset.completed_at = now
                dataset.save(
                    update_fields=[
                        "status",
                        "row_count",
                        "column_count",
                        "columns",
                        "completed_at",
                    ]
                )
                summary = profile_dataset(dataset)
                summary["quality"] = assess_quality(summary)
                DatasetProfile.objects.create(
                    dataset=dataset,
                    status=DatasetProfile.Status.READY,
                    schema_version=2,
                    result=summary,
                    completed_at=timezone.now(),
                )
                created.append(dataset)
    except Exception:
        for key in stored_keys:
            storage_path(key).unlink(missing_ok=True)
        raise

    return created


class DatasetDemoSeedView(APIView):
    """Populate a project with realistic, pre-profiled multi-format sample datasets."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["datasets"],
        request=None,
        responses={
            201: DatasetSerializer(many=True),
            403: OpenApiResponse(description="Owner or editor access required"),
        },
    )
    def post(self, request, workspace_id, project_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        datasets = seed_demo_datasets(project=project, user=request.user)
        return Response(
            DatasetSerializer(datasets, many=True).data,
            status=status.HTTP_201_CREATED,
        )
