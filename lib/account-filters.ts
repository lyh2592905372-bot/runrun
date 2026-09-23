import type { Account, FaceOption, RunningType, School } from '@/lib/types';

export type AccountFilterValues = {
  search: string;
  category: string;
  school: string;
  runningType: string;
  faceOption: string;
  dateFilter: string;
  dateFrom: string;
  dateTo: string;
  sportBinding: string;
  sportSyncStatus: string;
};

export function schoolsForCategory(schools: School[], categoryId: string) {
  return schools.filter((school) => !categoryId || school.category_id === categoryId);
}

export function runningTypesForSelection(runningTypes: RunningType[], availableSchools: School[], categoryId: string, schoolId: string) {
  if (schoolId) return runningTypes.filter((type) => type.school_id === schoolId);
  if (!categoryId) return runningTypes;
  const schoolIds = new Set(availableSchools.map((school) => school.id));
  return runningTypes.filter((type) => Boolean(type.school_id && schoolIds.has(type.school_id)));
}

export function faceOptionsForSelection(faceOptions: FaceOption[], availableTypes: RunningType[], categoryId: string, schoolId: string, runningTypeId: string) {
  if (runningTypeId) return faceOptions.filter((option) => option.running_type_id === runningTypeId);
  if (!schoolId && !categoryId) return faceOptions;
  const typeIds = new Set(availableTypes.map((type) => type.id));
  return faceOptions.filter((option) => Boolean(option.running_type_id && typeIds.has(option.running_type_id)));
}

export function accountMatchesFilters(account: Account, filters: AccountFilterValues, now = new Date()) {
  const term = filters.search.trim().toLowerCase();
  const schoolName = account.school?.name?.toLowerCase() || '';
  const matchesSearch = Boolean(!term
    || account.username.toLowerCase().includes(term)
    || schoolName.includes(term)
    || account.student_name?.toLowerCase().includes(term)
    || account.student_id?.toLowerCase().includes(term));
  const matchesCategory = !filters.category || account.category_id === filters.category;
  const matchesSchool = !filters.school || account.school_id === filters.school;
  const matchesRunningType = !filters.runningType || account.running_type_id === filters.runningType;
  const matchesFaceOption = !filters.faceOption || account.face_option_id === filters.faceOption;
  const sport = account.sport_world_accounts ? (Array.isArray(account.sport_world_accounts) ? account.sport_world_accounts[0] : account.sport_world_accounts) : null;
  const isBound = Boolean(sport?.sport_account);
  const matchesSportBinding = !filters.sportBinding || (filters.sportBinding === 'bound' ? isBound : !isBound);
  const matchesSportSyncStatus = !filters.sportSyncStatus || sport?.last_sync_status === filters.sportSyncStatus;
  const orderTime = new Date(account.order_time).getTime();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let matchesDate = true;
  if (filters.dateFilter === 'today') matchesDate = orderTime >= todayStart;
  if (filters.dateFilter === '7d') matchesDate = orderTime >= now.getTime() - 7 * 86400000;
  if (filters.dateFilter === '30d') matchesDate = orderTime >= now.getTime() - 30 * 86400000;
  if (filters.dateFilter === 'custom') {
    const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    matchesDate = orderTime >= from && orderTime <= to;
  }
  return matchesSearch && matchesCategory && matchesSchool && matchesRunningType && matchesFaceOption && matchesSportBinding && matchesSportSyncStatus && matchesDate;
}
