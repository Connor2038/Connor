export interface SourceImage {
  id: string;
  url: string;
  localPath: string;
  description: string;
  title?: string;
}
export interface ReferenceImage {
  asset_id: string;
  url: string;
  description: string;
  mime_type: string;
}
export interface Script {
  vocal?:
    | { type: 'speech'; text: string }
    | { type: 'audio'; url?: string; audio?: string; mime_type: 'audio/mpeg' | 'audio/wav' };
  visual?: { prompt: string; duration_ms?: number };
}
export type Step =
  | { id: string; type: 'script'; script: Script }
  | { id: string; type: 'scene'; sourceImageId: string; overlay?: string }
  | {
      id: string;
      type: 'media';
      url: string;
      stage_layer_id?: never;
      advance_on?: 'started' | 'ended';
      lifetime?: 'step' | 'product';
      media?: Record<string, unknown>;
    }
  | { id: string; type: 'media'; stage_layer_id: string; url?: never }
  | { id: string; type: 'session_update'; source_image_id: string }
  | { id: string; type: 'stage_layer_visibility'; stage_layer_id: string; visible: boolean };
export interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  image: string;
  steps: Step[];
  currency?: string;
  original_price?: string;
  badge?: string;
  purchase_url?: string;
  entry_source_image_id?: string;
}
export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  characterName: string;
  model: string;
  voice: {
    tts_provider: string;
    tts_voice_id: string;
    tts_model_id: string;
    speed?: number;
    stability?: number;
  };
  sessionDefaults?: {
    region: string;
    output: { aspect_ratio: string; resolution: string };
    conversation: {
      tools?: {
        type: string;
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      }[];
      response_defaults: { temperature?: number; max_output_tokens: number };
      turn_detection: { type: string; silence_duration_ms: number };
      input_audio_transcription: { enabled: boolean; language: string };
    };
    pipeline_config: {
      tag_audio_enabled: boolean;
      asr_config: Record<string, string | number | boolean>;
    };
  };
  backgroundMusic?: { url: string; volume: number };
  sourceImages: SourceImage[];
  references: ReferenceImage[];
  products: Product[];
  performances: { id: string; title: string; image?: string; script: Script }[];
  opening: { dialogue: string; action: { prompt: string; duration_ms: number } };
  suggestions: string[];
  stage_layout?: {
    version: 1;
    enabled: boolean;
    canvas: { width: number; height: number };
    layers: StageLayer[];
  };
  widget_panel?: { title: string; items: Widget[] };
  product_playlist?: ProductPlaylist;
}
export interface ShoppingData {
  products: Omit<Product, 'steps'>[];
  product_steps: Record<string, Step[]>;
  product_playlist: ProductPlaylist;
  stage_layout: NonNullable<TemplateConfig['stage_layout']>;
  cues?: {
    product_id: string;
    before_step?: string;
    after_step?: string;
    actions: Extract<Step, { type: 'stage_layer_visibility' }>[];
  }[];
}
export interface SessionConnection {
  session_id: string;
  status: string;
  control: { url: string; client_secret: string };
  delivery: {
    media: {
      transport: 'trtc';
      trtc: {
        sdk_app_id: string;
        user_id: string;
        user_sig: string;
        room_id: string;
        publisher_user_id: string;
      };
    };
  };
}
export interface ControlEvent {
  type: string;
  event_id?: string;
  request_event_id?: string;
  response_id?: string;
  item_id?: string;
  call_id?: string;
  arguments?: string;
  output_index?: number;
  content_index?: number;
  delta?: string;
  text?: string;
  transcript?: string;
  status?: string;
  reason?: string;
  response?: { id: string; status: string; status_details?: unknown };
  item?: {
    id?: string;
    type?: string;
    role?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
    content?: { text?: string; transcript?: string }[];
  };
  error?: { event_id?: string; code?: string; message?: string };
}

export interface ProductPlaylist {
  items: { occurrence_id: string; product_id: string }[];
  auto_start: boolean;
  auto_advance?: boolean;
  loop_after_completion: boolean;
  resume_after_interruption: boolean;
  manual_switch_policy?: 'after_current_step' | 'immediate';
}
export interface StageLayer {
  id: string;
  kind:
    | 'avatar'
    | 'image'
    | 'image_carousel'
    | 'video'
    | 'commerce_product'
    | 'product_menu'
    | 'interaction_menu'
    | 'subtitle'
    | 'chat_input';
  name: string;
  frame: { x: number; y: number; w: number; h: number };
  visible: boolean;
  opacity: number;
  rotation: number;
  fit?: 'cover' | 'contain';
  avatar?: {
    matting_enabled: boolean;
    matting_region?: { x: number; y: number; w: number; h: number; feather: number };
  };
  image_carousel?: {
    items: { url: string; display_duration_seconds: number }[];
    transition: 'fade' | 'cut';
  };
  image?: { url: string; playback_mode?: 'persistent' | 'step'; display_duration_seconds?: number };
  video?: {
    url: string;
    poster_url?: string;
    loop: boolean;
    playback_mode: 'persistent' | 'step';
    display_duration_seconds: number;
  };
}
export interface WidgetPresentation {
  title: string;
  image_url: string;
  description: string;
}
export type Widget =
  | {
      kind: 'start_frame';
      presentation: WidgetPresentation;
      action: {
        id: string;
        url: string;
        display_name: string;
        display_image: string;
        description: string;
      };
    }
  | {
      kind: 'commerce_product';
      presentation: WidgetPresentation;
      action: {
        id: string;
        price: string;
        original_price: string;
        currency: string;
        badge: string;
        purchase_url: string;
        entry_source_image_id?: string;
        steps: Step[];
      };
    };
