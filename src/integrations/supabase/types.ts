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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
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
          id: string
          image_urls: string[] | null
          lot_number: number
          starting_bid: number | null
          status: string
          title: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_urls?: string[] | null
          lot_number: number
          starting_bid?: number | null
          status?: string
          title: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_urls?: string[] | null
          lot_number?: number
          starting_bid?: number | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "denver_batch_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "la_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_batch_rows: {
        Row: {
          batch_id: string | null
          best_offer_auto_accept: number | null
          best_offer_enabled: boolean | null
          brand: string | null
          category: string | null
          condition: string | null
          created_at: string
          created_by: string | null
          description: string | null
          handling_time: number | null
          id: string
          image_urls: string[] | null
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
          created_at?: string
          created_by?: string | null
          description?: string | null
          handling_time?: number | null
          id?: string
          image_urls?: string[] | null
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
          created_at?: string
          created_by?: string | null
          description?: string | null
          handling_time?: number | null
          id?: string
          image_urls?: string[] | null
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
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          lot_count: number
          master_prompt: string | null
          name: string
          platforms: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          lot_count?: number
          master_prompt?: string | null
          name: string
          platforms?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          lot_count?: number
          master_prompt?: string | null
          name?: string
          platforms?: string[] | null
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
