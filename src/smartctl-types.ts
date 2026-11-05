/** Public smartctl JSON fields used by DriveNX.
 * smartctl also emits version- and vendor-specific fields; these remain allowed.
 * Unknown data is validated at the privileged operation boundary, not by this TS type.
 */
export type SmartctlRaw = { value?: number | string; string?: string };
export interface AtaSmartAttribute {
  id: number;
  name: string;
  value?: number;
  worst?: number;
  thresh?: number;
  when_failed?: string;
  raw?: SmartctlRaw;
}
export interface SmartctlSelfTestRow {
  type?: string | { value?: number; string?: string };
  lifetime_hours?: number;
  power_on_hours?: number;
  lba?: number | string | { value?: number };
  status?:
    string | { value?: number; string?: string; passed?: boolean; remaining_percent?: number };
}
export interface SmartErrorRow {
  error_number?: number;
  error_count?: number;
  lifetime_hours?: number;
  error_description?: string;
  completion_registers?: Record<string, unknown>;
  previous_commands?: {
    command_name?: string;
    registers?: Record<string, unknown>;
    powerup_milliseconds?: number;
  }[];
  status_field?: {
    value?: number;
    status_code_type?: number;
    status_code?: number;
    string?: string;
  };
  [key: string]: unknown;
}
export interface AtaErrorEntry extends SmartErrorRow {
  error_number?: number;
  lifetime_hours?: number;
  error_description?: string;
  [key: string]: unknown;
}
export interface NvmeErrorEntry extends SmartErrorRow {
  error_count?: number;
  lba?: { value?: number };
}
export interface NvmeSmartHealth {
  critical_warning?: number;
  temperature?: number;
  available_spare?: number;
  available_spare_threshold?: number;
  percentage_used?: number;
  power_on_hours?: number;
  controller_busy_time?: number;
  media_errors?: number;
  num_err_log_entries?: number;
  temperature_sensors?: number[];
  [key: string]: unknown;
}
export interface SmartctlReport {
  scsi_vendor?: string;
  smart_support?: { available?: boolean; enabled?: boolean };
  ata_version?: { string?: string };
  form_factor?: { name?: string };
  physical_block_size?: number;
  write_cache?: { enabled?: boolean };
  read_lookahead?: { enabled?: boolean };
  ata_apm?: { enabled?: boolean; level?: number };
  ata_aam?: { enabled?: boolean };
  ata_security?: { enabled?: boolean; frozen?: boolean };
  ata_sct_capabilities?: {
    error_recovery_control_supported?: boolean;
    feature_control_supported?: boolean;
    data_table_supported?: boolean;
  };
  ata_sct_status?: {
    temperature?: {
      current?: number;
      power_cycle_min?: number;
      power_cycle_max?: number;
      lifetime_min?: number;
      lifetime_max?: number;
      op_limit_max?: number;
      under_limit_count?: number;
      over_limit_count?: number;
    };
  };
  ata_smart_selective_self_test_log?: {
    table?: { lba_min?: number; lba_max?: number; status?: { string?: string } }[];
    power_up_scan_resume_minutes?: number;
  };
  ata_smart_data?: {
    self_test?: {
      status?: { string?: string; passed?: boolean; remaining_percent?: number };
      polling_minutes?: { short?: number; extended?: number; conveyance?: number };
    };
    capabilities?: {
      self_tests_supported?: boolean;
      exec_offline_immediate_supported?: boolean;
      selective_self_test_supported?: boolean;
      conveyance_self_test_supported?: boolean;
      error_logging_supported?: boolean;
      gp_logging_supported?: boolean;
    };
  };
  nvme_optional_admin_commands?: { self_test?: boolean };
  nvme_version?: { string?: string };
  sata_version?: { string?: string };
  interface_speed?: { current?: { string?: string }; max?: { string?: string } };
  trim?: { supported?: boolean; deterministic?: boolean; zeroed?: boolean };
  logical_block_size?: number;
  nvme_number_of_namespaces?: number;
  nvme_pci_vendor?: { id?: number; subsystem_id?: number };
  power_cycle_count?: number;
  model_name?: string;
  model_family?: string;
  in_smartctl_database?: boolean;
  spare_available?: { current_percent?: number; threshold_percent?: number };
  endurance_used?: { current_percent?: number };
  ata_sct_erc?: {
    read?: { enabled?: boolean; time_limit?: number };
    write?: { enabled?: boolean; time_limit?: number };
  };
  firmware_version?: string;
  serial_number?: string;
  device?: { name?: string; type?: string; protocol?: string };
  smartctl?: {
    exit_status?: number;
    version?: number[];
    argv?: string[];
    drive_database_version?: { string?: string };
    messages?: { severity?: string; string?: string }[];
  };
  user_capacity?: { bytes?: number; blocks?: number };
  rotation_rate?: number;
  temperature?: { current?: number; op_limit_max?: number; critical_limit_max?: number };
  power_on_time?: { hours?: number };
  nvme_composite_temperature_threshold?: { warning?: number; critical?: number };
  nvme_smart_health_information_log?: NvmeSmartHealth;
  nvme_error_information_log?: {
    size?: number;
    read?: number;
    unread?: number;
    table?: NvmeErrorEntry[];
  };
  nvme_self_test_log?: {
    current_self_test_operation?: { value?: number; string?: string };
    table?: SmartctlSelfTestRow[];
  };
  scsi_self_test_log?: { standard?: { table?: SmartctlSelfTestRow[] } };
  ata_smart_attributes?: { table?: AtaSmartAttribute[] };
  ata_smart_error_log?: {
    summary?: { count?: number; logged_count?: number; table?: AtaErrorEntry[] };
    extended?: { count?: number; logged_count?: number; table?: AtaErrorEntry[] };
  };
  ata_smart_self_test_log?: {
    standard?: { table?: SmartctlSelfTestRow[]; count?: number; error_count_total?: number };
    extended?: { table?: SmartctlSelfTestRow[]; count?: number; error_count_total?: number };
  };
  scsi_error_counter_log?: Record<string, { total_uncorrected_errors?: number }>;
  smart_status?: { passed?: boolean };
  /** Extensions from smartctl and vendor-specific JSON fields. */
  [key: string]: unknown;
}
