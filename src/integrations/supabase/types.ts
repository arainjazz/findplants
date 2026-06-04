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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      blog_posts: {
        Row: {
          author_id: string
          author_name: string | null
          content_html: string
          cover_url: string | null
          created_at: string
          id: string
          published: boolean
          published_at: string | null
          slug: string
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          author_name?: string | null
          content_html?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          published?: boolean
          published_at?: string | null
          slug: string
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          author_name?: string | null
          content_html?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          published?: boolean
          published_at?: string | null
          slug?: string
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_entries: {
        Row: {
          added_by: string
          added_by_name: string | null
          catalog_id: string
          chinese_name: string | null
          created_at: string
          id: string
          scientific_name: string
        }
        Insert: {
          added_by: string
          added_by_name?: string | null
          catalog_id: string
          chinese_name?: string | null
          created_at?: string
          id?: string
          scientific_name: string
        }
        Update: {
          added_by?: string
          added_by_name?: string | null
          catalog_id?: string
          chinese_name?: string | null
          created_at?: string
          id?: string
          scientific_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_entries_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "regional_catalogs"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_suggestions: {
        Row: {
          catalog_id: string
          created_at: string
          id: string
          proposed_name: string | null
          reason: string | null
          source_book_pages: string | null
          source_book_title: string | null
          source_type: string | null
          source_url: string | null
          status: string
          suggested_by: string
          suggested_by_name: string | null
          suggestion_type: string
          target_entry_id: string | null
          target_name: string
        }
        Insert: {
          catalog_id: string
          created_at?: string
          id?: string
          proposed_name?: string | null
          reason?: string | null
          source_book_pages?: string | null
          source_book_title?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string
          suggested_by: string
          suggested_by_name?: string | null
          suggestion_type: string
          target_entry_id?: string | null
          target_name: string
        }
        Update: {
          catalog_id?: string
          created_at?: string
          id?: string
          proposed_name?: string | null
          reason?: string | null
          source_book_pages?: string | null
          source_book_title?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string
          suggested_by?: string
          suggested_by_name?: string | null
          suggestion_type?: string
          target_entry_id?: string | null
          target_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_suggestions_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "regional_catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_suggestions_target_entry_id_fkey"
            columns: ["target_entry_id"]
            isOneToOne: false
            referencedRelation: "catalog_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      editor_applications: {
        Row: {
          bio: string
          created_at: string
          email: string
          id: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["editor_application_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          bio: string
          created_at?: string
          email: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["editor_application_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string
          created_at?: string
          email?: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["editor_application_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plant_comments: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          created_at: string
          id: string
          plant_id: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          plant_id: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          plant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_comments_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_drafts: {
        Row: {
          ai_model: string | null
          ai_payload: Json | null
          capture_lat: number | null
          capture_lng: number | null
          capture_place: string | null
          common_name_en: string | null
          created_at: string
          created_by: string | null
          creator_label: string
          family: string | null
          genus: string | null
          html_content: string
          id: string
          iucn_status: string | null
          photo_url: string
          published_plant_id: string | null
          scientific_name: string | null
          status: string
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          ai_model?: string | null
          ai_payload?: Json | null
          capture_lat?: number | null
          capture_lng?: number | null
          capture_place?: string | null
          common_name_en?: string | null
          created_at?: string
          created_by?: string | null
          creator_label?: string
          family?: string | null
          genus?: string | null
          html_content: string
          id?: string
          iucn_status?: string | null
          photo_url: string
          published_plant_id?: string | null
          scientific_name?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          ai_model?: string | null
          ai_payload?: Json | null
          capture_lat?: number | null
          capture_lng?: number | null
          capture_place?: string | null
          common_name_en?: string | null
          created_at?: string
          created_by?: string | null
          creator_label?: string
          family?: string | null
          genus?: string | null
          html_content?: string
          id?: string
          iucn_status?: string | null
          photo_url?: string
          published_plant_id?: string | null
          scientific_name?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_drafts_published_plant_id_fkey"
            columns: ["published_plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_edits: {
        Row: {
          after_html: string | null
          before_html: string | null
          block_path: string | null
          catalog_id: string | null
          created_at: string
          editor_id: string
          editor_name: string | null
          entry_ids: string[] | null
          id: string
          kind: string
          marker_n: number
          plant_id: string | null
          reverted: boolean
          reverted_at: string | null
          reverted_by: string | null
          source: string | null
          summary: string | null
        }
        Insert: {
          after_html?: string | null
          before_html?: string | null
          block_path?: string | null
          catalog_id?: string | null
          created_at?: string
          editor_id: string
          editor_name?: string | null
          entry_ids?: string[] | null
          id?: string
          kind: string
          marker_n?: number
          plant_id?: string | null
          reverted?: boolean
          reverted_at?: string | null
          reverted_by?: string | null
          source?: string | null
          summary?: string | null
        }
        Update: {
          after_html?: string | null
          before_html?: string | null
          block_path?: string | null
          catalog_id?: string | null
          created_at?: string
          editor_id?: string
          editor_name?: string | null
          entry_ids?: string[] | null
          id?: string
          kind?: string
          marker_n?: number
          plant_id?: string | null
          reverted?: boolean
          reverted_at?: string | null
          reverted_by?: string | null
          source?: string | null
          summary?: string | null
        }
        Relationships: []
      }
      plant_tags: {
        Row: {
          added_by: string
          created_at: string
          plant_id: string
          tag_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          plant_id: string
          tag_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          plant_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_tags_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plant_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      plants: {
        Row: {
          author_id: string
          co_author_ids: string[]
          co_author_names: string[]
          comments_count: number
          common_name_en: string | null
          content_type: Database["public"]["Enums"]["plant_content_type"]
          cover_url: string | null
          created_at: string
          family: string | null
          genus: string | null
          habitat: string | null
          html_url: string | null
          id: string
          is_featured: boolean
          iucn_status: string | null
          parent_id: string | null
          rich_content: string | null
          scientific_name: string | null
          slug: string
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          co_author_ids?: string[]
          co_author_names?: string[]
          comments_count?: number
          common_name_en?: string | null
          content_type?: Database["public"]["Enums"]["plant_content_type"]
          cover_url?: string | null
          created_at?: string
          family?: string | null
          genus?: string | null
          habitat?: string | null
          html_url?: string | null
          id?: string
          is_featured?: boolean
          iucn_status?: string | null
          parent_id?: string | null
          rich_content?: string | null
          scientific_name?: string | null
          slug: string
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          co_author_ids?: string[]
          co_author_names?: string[]
          comments_count?: number
          common_name_en?: string | null
          content_type?: Database["public"]["Enums"]["plant_content_type"]
          cover_url?: string | null
          created_at?: string
          family?: string | null
          genus?: string | null
          habitat?: string | null
          html_url?: string | null
          id?: string
          is_featured?: boolean
          iucn_status?: string | null
          parent_id?: string | null
          rich_content?: string | null
          scientific_name?: string | null
          slug?: string
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plants_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      regional_catalogs: {
        Row: {
          city: string | null
          contributor_name: string
          county: string | null
          created_at: string
          created_by: string
          id: string
          province: string
          source: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          contributor_name: string
          county?: string | null
          created_at?: string
          created_by: string
          id?: string
          province: string
          source: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          contributor_name?: string
          county?: string | null
          created_at?: string
          created_by?: string
          id?: string
          province?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          created_by: string
          created_by_name: string | null
          description: string | null
          expected_count: number | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          created_by_name?: string | null
          description?: string | null
          expected_count?: number | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          created_by_name?: string | null
          description?: string | null
          expected_count?: number | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved_editor: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "editor"
      editor_application_status: "pending" | "approved" | "rejected"
      plant_content_type: "rich" | "html"
      plant_edit_kind: "text" | "image" | "revert"
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
    Enums: {
      app_role: ["admin", "moderator", "user", "editor"],
      editor_application_status: ["pending", "approved", "rejected"],
      plant_content_type: ["rich", "html"],
      plant_edit_kind: ["text", "image", "revert"],
    },
  },
} as const
