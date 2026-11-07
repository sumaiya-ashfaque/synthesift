"""Store dry-run previews and immutable derived dataset lineage."""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ai_remediation", "0001_initial"),
        ("datasets", "0003_datasetprofile"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RemediationRun",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("operations", models.JSONField(default=list)),
                ("status", models.CharField(max_length=12, choices=[("previewed", "Previewed"), ("applied", "Applied")], default="previewed")),
                ("source_digest", models.CharField(max_length=64)),
                ("profile_digest", models.CharField(max_length=64)),
                ("preview", models.JSONField(default=dict)),
                ("validation", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("applied_at", models.DateTimeField(blank=True, null=True)),
                ("dataset", models.ForeignKey(to="datasets.dataset", on_delete=django.db.models.deletion.CASCADE, related_name="remediation_runs")),
                ("report", models.ForeignKey(to="ai_remediation.aireport", on_delete=django.db.models.deletion.PROTECT, related_name="remediation_runs")),
                ("requested_by", models.ForeignKey(to=settings.AUTH_USER_MODEL, blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="remediation_runs")),
                ("result_dataset", models.OneToOneField(to="datasets.dataset", blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="derived_by_remediation")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
