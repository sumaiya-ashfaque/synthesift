import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("datasets", "0003_datasetprofile"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name="AIReport",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("status", models.CharField(max_length=16, default="queued", choices=[("queued", "Queued"), ("processing", "Processing"), ("ready", "Ready"), ("failed", "Failed") ])),
                ("technique", models.CharField(max_length=16, choices=[("zero_shot", "Zero-shot"), ("few_shot", "Few-shot"), ("stepwise", "Structured reasoning"), ("role_based", "Role-based") ])),
                ("model", models.CharField(max_length=48)),
                ("thinking_level", models.CharField(max_length=12, default="low")),
                ("temperature", models.DecimalField(max_digits=3, decimal_places=2, null=True)),
                ("max_output_tokens", models.PositiveIntegerField(default=2048)),
                ("profile_digest", models.CharField(max_length=64)),
                ("result", models.JSONField(default=dict)),
                ("error_code", models.CharField(max_length=48, blank=True)),
                ("consent_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(null=True, blank=True)),
                ("completed_at", models.DateTimeField(null=True, blank=True)),
                ("dataset", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="ai_reports", to="datasets.dataset")),
                ("requested_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="ai_reports", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddIndex(
            model_name="aireport",
            index=models.Index(fields=["dataset", "created_at"], name="ai_report_dataset_created"),
        ),
    ]
