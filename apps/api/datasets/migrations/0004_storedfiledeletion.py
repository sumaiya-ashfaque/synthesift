"""Durable deletion queue for source and derived CSV bytes."""

import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("datasets", "0003_datasetprofile")]

    operations = [
        migrations.CreateModel(
            name="StoredFileDeletion",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("storage_key", models.CharField(max_length=120, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["created_at", "id"]},
        ),
    ]
