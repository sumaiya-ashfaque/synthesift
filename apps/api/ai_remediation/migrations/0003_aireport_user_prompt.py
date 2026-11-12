"""Optional, bounded user guidance for auditable AI reports."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ai_remediation", "0002_remediationrun")]

    operations = [
        migrations.AddField(
            model_name="aireport",
            name="user_prompt",
            field=models.CharField(blank=True, default="", max_length=600),
        ),
    ]
