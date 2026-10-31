
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("datasets", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="dataset",
            name="processing_started_at",
            field=models.DateTimeField(
                null=True,
                blank=True,
            ),
        ),
    ]
