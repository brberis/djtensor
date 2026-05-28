# Generated for the Phase 2 brokenness (mean-shape completeness) pipeline.
# See backend/datasets/brokenness/ for the algorithm (ported from Katie's
# notebooks in docs.local/).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('datasets', '0034_image_source_kind'),
    ]

    operations = [
        migrations.AddField(
            model_name='image',
            name='percent_broken',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='image',
            name='brokenness_overlay_url',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='image',
            name='brokenness_meta',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
