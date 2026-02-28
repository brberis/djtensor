from rest_framework.permissions import BasePermission, SAFE_METHODS
from .models import StudyMembership


def get_user_study_role(user, study):
    """Return the user's role for a study, or None if no membership."""
    if user.is_superuser:
        return 'owner'
    try:
        membership = StudyMembership.objects.get(study=study, user=user)
        return membership.role
    except StudyMembership.DoesNotExist:
        return None


def effective_role(user, study):
    """Return the effective role considering study mode.
    In 'review' mode, editors are downgraded to viewers."""
    role = get_user_study_role(user, study)
    if role is None:
        return None
    if study.mode == 'review' and role == 'editor':
        return 'viewer'
    return role


def _get_study(obj):
    """Extract study from an object (TrainingSession, Test, Dataset, etc.)."""
    if hasattr(obj, 'study') and obj.study:
        return obj.study
    if hasattr(obj, 'training_session') and obj.training_session:
        return obj.training_session.study
    return None


class CanCreateInStudy(BasePermission):
    """Check study membership on POST/create using study_id from request data."""

    def has_permission(self, request, view):
        if request.method != 'POST':
            return True
        study_id = request.data.get('study_id')
        if not study_id:
            return True  # Let serializer validation handle missing study_id
        from .models import Study
        try:
            study = Study.objects.get(pk=study_id)
        except Study.DoesNotExist:
            return True  # Let serializer handle invalid study_id
        role = effective_role(request.user, study)
        return role in ('owner', 'editor')


class IsStudyMember(BasePermission):
    """Allow access only to users who are members of the study."""

    def has_object_permission(self, request, view, obj):
        study = _get_study(obj)
        if not study:
            return request.user.is_superuser
        role = get_user_study_role(request.user, study)
        return role is not None


class IsStudyEditorOrOwner(BasePermission):
    """Allow mutations only for editors and owners (respects study mode)."""

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        study = _get_study(obj)
        if not study:
            return request.user.is_superuser
        role = effective_role(request.user, study)
        return role in ('owner', 'editor')


class IsStudyOwner(BasePermission):
    """Allow access only to study owners (for destructive ops like hard delete)."""

    def has_object_permission(self, request, view, obj):
        study = _get_study(obj)
        if not study:
            return request.user.is_superuser
        role = get_user_study_role(request.user, study)
        return role == 'owner'
