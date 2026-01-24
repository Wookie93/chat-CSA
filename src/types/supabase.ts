export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string;
          openrouter_api_key: string;
          openrouter_model: string;
          system_prompt: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          openrouter_api_key: string;
          openrouter_model: string;
          system_prompt: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          openrouter_api_key?: string;
          openrouter_model?: string;
          system_prompt?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// Inferred types for convenience
export type AppSettingsRow = Database['public']['Tables']['app_settings']['Row'];
export type AppSettingsInsert = Database['public']['Tables']['app_settings']['Insert'];
export type AppSettingsUpdate = Database['public']['Tables']['app_settings']['Update'];