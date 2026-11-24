"""Add file_format field to Dataset for multi-format tabular support."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("datasets", "0004_storedfiledeletion"),
    ]

    operations = [
        migrations.AddField(
            model_name="dataset",
            name="file_format",
            field=models.CharField(
                choices=[
                    ("csv", "CSV"),
                    ("tsv", "TSV"),
                    ("parquet", "Parquet"),
                    ("xlsx", "Excel"),
                    ("json", "JSON"),
                    ("ndjson", "NDJSON"),
                ],
                default="csv",
                max_length=12,
            ),
        ),
    ]
