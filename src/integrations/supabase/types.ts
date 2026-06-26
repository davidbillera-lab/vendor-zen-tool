export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      correction_injections: {
        Row: {
          correction_id: string | null
          created_at: string
          id: string
          platform: string | null
          re_corrected: boolean
          re_corrected_at: string | null
          re_corrected_field: string | null
          row_id: string | null
          user_id: string
        }
        Insert: {
          correction_id?: string | null
          created_at?: string
          id?: string
          platform?: string | null
          re_corrected?: boolean
          re_corrected_at?: string | null
          re_corrected_field?: string | null
          row_id?: string | null
          user_id: string
        }
        Update: {
          correction_id?: string | null
          created_at?: string
          id?: string
          platform?: string | null
          re_corrected?: boolean
          re_corrected_at?: string | null
          re_corrected_field?: string | null
          row_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_injections_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "listing_corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      crosspost_jobs: {
        Row: {
          batch_id: string | null
          created_at: string
          error_log: string | null
          formatted_data: Json | null
          id: string
          listing_id: string | null
          platform: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          error_log?: string | null
          formatted_data?: Json | null
          id?: string
          listing_id?: string | null
          platform: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          error_log?: string | null
          formatted_data?: Json | null
          id?: string
          listing_id?: string | null
          platform?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crosspost_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "la_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_exports: {
        Row: {
          created_at: string
          csv_data: string | null
          filename: string
          id: string
          platform: string
          row_count: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          csv_data?: string | null
          filename: string
          id?: string
          platform: string
          row_count?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          csv_data?: string | null
          filename?: string
          id?: string
          platform?: string
          row_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      denver_batch_rows: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          doa_auction_url: string | null
          error_log: string | null
          error_message: string | null
          id: string
          image_urls: string[] | null
          lot_number: number
          starting_bid: number | null
          status: string | null
          title: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          doa_auction_url?: string | null
          error_log?: string | null
          error_message?: string | null
          id?: string
          image_urls?: string[] | null
          lot_number: number
          starting_bid?: number | null
          status?: string | null
          title: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          doa_auction_url?: string | null
          error_log?: string | null
          error_message?: string | null
          id?: string
          image_urls?: string[] | null
          lot_number?: number
          starting_bid?: number | null
          status?: string | null
          title?: string
        }
        Relationships: []
      }
      ebay_batch_rows: {
        Row: {
          batch_id: string | null
          best_offer_auto_accept: number | null
          best_offer_enabled: boolean | null
          brand: string | null
          category: string | null
          condition: string | null
          condition_descriptors: Json | null
          created_at: string
          created_by: string | null
          custom_sku: string | null
          description: string | null
          handling_time: number | null
          id: string
          image_urls: string[] | null
          injected_correction_ids: string[] | null
          item_specifics: Json | null
          lot_number: number
          minimum_best_offer: number | null
          mpn: string | null
          package_height: number | null
          package_length: number | null
          package_weight_lbs: number | null
          package_weight_oz: number | null
          package_width: number | null
          price: number | null
          promotion_rate: number | null
          promotion_type: string | null
          return_period: number | null
          return_shipping: string | null
          returns_accepted: boolean | null
          shipping_cost: number | null
          shipping_type: string | null
          status: string | null
          store_category: string | null
          subtitle: string | null
          title: string
          upc: string | null
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          best_offer_auto_accept?: number | null
          best_offer_enabled?: boolean | null
          brand?: string | null
          category?: string | null
          condition?: string | null
          condition_descriptors?: Json | null
          created_at?: string
          created_by?: string | null
          custom_sku?: string | null
          description?: string | null
          handling_time?: number | null
          id?: string
          image_urls?: string[] | null
          injected_correction_ids?: string[] | null
          item_specifics?: Json | null
          lot_number: number
          minimum_best_offer?: number | null
          mpn?: string | null
          package_height?: number | null
          package_length?: number | null
          package_weight_lbs?: number | null
          package_weight_oz?: number | null
          package_width?: number | null
          price?: number | null
          promotion_rate?: number | null
          promotion_type?: string | null
          return_period?: number | null
          return_shipping?: string | null
          returns_accepted?: boolean | null
          shipping_cost?: number | null
          shipping_type?: string | null
          status?: string | null
          store_category?: string | null
          subtitle?: string | null
          title: string
          upc?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          best_offer_auto_accept?: number | null
          best_offer_enabled?: boolean | null
          brand?: string | null
          category?: string | null
          condition?: string | null
          condition_descriptors?: Json | null
          created_at?: string
          created_by?: string | null
          custom_sku?: string | null
          description?: string | null
          handling_time?: number | null
          id?: string
          image_urls?: string[] | null
          injected_correction_ids?: string[] | null
          item_specifics?: Json | null
          lot_number?: number
          minimum_best_offer?: number | null
          mpn?: string | null
          package_height?: number | null
          package_length?: number | null
          package_weight_lbs?: number | null
          package_weight_oz?: number | null
          package_width?: number | null
          price?: number | null
          promotion_rate?: number | null
          promotion_type?: string | null
          return_period?: number | null
          return_shipping?: string | null
          returns_accepted?: boolean | null
          shipping_cost?: number | null
          shipping_type?: string | null
          status?: string | null
          store_category?: string | null
          subtitle?: string | null
          title?: string
          upc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_batch_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "la_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_categories: {
        Row: {
          id: string
          is_leaf: boolean
          level: number | null
          name: string
          parent_id: string | null
          path: string | null
          synced_at: string | null
        }
        Insert: {
          id: string
          is_leaf?: boolean
          level?: number | null
          name: string
          parent_id?: string | null
          path?: string | null
          synced_at?: string | null
        }
        Update: {
          id?: string
          is_leaf?: boolean
          level?: number | null
          name?: string
          parent_id?: string | null
          path?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      ebay_category_aspects_cache: {
        Row: {
          aspects: Json
          category_id: string
          fetched_at: string
          marketplace_id: string
        }
        Insert: {
          aspects?: Json
          category_id: string
          fetched_at?: string
          marketplace_id?: string
        }
        Update: {
          aspects?: Json
          category_id?: string
          fetched_at?: string
          marketplace_id?: string
        }
        Relationships: []
      }
      ebay_category_learnings: {
        Row: {
          category_id: number
          category_name: string
          confidence: number
          created_at: string
          id: string
          item_keywords: string
          last_confirmed: string
        }
        Insert: {
          category_id: number
          category_name: string
          confidence?: number
          created_at?: string
          id?: string
          item_keywords: string
          last_confirmed?: string
        }
        Update: {
          category_id?: number
          category_name?: string
          confidence?: number
          created_at?: string
          id?: string
          item_keywords?: string
          last_confirmed?: string
        }
        Relationships: []
      }
      estatesales_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          doa_url: string
          error_message: string | null
          estatesales_url: string
          id: string
          lots_described: number
          lots_scraped: number
          lots_skipped: number | null
          lots_uploaded: number
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          doa_url: string
          error_message?: string | null
          estatesales_url: string
          id?: string
          lots_described?: number
          lots_scraped?: number
          lots_skipped?: number | null
          lots_uploaded?: number
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          doa_url?: string
          error_message?: string | null
          estatesales_url?: string
          id?: string
          lots_described?: number
          lots_scraped?: number
          lots_skipped?: number | null
          lots_uploaded?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      estatesales_uploaded_lots: {
        Row: {
          created_at: string
          es_url: string
          id: string
          job_id: string | null
          lot_number: string | null
          lot_title: string | null
          lot_url: string
          reserved_at: string
          status: string
          uploaded_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          es_url: string
          id?: string
          job_id?: string | null
          lot_number?: string | null
          lot_title?: string | null
          lot_url: string
          reserved_at?: string
          status?: string
          uploaded_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          es_url?: string
          id?: string
          job_id?: string | null
          lot_number?: string | null
          lot_title?: string | null
          lot_url?: string
          reserved_at?: string
          status?: string
          uploaded_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      la_batch_rows: {
        Row: {
          batch_id: string | null
          category: string | null
          condition: string | null
          consignor: string | null
          created_at: string
          created_by: string | null
          depth: string | null
          description: string | null
          dimension_unit: string | null
          height: string | null
          high_est: number | null
          id: string
          image_urls: string[] | null
          lot_number: number
          low_est: number | null
          start_price: number | null
          title: string
          weight: string | null
          weight_unit: string | null
          width: string | null
        }
        Insert: {
          batch_id?: string | null
          category?: string | null
          condition?: string | null
          consignor?: string | null
          created_at?: string
          created_by?: string | null
          depth?: string | null
          description?: string | null
          dimension_unit?: string | null
          height?: string | null
          high_est?: number | null
          id?: string
          image_urls?: string[] | null
          lot_number: number
          low_est?: number | null
          start_price?: number | null
          title: string
          weight?: string | null
          weight_unit?: string | null
          width?: string | null
        }
        Update: {
          batch_id?: string | null
          category?: string | null
          condition?: string | null
          consignor?: string | null
          created_at?: string
          created_by?: string | null
          depth?: string | null
          description?: string | null
          dimension_unit?: string | null
          height?: string | null
          high_est?: number | null
          id?: string
          image_urls?: string[] | null
          lot_number?: number
          low_est?: number | null
          start_price?: number | null
          title?: string
          weight?: string | null
          weight_unit?: string | null
          width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "la_batch_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "la_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      la_batches: {
        Row: {
          consignor_email: string | null
          consignor_name: string | null
          created_at: string | null
          created_by: string | null
          doa_auction_url: string | null
          doa_completed: number | null
          doa_failed: number | null
          doa_first_lot_url: string | null
          doa_pending: number | null
          id: string
          master_prompt: string | null
          name: string | null
          platforms: string[] | null
          updated_at: string
        }
        Insert: {
          consignor_email?: string | null
          consignor_name?: string | null
          created_at?: string | null
          created_by?: string | null
          doa_auction_url?: string | null
          doa_completed?: number | null
          doa_failed?: number | null
          doa_first_lot_url?: string | null
          doa_pending?: number | null
          id?: string
          master_prompt?: string | null
          name?: string | null
          platforms?: string[] | null
          updated_at?: string
        }
        Update: {
          consignor_email?: string | null
          consignor_name?: string | null
          created_at?: string | null
          created_by?: string | null
          doa_auction_url?: string | null
          doa_completed?: number | null
          doa_failed?: number | null
          doa_first_lot_url?: string | null
          doa_pending?: number | null
          id?: string
          master_prompt?: string | null
          name?: string | null
          platforms?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      listing_correction_lessons: {
        Row: {
          category: string | null
          created_at: string
          id: string
          lesson_text: string
          retired: boolean
          source_correction_ids: string[] | null
          times_injected: number
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          lesson_text: string
          retired?: boolean
          source_correction_ids?: string[] | null
          times_injected?: number
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          lesson_text?: string
          retired?: boolean
          source_correction_ids?: string[] | null
          times_injected?: number
          user_id?: string
        }
        Relationships: []
      }
      listing_corrections: {
        Row: {
          category: string | null
          corrected_specifics: Json | null
          corrected_title: string | null
          correction_note: string | null
          created_at: string
          distilled_at: string | null
          embedding: string | null
          id: string
          image_urls: string[] | null
          platform: string | null
          retired: boolean
          source: string
          times_failed: number
          times_injected: number
          user_id: string
          wrong_specifics: Json | null
          wrong_title: string | null
        }
        Insert: {
          category?: string | null
          corrected_specifics?: Json | null
          corrected_title?: string | null
          correction_note?: string | null
          created_at?: string
          distilled_at?: string | null
          embedding?: string | null
          id?: string
          image_urls?: string[] | null
          platform?: string | null
          retired?: boolean
          source: string
          times_failed?: number
          times_injected?: number
          user_id: string
          wrong_specifics?: Json | null
          wrong_title?: string | null
        }
        Update: {
          category?: string | null
          corrected_specifics?: Json | null
          corrected_title?: string | null
          correction_note?: string | null
          created_at?: string
          distilled_at?: string | null
          embedding?: string | null
          id?: string
          image_urls?: string[] | null
          platform?: string | null
          retired?: boolean
          source?: string
          times_failed?: number
          times_injected?: number
          user_id?: string
          wrong_specifics?: Json | null
          wrong_title?: string | null
        }
        Relationships: []
      }
      listings: {
        Row: {
          category: string | null
          condition: string | null
          created_at: string
          csv_row_data: Json | null
          description: string | null
          facebook_groups: string[] | null
          id: string
          image_urls: string[] | null
          item_specifics: Json | null
          lot_number: number | null
          platform: string
          price: number | null
          project_id: string | null
          promotion_rate: number | null
          promotion_type: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category?: string | null
          condition?: string | null
          created_at?: string
          csv_row_data?: Json | null
          description?: string | null
          facebook_groups?: string[] | null
          id?: string
          image_urls?: string[] | null
          item_specifics?: Json | null
          lot_number?: number | null
          platform: string
          price?: number | null
          project_id?: string | null
          promotion_rate?: number | null
          promotion_type?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string | null
          condition?: string | null
          created_at?: string
          csv_row_data?: Json | null
          description?: string | null
          facebook_groups?: string[] | null
          id?: string
          image_urls?: string[] | null
          item_specifics?: Json | null
          lot_number?: number | null
          platform?: string
          price?: number | null
          project_id?: string | null
          promotion_rate?: number | null
          promotion_type?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "la_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      model_costs: {
        Row: {
          cost_usd: number | null
          created_at: string
          id: string
          input_tokens: number | null
          model: string
          operation: string | null
          output_tokens: number | null
          source: string
          user_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          model: string
          operation?: string | null
          output_tokens?: number | null
          source: string
          user_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string
          operation?: string | null
          output_tokens?: number | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tenant_usage: {
        Row: {
          billing_period: string
          created_at: string
          enhancement_count: number
          id: string
          listing_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_period: string
          created_at?: string
          enhancement_count?: number
          id?: string
          listing_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_period?: string
          created_at?: string
          enhancement_count?: number
          id?: string
          listing_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_doa_credentials: {
        Row: {
          created_at: string
          doa_email: string
          doa_first_lot_url: string | null
          doa_password: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          doa_email: string
          doa_first_lot_url?: string | null
          doa_password: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          doa_email?: string
          doa_first_lot_url?: string | null
          doa_password?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_ebay_credentials: {
        Row: {
          client_id: string | null
          client_secret: string | null
          connected_at: string
          created_at: string
          environment: string
          id: string
          refresh_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          client_secret?: string | null
          connected_at?: string
          created_at?: string
          environment?: string
          id?: string
          refresh_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          client_secret?: string | null
          connected_at?: string
          created_at?: string
          environment?: string
          id?: string
          refresh_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_estatesales_credentials: {
        Row: {
          created_at: string
          estatesales_email: string
          estatesales_password: string
          estatesales_storage_state: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estatesales_email: string
          estatesales_password: string
          estatesales_storage_state?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          estatesales_email?: string
          estatesales_password?: string
          estatesales_storage_state?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_etsy_credentials: {
        Row: {
          created_at: string
          etsy_email: string
          etsy_password: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          etsy_email: string
          etsy_password: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          etsy_email?: string
          etsy_password?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_mercari_credentials: {
        Row: {
          created_at: string
          id: string
          mercari_email: string
          mercari_password: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mercari_email: string
          mercari_password: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mercari_email?: string
          mercari_password?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_platforms: {
        Row: {
          created_at: string
          display_order: number
          enabled: boolean
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      user_poshmark_credentials: {
        Row: {
          created_at: string
          id: string
          poshmark_email: string
          poshmark_password: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          poshmark_email: string
          poshmark_password: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          poshmark_email?: string
          poshmark_password?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          business_name: string | null
          created_at: string
          id: string
          is_admin: boolean
        }
        Insert: {
          business_name?: string | null
          created_at?: string
          id: string
          is_admin?: boolean
        }
        Update: {
          business_name?: string | null
          created_at?: string
          id?: string
          is_admin?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      correction_effectiveness_stats: {
        Args: never
        Returns: {
          rate_last_30d: number
          rate_prior_30d: number
          re_corrected: number
          re_correction_rate: number
          total_injections: number
        }[]
      }
      increment_enhancement_count: {
        Args: { p_billing_period: string; p_user_id: string }
        Returns: number
      }
      mark_corrections_re_corrected: {
        Args: { p_field: string; p_ids: string[]; p_row_id: string }
        Returns: undefined
      }
      match_listing_corrections: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          category: string
          corrected_specifics: Json
          corrected_title: string
          correction_note: string
          id: string
          similarity: number
          source: string
          wrong_specifics: Json
          wrong_title: string
        }[]
      }
      record_category_learning: {
        Args: {
          p_category_id: number
          p_category_name: string
          p_keywords: string
        }
        Returns: undefined
      }
      record_correction_injections: {
        Args: { p_ids: string[]; p_platform: string; p_row_id: string }
        Returns: undefined
      }
      record_lesson_injections: {
        Args: { p_ids: string[] }
        Returns: undefined
      }
      suggest_ebay_category: {
        Args: { query: string; result_limit?: number }
        Returns: {
          id: string
          name: string
          path: string
          rank: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
