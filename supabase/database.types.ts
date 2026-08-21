export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.15';
  };
  public: {
    Tables: {
      analytics_events: {
        Row: {
          anonymous_session_id: string | null;
          booking_id: string | null;
          event_name: string;
          id: number;
          marketing_context: Json;
          occurred_at: string;
          page_path: string;
          service_id: string | null;
        };
        Insert: {
          anonymous_session_id?: string | null;
          booking_id?: string | null;
          event_name: string;
          id?: never;
          marketing_context?: Json;
          occurred_at?: string;
          page_path: string;
          service_id?: string | null;
        };
        Update: {
          anonymous_session_id?: string | null;
          booking_id?: string | null;
          event_name?: string;
          id?: never;
          marketing_context?: Json;
          occurred_at?: string;
          page_path?: string;
          service_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'analytics_events_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'analytics_events_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
        ];
      };
      availability_exceptions: {
        Row: {
          created_at: string;
          ends_at: string | null;
          exception_date: string;
          id: string;
          internal_reason: string | null;
          is_available: boolean;
          service_id: string | null;
          starts_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_at?: string | null;
          exception_date: string;
          id?: string;
          internal_reason?: string | null;
          is_available?: boolean;
          service_id?: string | null;
          starts_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_at?: string | null;
          exception_date?: string;
          id?: string;
          internal_reason?: string | null;
          is_available?: boolean;
          service_id?: string | null;
          starts_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'availability_exceptions_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
        ];
      };
      availability_rules: {
        Row: {
          created_at: string;
          ends_at: string;
          id: string;
          is_active: boolean;
          service_id: string;
          slot_duration_minutes: number;
          starts_at: string;
          timezone: string;
          updated_at: string;
          valid_from: string | null;
          valid_until: string | null;
          weekday: number;
        };
        Insert: {
          created_at?: string;
          ends_at: string;
          id?: string;
          is_active?: boolean;
          service_id: string;
          slot_duration_minutes: number;
          starts_at: string;
          timezone?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
          weekday: number;
        };
        Update: {
          created_at?: string;
          ends_at?: string;
          id?: string;
          is_active?: boolean;
          service_id?: string;
          slot_duration_minutes?: number;
          starts_at?: string;
          timezone?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'availability_rules_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_actions: {
        Row: {
          action: string;
          booking_id: string;
          created_at: string;
          id: string;
          note: string | null;
          preferred_date: string | null;
          preferred_time_period: string | null;
        };
        Insert: {
          action: string;
          booking_id: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          preferred_date?: string | null;
          preferred_time_period?: string | null;
        };
        Update: {
          action?: string;
          booking_id?: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          preferred_date?: string | null;
          preferred_time_period?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_actions_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_management_tokens: {
        Row: {
          booking_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          last_used_at: string | null;
          revoked_at: string | null;
          token_hash: string;
        };
        Insert: {
          booking_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_management_tokens_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_slots: {
        Row: {
          config_revision: number | null;
          created_at: string;
          ends_at: string;
          id: string;
          internal_note: string | null;
          materialized_at: string | null;
          origin_kind: string;
          retired_by_materializer_at: string | null;
          service_id: string;
          source_exception_id: string | null;
          source_rule_id: string | null;
          starts_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          config_revision?: number | null;
          created_at?: string;
          ends_at: string;
          id?: string;
          internal_note?: string | null;
          materialized_at?: string | null;
          origin_kind?: string;
          retired_by_materializer_at?: string | null;
          service_id: string;
          source_exception_id?: string | null;
          source_rule_id?: string | null;
          starts_at: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          config_revision?: number | null;
          created_at?: string;
          ends_at?: string;
          id?: string;
          internal_note?: string | null;
          materialized_at?: string | null;
          origin_kind?: string;
          retired_by_materializer_at?: string | null;
          service_id?: string;
          source_exception_id?: string | null;
          source_rule_id?: string | null;
          starts_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_slots_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_status_history: {
        Row: {
          actor_type: string;
          booking_id: string;
          created_at: string;
          id: number;
          new_status: string;
          old_status: string | null;
          reason: string | null;
        };
        Insert: {
          actor_type: string;
          booking_id: string;
          created_at?: string;
          id?: never;
          new_status: string;
          old_status?: string | null;
          reason?: string | null;
        };
        Update: {
          actor_type?: string;
          booking_id?: string;
          created_at?: string;
          id?: never;
          new_status?: string;
          old_status?: string | null;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_status_history_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
        ];
      };
      bookings: {
        Row: {
          cancelled_at: string | null;
          completed_at: string | null;
          confirmation_mode: string;
          created_at: string;
          customer_id: string;
          id: string;
          idempotency_key: string;
          marketing_context: Json;
          notes: string | null;
          patient_status: string;
          preferred_date: string | null;
          preferred_time_period: string | null;
          reference: string;
          request_fingerprint: string;
          service_id: string;
          slot_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          cancelled_at?: string | null;
          completed_at?: string | null;
          confirmation_mode: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          idempotency_key: string;
          marketing_context?: Json;
          notes?: string | null;
          patient_status: string;
          preferred_date?: string | null;
          preferred_time_period?: string | null;
          reference: string;
          request_fingerprint: string;
          service_id: string;
          slot_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          completed_at?: string | null;
          confirmation_mode?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          idempotency_key?: string;
          marketing_context?: Json;
          notes?: string | null;
          patient_status?: string;
          preferred_date?: string | null;
          preferred_time_period?: string | null;
          reference?: string;
          request_fingerprint?: string;
          service_id?: string;
          slot_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_slot_id_fkey';
            columns: ['slot_id'];
            isOneToOne: false;
            referencedRelation: 'booking_slots';
            referencedColumns: ['id'];
          },
        ];
      };
      consent_records: {
        Row: {
          consent_type: string;
          entity_id: string;
          entity_type: string;
          granted: boolean;
          id: number;
          ip_hash: string | null;
          policy_version: string;
          recorded_at: string;
          source: string;
        };
        Insert: {
          consent_type: string;
          entity_id: string;
          entity_type: string;
          granted: boolean;
          id?: never;
          ip_hash?: string | null;
          policy_version: string;
          recorded_at?: string;
          source?: string;
        };
        Update: {
          consent_type?: string;
          entity_id?: string;
          entity_type?: string;
          granted?: boolean;
          id?: never;
          ip_hash?: string | null;
          policy_version?: string;
          recorded_at?: string;
          source?: string;
        };
        Relationships: [];
      };
      contact_enquiries: {
        Row: {
          created_at: string;
          email: string;
          enquiry_type: string;
          id: string;
          idempotency_key: string;
          marketing_context: Json;
          message: string;
          name: string;
          phone_e164: string | null;
          reference: string;
          request_fingerprint: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          enquiry_type: string;
          id?: string;
          idempotency_key: string;
          marketing_context?: Json;
          message: string;
          name: string;
          phone_e164?: string | null;
          reference: string;
          request_fingerprint: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          enquiry_type?: string;
          id?: string;
          idempotency_key?: string;
          marketing_context?: Json;
          message?: string;
          name?: string;
          phone_e164?: string | null;
          reference?: string;
          request_fingerprint?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          email: string;
          first_name: string;
          id: string;
          mobile_e164: string;
          surname: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          email: string;
          first_name: string;
          id?: string;
          mobile_e164: string;
          surname: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          first_name?: string;
          id?: string;
          mobile_e164?: string;
          surname?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      employer_leads: {
        Row: {
          company_name: string;
          contact_name: string;
          created_at: string;
          delivery_mode: string | null;
          employee_count_range: string;
          id: string;
          idempotency_key: string;
          location: string | null;
          marketing_context: Json;
          notes: string | null;
          phone_e164: string;
          preferred_timeframe: string | null;
          reference: string;
          request_fingerprint: string;
          services_required: string[];
          status: string;
          updated_at: string;
          work_email: string;
        };
        Insert: {
          company_name: string;
          contact_name: string;
          created_at?: string;
          delivery_mode?: string | null;
          employee_count_range: string;
          id?: string;
          idempotency_key: string;
          location?: string | null;
          marketing_context?: Json;
          notes?: string | null;
          phone_e164: string;
          preferred_timeframe?: string | null;
          reference: string;
          request_fingerprint: string;
          services_required: string[];
          status?: string;
          updated_at?: string;
          work_email: string;
        };
        Update: {
          company_name?: string;
          contact_name?: string;
          created_at?: string;
          delivery_mode?: string | null;
          employee_count_range?: string;
          id?: string;
          idempotency_key?: string;
          location?: string | null;
          marketing_context?: Json;
          notes?: string | null;
          phone_e164?: string;
          preferred_timeframe?: string | null;
          reference?: string;
          request_fingerprint?: string;
          services_required?: string[];
          status?: string;
          updated_at?: string;
          work_email?: string;
        };
        Relationships: [];
      };
      launch_dependencies: {
        Row: {
          blocks_launch: boolean;
          category: string;
          created_at: string;
          dependency_key: string;
          detail: string;
          evidence_url: string | null;
          id: string;
          owner: string;
          resolved_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          blocks_launch?: boolean;
          category: string;
          created_at?: string;
          dependency_key: string;
          detail: string;
          evidence_url?: string | null;
          id?: string;
          owner?: string;
          resolved_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          blocks_launch?: boolean;
          category?: string;
          created_at?: string;
          dependency_key?: string;
          detail?: string;
          evidence_url?: string | null;
          id?: string;
          owner?: string;
          resolved_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notification_attempts: {
        Row: {
          attempt_count: number;
          channel: string;
          created_at: string;
          dead_at: string | null;
          deduplication_key: string;
          entity_id: string;
          entity_type: string;
          id: string;
          last_attempt_at: string | null;
          last_error_code: string | null;
          last_error_message: string | null;
          last_http_status: number | null;
          lock_expires_at: string | null;
          locked_at: string | null;
          locked_by: string | null;
          next_attempt_at: string;
          notification_kind: string;
          provider: string | null;
          provider_message_id: string | null;
          recipient: string;
          sent_at: string | null;
          status: string;
          transition_sequence: number | null;
          transition_snapshot: Json | null;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          channel?: string;
          created_at?: string;
          dead_at?: string | null;
          deduplication_key?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          last_attempt_at?: string | null;
          last_error_code?: string | null;
          last_error_message?: string | null;
          last_http_status?: number | null;
          lock_expires_at?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          next_attempt_at?: string;
          notification_kind: string;
          provider?: string | null;
          provider_message_id?: string | null;
          recipient: string;
          sent_at?: string | null;
          status?: string;
          transition_sequence?: number | null;
          transition_snapshot?: Json | null;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          channel?: string;
          created_at?: string;
          dead_at?: string | null;
          deduplication_key?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_error_code?: string | null;
          last_error_message?: string | null;
          last_http_status?: number | null;
          lock_expires_at?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          next_attempt_at?: string;
          notification_kind?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          recipient?: string;
          sent_at?: string | null;
          status?: string;
          transition_sequence?: number | null;
          transition_snapshot?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      operational_audit_log: {
        Row: {
          action: string;
          actor_identifier: string;
          after_state: Json;
          before_state: Json;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: number;
          reason: string | null;
        };
        Insert: {
          action: string;
          actor_identifier: string;
          after_state?: Json;
          before_state?: Json;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: never;
          reason?: string | null;
        };
        Update: {
          action?: string;
          actor_identifier?: string;
          after_state?: Json;
          before_state?: Json;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: never;
          reason?: string | null;
        };
        Relationships: [];
      };
      practice_settings: {
        Row: {
          address_line: string;
          country_code: string;
          created_at: string;
          data_retention_policy: string | null;
          descriptor: string;
          id: string;
          locality: string;
          maps_url: string;
          opening_hours: Json;
          phone_display: string | null;
          phone_e164: string | null;
          practice_name: string;
          privacy_notice_version: string;
          public_email: string;
          region: string;
          timezone: string;
          updated_at: string;
          whatsapp_e164: string | null;
        };
        Insert: {
          address_line: string;
          country_code?: string;
          created_at?: string;
          data_retention_policy?: string | null;
          descriptor: string;
          id?: string;
          locality: string;
          maps_url: string;
          opening_hours?: Json;
          phone_display?: string | null;
          phone_e164?: string | null;
          practice_name: string;
          privacy_notice_version?: string;
          public_email: string;
          region: string;
          timezone?: string;
          updated_at?: string;
          whatsapp_e164?: string | null;
        };
        Update: {
          address_line?: string;
          country_code?: string;
          created_at?: string;
          data_retention_policy?: string | null;
          descriptor?: string;
          id?: string;
          locality?: string;
          maps_url?: string;
          opening_hours?: Json;
          phone_display?: string | null;
          phone_e164?: string | null;
          practice_name?: string;
          privacy_notice_version?: string;
          public_email?: string;
          region?: string;
          timezone?: string;
          updated_at?: string;
          whatsapp_e164?: string | null;
        };
        Relationships: [];
      };
      service_categories: {
        Row: {
          audience: string;
          created_at: string;
          display_order: number;
          id: string;
          is_published: boolean;
          name: string;
          primary_cta: string;
          slug: string;
          summary: string;
          updated_at: string;
        };
        Insert: {
          audience: string;
          created_at?: string;
          display_order?: number;
          id?: string;
          is_published?: boolean;
          name: string;
          primary_cta: string;
          slug: string;
          summary: string;
          updated_at?: string;
        };
        Update: {
          audience?: string;
          created_at?: string;
          display_order?: number;
          id?: string;
          is_published?: boolean;
          name?: string;
          primary_cta?: string;
          slug?: string;
          summary?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      services: {
        Row: {
          appointment_duration_minutes: number | null;
          appointment_requirement: string | null;
          audience: string;
          booking_mode: string;
          cash_price_cents: number | null;
          cash_price_max_cents: number | null;
          category_id: string;
          confirmation_mode: string;
          created_at: string;
          currency: string;
          display_order: number;
          expected_duration: string | null;
          id: string;
          is_published: boolean;
          medical_aid_status: string | null;
          name: string;
          preparation_instructions: string | null;
          price_note: string | null;
          price_type: string;
          referral_requirement: string | null;
          results_process: string | null;
          short_description: string;
          slug: string;
          source_url: string | null;
          updated_at: string;
          verification_status: string;
          what_to_bring: string | null;
        };
        Insert: {
          appointment_duration_minutes?: number | null;
          appointment_requirement?: string | null;
          audience: string;
          booking_mode: string;
          cash_price_cents?: number | null;
          cash_price_max_cents?: number | null;
          category_id: string;
          confirmation_mode?: string;
          created_at?: string;
          currency?: string;
          display_order?: number;
          expected_duration?: string | null;
          id?: string;
          is_published?: boolean;
          medical_aid_status?: string | null;
          name: string;
          preparation_instructions?: string | null;
          price_note?: string | null;
          price_type?: string;
          referral_requirement?: string | null;
          results_process?: string | null;
          short_description: string;
          slug: string;
          source_url?: string | null;
          updated_at?: string;
          verification_status?: string;
          what_to_bring?: string | null;
        };
        Update: {
          appointment_duration_minutes?: number | null;
          appointment_requirement?: string | null;
          audience?: string;
          booking_mode?: string;
          cash_price_cents?: number | null;
          cash_price_max_cents?: number | null;
          category_id?: string;
          confirmation_mode?: string;
          created_at?: string;
          currency?: string;
          display_order?: number;
          expected_duration?: string | null;
          id?: string;
          is_published?: boolean;
          medical_aid_status?: string | null;
          name?: string;
          preparation_instructions?: string | null;
          price_note?: string | null;
          price_type?: string;
          referral_requirement?: string | null;
          results_process?: string | null;
          short_description?: string;
          slug?: string;
          source_url?: string | null;
          updated_at?: string;
          verification_status?: string;
          what_to_bring?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'services_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'service_categories';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      check_rate_limit: {
        Args: {
          p_endpoint: string;
          p_key_hash: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          retry_after_seconds: number;
        }[];
      };
      claim_notification_batch: {
        Args: { p_limit?: number; p_worker_id: string };
        Returns: {
          attempt_count: number;
          attempt_id: string;
          entity_id: string;
          entity_type: string;
          notification_kind: string;
          payload: Json;
          recipient: string;
        }[];
      };
      complete_notification_attempt: {
        Args: {
          p_attempt_id: string;
          p_provider: string;
          p_provider_message_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      create_booking: { Args: { p_payload: Json }; Returns: Json };
      create_contact_enquiry: { Args: { p_payload: Json }; Returns: Json };
      create_employer_lead: { Args: { p_payload: Json }; Returns: Json };
      fail_notification_attempt: {
        Args: {
          p_attempt_id: string;
          p_error_code: string;
          p_error_message: string;
          p_http_status?: number;
          p_provider?: string;
          p_retryable: boolean;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      list_available_slots: {
        Args: { p_from: string; p_service_id: string; p_until: string };
        Returns: {
          ends_at: string;
          service_id: string;
          slot_id: string;
          starts_at: string;
        }[];
      };
      manage_booking: { Args: { p_payload: Json }; Returns: Json };
      record_analytics_event: { Args: { p_payload: Json }; Returns: undefined };
      staff_close_booking: {
        Args: {
          p_actor_identifier: string;
          p_booking_id: string;
          p_new_status: string;
          p_reason: string;
        };
        Returns: Json;
      };
      staff_confirm_booking: {
        Args: {
          p_actor_identifier: string;
          p_booking_id: string;
          p_reason?: string;
          p_slot_id: string;
        };
        Returns: Json;
      };
      staff_requeue_notification: {
        Args: {
          p_actor_identifier: string;
          p_attempt_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      staff_update_contact_enquiry_status: {
        Args: {
          p_actor_identifier: string;
          p_enquiry_id: string;
          p_new_status: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      staff_update_employer_lead_status: {
        Args: {
          p_actor_identifier: string;
          p_lead_id: string;
          p_new_status: string;
          p_reason?: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views']
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views']
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema['Tables']
    & DefaultSchema['Views']
  ) ? (
      & DefaultSchema['Tables']
      & DefaultSchema['Views']
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
