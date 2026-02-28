from django.db import migrations


def seed_memberships(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    Study = apps.get_model('feature_extractor', 'Study')
    StudyMembership = apps.get_model('feature_extractor', 'StudyMembership')
    TrainingSession = apps.get_model('feature_extractor', 'TrainingSession')
    Test = apps.get_model('feature_extractor', 'Test')

    # Use first superuser (cris) as the default owner
    owner = User.objects.filter(is_superuser=True).order_by('id').first()
    if not owner:
        return

    for study in Study.objects.all():
        StudyMembership.objects.get_or_create(
            study=study, user=owner,
            defaults={'role': 'owner'}
        )

    TrainingSession.objects.filter(created_by__isnull=True).update(created_by=owner)
    Test.objects.filter(created_by__isnull=True).update(created_by=owner)


def reverse_seed(apps, schema_editor):
    StudyMembership = apps.get_model('feature_extractor', 'StudyMembership')
    StudyMembership.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('feature_extractor', '0023_study_mode_test_archived_at_test_archived_by_and_more'),
    ]
    operations = [
        migrations.RunPython(seed_memberships, reverse_seed),
    ]
