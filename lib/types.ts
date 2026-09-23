export type School = { id: string; category_id?: string | null; name: string; created_at: string; account_count?: number; category?: Category };
export type Category = { id: string; name: string; color: string; created_at: string; account_count?: number };
export type RunningType = { id: string; school_id: string | null; name: string; created_at: string; school?: School | null };
export type FaceOption = { id: string; running_type_id: string | null; name: string; created_at: string; running_type?: RunningType | null };
export type Account = {
  id: string; school_id: string | null; category_id: string | null; running_type_id?: string | null; face_option_id?: string | null; username: string; encrypted_password?: string | null;
  distance_per_run: number; order_count: number; order_time: string; running_time?: string | null; created_at: string; updated_at: string;
  campus_name?: string | null; fence_name?: string | null; student_name?: string | null; student_id?: string | null;
  note?: string | null; deleted_at?: string | null; school?: School | null; category?: Category | null; running_type?: RunningType | null; face_option?: FaceOption | null; progress?: Progress;
  sport_world_accounts?: SportWorldAccount | SportWorldAccount[] | null;
};
export type Progress = { id: string; account_id: string; completed_runs: number; updated_at: string };
export type SportWorldAccount = {
  id: string; account_record_id: string; sport_account: string | null; sport_uid?: string | null; sport_unid?: string | null;
  token_status: 'valid' | 'expired' | 'unknown' | 'need_verify'; sync_enabled: boolean; last_sync_at?: string | null;
  last_sync_status: 'never_synced' | 'syncing' | 'success' | 'failed' | 'token_expired' | 'need_verify'; last_sync_error?: string | null;
  current_semester?: string | null; semester_started_at?: string | null; semester_ended_at?: string | null; completion_status?: string | null; target_runs?: number | null; target_distance?: number | null; completed_runs?: number | null; completed_distance?: number | null;
  latest_run_at?: string | null; latest_run_distance?: number | null; manual_run_adjustment?: number | null; manual_distance_adjustment?: number | null;
  sync_started_at?: string | null; has_sport_password?: boolean;
};
export type SportWorldRunRecord = {
  id: string; account_record_id: string; sport_world_record_id: string; run_date?: string | null; start_time?: string | null;
  end_time?: string | null; distance: number; duration?: number | null; pace?: number | null; status?: string | null;
  is_valid: boolean; sport_type?: string | null; semester?: string | null; raw_status?: string | null; synced_at: string;
};
export type OperationLog = {
  id: string; user_id?: string; action_type: string; target_type: string; target_id?: string;
  description: string; old_value?: unknown; new_value?: unknown; created_at: string; profiles?: { display_name?: string; email?: string };
};
export type Backup = { id: string; file_path: string; size_bytes?: number; created_at: string; created_by?: string };
export type BackupSetting = { id: boolean; auto_enabled: boolean; frequency: 'daily' | 'weekly' | 'custom'; next_run_at: string | null; last_run_at: string | null; updated_at: string };
export type DashboardStats = { accounts: number; schools: number; orders: number; totalDistance: number; completedRuns: number; remainingRuns: number };
