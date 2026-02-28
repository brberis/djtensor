import { useAuth } from '../contexts/AuthContext';

export function usePermissions() {
  const { user } = useAuth();

  const getStudyRole = (studyId) => {
    if (!user) return null;
    if (user.isSuperuser) return 'owner';
    return user.studyRoles?.[String(studyId)] || null;
  };

  const getEffectiveRole = (studyId, studyMode) => {
    const role = getStudyRole(studyId);
    if (!role) return null;
    if (studyMode === 'review' && role === 'editor') return 'viewer';
    return role;
  };

  const canMutate = (studyId, studyMode) => {
    const role = getEffectiveRole(studyId, studyMode);
    return role === 'owner' || role === 'editor';
  };

  const canDelete = (studyId) => {
    return getStudyRole(studyId) === 'owner';
  };

  const canManageMembers = (studyId) => {
    return getStudyRole(studyId) === 'owner';
  };

  const isOwner = (studyId) => getStudyRole(studyId) === 'owner';

  return { getStudyRole, getEffectiveRole, canMutate, canDelete, canManageMembers, isOwner };
}
