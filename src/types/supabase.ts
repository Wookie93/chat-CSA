export type Database = {
  public: {
    Tables: {
      reply_template_library: {
        Relationships: [];
        Row: { id: boolean; category: import('@/lib/reply-templates').ReplyTemplateCategory; templates: import('@/lib/reply-templates').ReplyTemplate[]; revision: number };
        Insert: { id?: boolean; category?: import('@/lib/reply-templates').ReplyTemplateCategory; templates: import('@/lib/reply-templates').ReplyTemplate[]; revision?: number };
        Update: { templates?: import('@/lib/reply-templates').ReplyTemplate[]; revision?: number };
      };
      shared_configuration: {
        Relationships: [];
        Row: { revision: number; document: unknown; created_at: string };
        Insert: { revision: number; document: unknown; created_at?: string };
        Update: { document?: unknown };
      };
      app_settings: {
        Relationships: [];
        Row: {
          id: string;
          openrouter_api_key: string;
          openrouter_model: string;
          system_prompt: string;
          calculator_mode: 'llm' | 'jev';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          openrouter_api_key: string;
          openrouter_model: string;
          system_prompt: string;
          calculator_mode?: 'llm' | 'jev';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          openrouter_api_key?: string;
          openrouter_model?: string;
          system_prompt?: string;
          calculator_mode?: 'llm' | 'jev';
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
