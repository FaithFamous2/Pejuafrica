const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export type ApiError = {
  detail?: string | { msg: string }[];
};

async function request<T>(
  path: string,
  options: RequestInit = {},
  tenantId?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (tenantId) {
    headers.set("X-Tenant-Id", tenantId);
  }

  // Prefer same-origin proxy (rewrites to FastAPI) so httpOnly cookies stay reliable.
  const base = API_URL || "";
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as ApiError;
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d) => d.msg).join(", ");
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    business_name: string;
    industry?: string;
  }) =>
    request<{
      user: { id: string; email: string; full_name: string };
      tenant: { id: string; name: string; slug: string };
      message: string;
      dev_email_verification_token?: string;
    }>("/api/v1/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string; tenant_id?: string }) =>
    request<{
      user: { id: string; email: string; full_name: string; is_platform_admin: boolean };
      tenant: { id: string; name: string; slug: string } | null;
      role: string | null;
    }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),

  logout: () => request<{ message: string }>("/api/v1/auth/logout", { method: "POST" }),

  forgotPassword: (email: string) =>
    request<{ message: string; dev_reset_code?: string }>("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (body: { email: string; code: string; new_password: string }) =>
    request<{ message: string }>("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  changePassword: (body: { current_password: string; new_password: string }) =>
    request<{ message: string }>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verifyEmail: (token: string) =>
    request<{ message: string }>("/api/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  me: (tenantId?: string | null) =>
    request<{
      user: {
        id: string;
        email: string;
        full_name: string;
        is_email_verified: boolean;
        is_platform_admin: boolean;
      };
      memberships: {
        tenant: { id: string; name: string; slug: string; status: string };
        role: string;
        is_default: boolean;
      }[];
      active_tenant: { id: string; name: string; slug: string } | null;
      active_role: string | null;
    }>("/api/v1/auth/me", {}, tenantId),
  activity: (tenantId: string) =>
    request<
      { id: string; event_type: string; title: string; metadata: object; created_at: string }[]
    >("/api/v1/activity", {}, tenantId),
  getBusinessProfile: (tenantId: string) =>
    request<{
      id: string;
      tenant_id: string;
      business_name: string;
      industry: string | null;
      brand_voice: string | null;
      target_audience: string | null;
      competitors: string[] | null;
      socials: Record<string, string> | null;
      goals: string | null;
      logo_url: string | null;
      onboarding_completed: boolean;
      memory_initialized: boolean;
    }>("/api/v1/business-profile", {}, tenantId),
  upsertBusinessProfile: (
    tenantId: string,
    body: {
      business_name: string;
      industry?: string | null;
      brand_voice?: string | null;
      target_audience?: string | null;
      competitors?: string[] | null;
      socials?: Record<string, string> | null;
      goals?: string | null;
      logo_url?: string | null;
      initialize_memory?: boolean;
    },
  ) =>
    request<{
      id: string;
      onboarding_completed: boolean;
      memory_initialized: boolean;
      business_name: string;
      logo_url?: string | null;
      industry?: string | null;
      brand_voice?: string | null;
      target_audience?: string | null;
      competitors?: string[] | null;
      socials?: Record<string, string> | null;
      goals?: string | null;
    }>("/api/v1/business-profile", { method: "PUT", body: JSON.stringify(body) }, tenantId),

  assistOnboardingStep: (
    tenantId: string,
    body: {
      step: "basics" | "voice" | "audience" | "presence" | "init";
      business_name?: string;
      industry?: string;
      brand_voice?: string;
      target_audience?: string;
      competitors?: string;
      socials?: string;
      goals?: string;
    },
  ) =>
    request<{
      step: string;
      suggestions: Record<string, string>;
      helper_text: string;
      source: string;
    }>("/api/v1/business-profile/assist-step", { method: "POST", body: JSON.stringify(body) }, tenantId),

  uploadBusinessLogo: async (tenantId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/business-profile/logo", {
      method: "POST",
      credentials: "include",
      headers: { "X-Tenant-Id": tenantId },
      body: form,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as ApiError;
        if (typeof data.detail === "string") detail = data.detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return (await res.json()) as {
      id: string;
      business_name: string;
      logo_url: string | null;
      industry: string | null;
      brand_voice: string | null;
      target_audience: string | null;
      competitors: string[] | null;
      socials: Record<string, string> | null;
      goals: string | null;
      onboarding_completed: boolean;
      memory_initialized: boolean;
    };
  },
  adminStats: () =>
    request<{
      tenants: number;
      users: number;
      campaigns: number;
      content_posts: number;
      active_subscriptions: number;
      trial_tenants: number;
      total_tokens: number;
    }>("/api/v1/admin/stats"),
  adminTenants: () =>
    request<
      {
        id: string;
        name: string;
        slug: string;
        status: string;
        industry: string | null;
        trial_ends_at?: string | null;
        created_at: string;
      }[]
    >("/api/v1/admin/tenants"),

  adminUsage: () =>
    request<{ tenant_id: string; tenant_name: string; events: number; total_tokens: number }[]>(
      "/api/v1/admin/usage",
    ),

  adminImpersonate: (tenantId: string) =>
    request<{
      message: string;
      tenant_id: string;
      as_user: { id: string; email: string; full_name: string };
    }>(`/api/v1/admin/tenants/${tenantId}/impersonate`, { method: "POST" }),

  adminListPrompts: () =>
    request<
      {
        id: string;
        key: string;
        name: string;
        description: string | null;
        body: string;
        version: number;
        is_active: boolean;
      }[]
    >("/api/v1/admin/prompts"),

  adminUpsertPrompt: (body: {
    key: string;
    name: string;
    description?: string;
    body: string;
    is_active?: boolean;
  }) =>
    request<{ id: string; key: string; name: string; version: number }>(
      "/api/v1/admin/prompts",
      { method: "POST", body: JSON.stringify(body) },
    ),

  adminLlmCatalog: () =>
    request<{ kind: string; label: string; default_model: string; default_base_url: string }[]>(
      "/api/v1/admin/llm/catalog",
    ),

  adminListLlmProviders: () =>
    request<
      {
        id: string;
        kind: string;
        name: string;
        model: string;
        base_url: string | null;
        api_key_masked: string;
        is_active: boolean;
        priority: number;
        last_ok_at: string | null;
        last_error: string | null;
      }[]
    >("/api/v1/admin/llm/providers"),

  adminCreateLlmProvider: (body: {
    kind: string;
    name: string;
    model?: string;
    base_url?: string;
    api_key: string;
    is_active?: boolean;
    priority?: number;
  }) =>
    request<{ id: string; name: string; kind: string }>(
      "/api/v1/admin/llm/providers",
      { method: "POST", body: JSON.stringify(body) },
    ),

  adminUpdateLlmProvider: (
    id: string,
    body: Partial<{
      name: string;
      model: string;
      base_url: string;
      api_key: string;
      is_active: boolean;
      priority: number;
    }>,
  ) =>
    request<{ id: string; is_active: boolean }>(
      `/api/v1/admin/llm/providers/${id}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  adminDeleteLlmProvider: (id: string) =>
    request<void>(`/api/v1/admin/llm/providers/${id}`, { method: "DELETE" }),

  adminTestLlmProvider: (id: string) =>
    request<{ ok: boolean; provider: string; model: string }>(
      `/api/v1/admin/llm/providers/${id}/test`,
      { method: "POST" },
    ),

  adminImageGenCatalog: () =>
    request<
      {
        kind: string;
        label: string;
        needs_account_id: boolean;
        models: { id: string; label: string; hint: string }[];
      }[]
    >("/api/v1/admin/image-gen/catalog"),

  adminListImageProviders: () =>
    request<
      {
        id: string;
        kind: string;
        name: string;
        model: string;
        account_id: string | null;
        api_key_masked: string;
        is_active: boolean;
        priority: number;
        last_ok_at: string | null;
        last_error: string | null;
      }[]
    >("/api/v1/admin/image-gen/providers"),

  adminCreateImageProvider: (body: {
    kind: string;
    name: string;
    model?: string;
    account_id?: string;
    api_key: string;
    is_active?: boolean;
    priority?: number;
  }) =>
    request<{ id: string; name: string; kind: string }>(
      "/api/v1/admin/image-gen/providers",
      { method: "POST", body: JSON.stringify(body) },
    ),

  adminUpdateImageProvider: (
    id: string,
    body: Partial<{
      name: string;
      model: string;
      account_id: string;
      api_key: string;
      is_active: boolean;
      priority: number;
    }>,
  ) =>
    request<{ id: string; is_active: boolean }>(
      `/api/v1/admin/image-gen/providers/${id}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  adminDeleteImageProvider: (id: string) =>
    request<void>(`/api/v1/admin/image-gen/providers/${id}`, { method: "DELETE" }),

  adminTestImageProvider: (id: string) =>
    request<{ ok: boolean; provider: string; model: string; bytes: number; mime: string }>(
      `/api/v1/admin/image-gen/providers/${id}/test`,
      { method: "POST" },
    ),

  adminGenerations: () =>
    request<
      {
        campaign_id: string;
        title: string;
        tenant_id: string;
        tenant_name: string;
        generation_provider: string | null;
        generation_model: string | null;
        created_at: string;
      }[]
    >("/api/v1/admin/llm/generations"),

  adminUsageByProvider: () =>
    request<{ provider: string; model: string; events: number; total_tokens: number }[]>(
      "/api/v1/admin/llm/usage-by-provider",
    ),

  exportCampaignMarkdown: async (tenantId: string, campaignId: string) => {
    const res = await fetch(`/api/v1/marketing/campaigns/${campaignId}/export?format=markdown`, {
      credentials: "include",
      headers: { "X-Tenant-Id": tenantId },
    });
    if (!res.ok) throw new Error("Export failed");
    return res.text();
  },

  marketingOverview: (tenantId: string) =>
    request<{
      campaigns: number;
      draft_posts: number;
      approved_posts: number;
      published_posts: number;
      latest_campaign: Campaign | null;
      upcoming_posts: ContentPost[];
      approval_queue: ContentPost[];
    }>("/api/v1/marketing/overview", {}, tenantId),

  listCampaigns: (tenantId: string) =>
    request<Campaign[]>("/api/v1/marketing/campaigns", {}, tenantId),

  getCampaign: (tenantId: string, campaignId: string) =>
    request<Campaign>(`/api/v1/marketing/campaigns/${campaignId}`, {}, tenantId),

  generateCampaign: (
    tenantId: string,
    body?: {
      month?: number;
      year?: number;
      brief?: GenerationBrief;
    },
  ) =>
    request<Campaign>(
      "/api/v1/marketing/campaigns/generate",
      { method: "POST", body: JSON.stringify(body || {}) },
      tenantId,
    ),

  listPosts: (tenantId: string, status?: string) =>
    request<ContentPost[]>(
      `/api/v1/marketing/posts${status ? `?status=${status}` : ""}`,
      {},
      tenantId,
    ),

  updatePostStatus: (tenantId: string, postId: string, status: string) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
      tenantId,
    ),

  updatePost: (
    tenantId: string,
    postId: string,
    body: {
      status?: string;
      caption?: string;
      hashtags?: string[];
      cta?: string | null;
      theme?: string;
      graphic_prompt?: string | null;
      platform?: string;
    },
  ) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}`,
      { method: "PATCH", body: JSON.stringify(body) },
      tenantId,
    ),

  regeneratePostStream: async (
    tenantId: string,
    postId: string,
    brief: GenerationBrief | undefined,
    handlers: {
      onStatus?: (message: string) => void;
      onCaption?: (text: string) => void;
      onCta?: (text: string) => void;
      onHashtags?: (tags: string[]) => void;
      onDone?: (post: ContentPost) => void;
      onError?: (message: string) => void;
    },
  ) => {
    const res = await fetch(`/api/v1/marketing/posts/${postId}/regenerate/stream`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": tenantId,
      },
      body: JSON.stringify({ brief: brief || undefined }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as ApiError;
        if (typeof data.detail === "string") detail = data.detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    if (!res.body) throw new Error("No stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(5).trim()) as {
            type: string;
            message?: string;
            text?: string;
            tags?: string[];
            post?: ContentPost;
          };
          if (event.type === "status" && event.message) handlers.onStatus?.(event.message);
          if (event.type === "caption" && typeof event.text === "string") {
            handlers.onCaption?.(event.text);
          }
          if (event.type === "cta" && typeof event.text === "string") handlers.onCta?.(event.text);
          if (event.type === "hashtags" && Array.isArray(event.tags)) {
            handlers.onHashtags?.(event.tags);
          }
          if (event.type === "done" && event.post) handlers.onDone?.(event.post);
          if (event.type === "error") {
            handlers.onError?.(event.message || "Regenerate failed");
          }
        } catch {
          /* ignore partial */
        }
      }
    }
  },

  regeneratePost: (tenantId: string, postId: string, brief?: GenerationBrief) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}/regenerate`,
      { method: "POST", body: JSON.stringify({ brief: brief || undefined }) },
      tenantId,
    ),

  generatePostGraphic: (tenantId: string, postId: string) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}/generate-graphic`,
      { method: "POST" },
      tenantId,
    ),

  generatePostGraphics: (
    tenantId: string,
    postId: string,
    body?: {
      count?: number;
      replace?: boolean;
      template_id?: string;
      template_ids?: string[];
      image_url?: string;
      media_asset_id?: string;
      use_logo?: boolean;
      engine?: "auto" | "ai" | "template";
      style_hint?: string;
      on_image_text?: string;
      image_prompt?: string;
    },
  ) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}/generate-graphics`,
      { method: "POST", body: JSON.stringify(body || {}) },
      tenantId,
    ),

  suggestGraphicDirection: (
    tenantId: string,
    postId: string,
    body?: { notes?: string; mode?: "text" | "image" | "both" },
  ) =>
    request<{
      on_image_text: string | null;
      image_prompt: string | null;
      source: string;
    }>(
      `/api/v1/marketing/posts/${postId}/suggest-graphic-direction`,
      { method: "POST", body: JSON.stringify(body || {}) },
      tenantId,
    ),

  graphicTemplates: (tenantId: string) =>
    request<{
      templates: {
        id: string;
        name: string;
        category: string;
        hint: string;
        preview: { bg: string; accent: string; mid: string };
        supports_image: boolean;
      }[];
    }>("/api/v1/marketing/graphic-templates", {}, tenantId),

  attachPostMedia: (tenantId: string, postId: string, mediaIds: string[]) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}/media`,
      { method: "POST", body: JSON.stringify({ media_ids: mediaIds }) },
      tenantId,
    ),

  detachPostMedia: (tenantId: string, postId: string, mediaId: string) =>
    request<ContentPost>(
      `/api/v1/marketing/posts/${postId}/media/${mediaId}`,
      { method: "DELETE" },
      tenantId,
    ),

  listMedia: (tenantId: string, source?: "upload" | "ai_generated") =>
    request<MediaAsset[]>(
      `/api/v1/media${source ? `?source=${source}` : ""}`,
      {},
      tenantId,
    ),

  suggestMediaRedesignPrompt: (
    tenantId: string,
    mediaId: string,
    body?: { notes?: string },
  ) =>
    request<{
      prompt: string;
      source: string;
      mode: "fork" | "iterate" | string;
      suggest_mode?: "enhance" | "draft" | string;
      intent?: string;
      message?: string;
      suggestions?: { id: string; label: string; prompt: string }[];
    }>(
      `/api/v1/media/${mediaId}/suggest-redesign-prompt`,
      { method: "POST", body: JSON.stringify(body || {}) },
      tenantId,
    ),

  redesignMedia: (
    tenantId: string,
    mediaId: string,
    body: { prompt: string; chat_notes?: string; intent?: string },
  ) =>
    request<{
      asset: MediaAsset;
      mode: "fork" | "iterate" | string;
      kept_original: boolean;
      message: string;
      intent?: string;
      overlay?: { headline?: string; subline?: string; cta?: string } | null;
    }>(
      `/api/v1/media/${mediaId}/redesign`,
      { method: "POST", body: JSON.stringify(body) },
      tenantId,
    ),

  uploadMedia: async (
    tenantId: string,
    file: File,
    title?: string,
    onProgress?: (pct: number) => void,
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);

    return new Promise<MediaAsset>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/v1/media/upload");
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-Tenant-Id", tenantId);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.min(92, Math.round((e.loaded / e.total) * 92)));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(96);
          try {
            resolve(JSON.parse(xhr.responseText) as MediaAsset);
          } catch {
            reject(new Error("Invalid upload response"));
          }
          return;
        }
        let detail = xhr.statusText || "Upload failed";
        try {
          const data = JSON.parse(xhr.responseText) as ApiError;
          if (typeof data.detail === "string") detail = data.detail;
        } catch {
          /* ignore */
        }
        reject(new Error(detail));
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(form);
    });
  },

  deleteMedia: (tenantId: string, mediaId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/v1/media/${mediaId}`,
      { method: "DELETE" },
      tenantId,
    ),

  adminSuccessMetrics: () =>
    request<{
      tenants: number;
      campaigns: number;
      draft_posts: number;
      approved_posts: number;
      published_posts: number;
      approval_rate_pct: number;
      avg_time_to_first_campaign_minutes: number | null;
      time_to_first_campaign_under_10_min: boolean;
      weekly_active_users: number;
      customer_retention_pct: number | null;
      target: {
        time_to_first_campaign_minutes: number;
        approval_rate_pct: number;
        weekly_active_users: string;
      };
    }>("/api/v1/admin/success-metrics"),

  generationOptions: (tenantId: string) =>
    request<{
      tones: { id: string; label: string; hint: string }[];
      occasions: { id: string; label: string; hint: string }[];
    }>("/api/v1/marketing/generation-options", {}, tenantId),

  assistBrief: (
    tenantId: string,
    body: { rough_notes?: string; scope?: "month" | "day" },
  ) =>
    request<{
      focus: string;
      tone_suggestion: string;
      occasion_suggestion: string;
      polished_brief: string;
      extra_notes: string | null;
    }>("/api/v1/marketing/assist/brief", { method: "POST", body: JSON.stringify(body) }, tenantId),

  adminTenantMarketing: (tenantId: string) =>
    request<{
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      business_name: string | null;
      industry: string | null;
      campaigns: {
        id: string;
        title: string;
        month: number;
        year: number;
        status: string;
        strategy_summary: string | null;
        pillars: { name: string; intent: string }[] | null;
        objectives: string[] | null;
        generation_provider: string | null;
        generation_model: string | null;
        post_count: number;
        created_at: string;
        posts: ContentPost[];
      }[];
    }>(`/api/v1/admin/tenants/${tenantId}/marketing`),

  adminLlmActivity: (tenantId?: string) =>
    request<
      {
        id: string;
        created_at: string;
        tenant_id: string;
        tenant_name: string;
        tenant_slug: string;
        user_email: string | null;
        user_name: string | null;
        feature: string;
        action: string;
        provider: string;
        model: string;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        tone: string | null;
        occasion: string | null;
        focus: string | null;
        prompt_excerpt: string | null;
        response_excerpt: string | null;
        campaign_id: string | null;
        post_id: string | null;
        day_index: number | null;
      }[]
    >(`/api/v1/admin/llm/activity${tenantId ? `?tenant_id=${tenantId}` : ""}`),

  adminGetCloudinary: () =>
    request<{
      id: string | null;
      cloud_name: string;
      api_key_masked: string;
      api_secret_masked: string;
      folder_prefix: string;
      is_active: boolean;
      source: string;
      configured: boolean;
      updated_at: string | null;
    }>("/api/v1/admin/integrations/cloudinary"),

  adminUpdateCloudinary: (body: {
    cloud_name: string;
    api_key?: string;
    api_secret?: string;
    folder_prefix?: string;
    is_active?: boolean;
  }) =>
    request<{
      id: string | null;
      cloud_name: string;
      api_key_masked: string;
      configured: boolean;
      source: string;
    }>("/api/v1/admin/integrations/cloudinary", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  adminTestCloudinary: () =>
    request<{ ok: boolean; url: string; source: string }>(
      "/api/v1/admin/integrations/cloudinary/test",
      { method: "POST" },
    ),

  adminEmailCatalog: () =>
    request<{ kind: string; label: string; hint: string; fields: string[] }[]>(
      "/api/v1/admin/email/catalog",
    ),

  adminListEmailProviders: () =>
    request<
      {
        id: string;
        kind: string;
        name: string;
        api_key_masked: string;
        from_email: string;
        from_name: string;
        reply_to: string | null;
        is_active: boolean;
        priority: number;
        last_ok_at: string | null;
        last_error: string | null;
      }[]
    >("/api/v1/admin/email/providers"),

  adminCreateEmailProvider: (body: {
    kind: string;
    name: string;
    api_key: string;
    from_email: string;
    from_name?: string;
    reply_to?: string;
    is_active?: boolean;
    priority?: number;
  }) =>
    request<{ id: string }>("/api/v1/admin/email/providers", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  adminUpdateEmailProvider: (
    id: string,
    body: Partial<{
      name: string;
      api_key: string;
      from_email: string;
      from_name: string;
      reply_to: string;
      is_active: boolean;
      priority: number;
    }>,
  ) =>
    request<{ id: string }>(`/api/v1/admin/email/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  adminDeleteEmailProvider: (id: string) =>
    request<void>(`/api/v1/admin/email/providers/${id}`, { method: "DELETE" }),

  adminTestEmailProvider: (id: string, to: string) =>
    request<{ ok: boolean; provider?: string }>(`/api/v1/admin/email/providers/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),

  adminMediaUsage: (tenantId?: string) =>
    request<
      {
        id: string;
        tenant_id: string;
        tenant_name: string | null;
        user_email: string | null;
        media_url: string | null;
        engine: string;
        image_provider: string | null;
        image_model: string | null;
        estimated_cost_usd: string;
        created_at: string;
      }[]
    >(`/api/v1/admin/media-usage${tenantId ? `?tenant_id=${tenantId}` : ""}`),

  adminMediaUsageSummary: () =>
    request<{
      total_events: number;
      total_estimated_cost_usd: string;
      by_model: {
        provider: string;
        model: string;
        events: number;
        estimated_cost_usd: string;
      }[];
    }>("/api/v1/admin/media-usage/summary"),

  adminImageCostRates: () =>
    request<{
      rates: {
        id: string | null;
        provider: string;
        model: string;
        usd_per_image: string;
        notes: string | null;
        is_active: boolean;
        source: string;
      }[];
      defaults: {
        id: string | null;
        provider: string;
        model: string;
        usd_per_image: string;
        notes: string | null;
        source: string;
      }[];
    }>("/api/v1/admin/image-cost-rates"),

  adminUpsertImageCostRate: (body: {
    provider: string;
    model: string;
    usd_per_image: string;
    notes?: string;
    is_active?: boolean;
  }) =>
    request<{ id: string }>("/api/v1/admin/image-cost-rates", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  adminPlatformActivity: (tenantId?: string) =>
    request<
      {
        id: string;
        source: string;
        event_type: string;
        title: string;
        tenant_id: string | null;
        created_at: string | null;
        metadata?: Record<string, unknown>;
      }[]
    >(`/api/v1/admin/activity${tenantId ? `?tenant_id=${tenantId}` : ""}`),

  listTeamMembers: (tenantId: string) =>
    request<
      {
        membership_id: string;
        user_id: string;
        email: string;
        full_name: string;
        role: string;
        permissions: string[];
        permissions_overrides: Record<string, boolean> | null;
        is_default: boolean;
        joined_at: string;
      }[]
    >("/api/v1/team/members", {}, tenantId),

  updateTeamMember: (
    tenantId: string,
    membershipId: string,
    body: { role?: string; permissions?: Record<string, boolean> },
  ) =>
    request<{ membership_id: string }>(`/api/v1/team/members/${membershipId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, tenantId),

  removeTeamMember: (tenantId: string, membershipId: string) =>
    request<void>(`/api/v1/team/members/${membershipId}`, { method: "DELETE" }, tenantId),

  listTeamInvites: (tenantId: string) =>
    request<
      {
        id: string;
        email: string;
        role: string;
        permissions: Record<string, boolean> | null;
        invite_url: string | null;
        expires_at: string;
        accepted_at: string | null;
        created_at: string;
      }[]
    >("/api/v1/team/invites", {}, tenantId),

  createTeamInvite: (
    tenantId: string,
    body: {
      email: string;
      role: string;
      permissions?: Record<string, boolean>;
      full_name_hint?: string;
    },
  ) =>
    request<{
      id: string;
      email: string;
      role: string;
      invite_url: string | null;
      expires_at: string;
    }>("/api/v1/team/invites", { method: "POST", body: JSON.stringify(body) }, tenantId),

  revokeTeamInvite: (tenantId: string, inviteId: string) =>
    request<void>(`/api/v1/team/invites/${inviteId}`, { method: "DELETE" }, tenantId),

  previewInvite: (token: string) =>
    request<{
      org_name: string;
      email: string;
      role: string;
      permissions: string[];
      inviter_name: string | null;
      expires_at: string;
      already_member: boolean;
      user_exists: boolean;
    }>(`/api/v1/team/invites/preview/${token}`),

  acceptInvite: (body: { token: string; full_name: string; password?: string }) =>
    request<{
      ok: boolean;
      tenant_id: string;
      user_id: string;
      new_user: boolean;
      email?: string;
    }>("/api/v1/team/invites/accept", { method: "POST", body: JSON.stringify(body) }),

  teamPermissionsCatalog: (tenantId: string) =>
    request<{
      permissions: string[];
      roles: Record<string, string[]>;
    }>("/api/v1/team/permissions-catalog", {}, tenantId),

  getSubscription: (tenantId: string) =>
    request<{
      id: string;
      plan: string;
      status: string;
      provider: string;
      currency: string;
      amount_kobo: number;
      trial_ends_at: string | null;
      current_period_end: string | null;
      days_remaining: number | null;
    }>("/api/v1/billing/subscription", {}, tenantId),

  listPlans: () =>
    request<{
      currency: string;
      plans: {
        id: string;
        name: string;
        amount_kobo: number;
        amount_naira: number;
        features: string[];
      }[];
    }>("/api/v1/billing/plans"),

  startCheckout: (
    tenantId: string,
    body: { plan: string; provider: "paystack" | "flutterwave" },
  ) =>
    request<{
      message: string;
      provider: string;
      plan: string;
      amount_kobo: number;
      currency: string;
      reference: string;
      checkout_url: string | null;
      status: string;
    }>("/api/v1/billing/checkout", { method: "POST", body: JSON.stringify(body) }, tenantId),

  activateMockPlan: (tenantId: string, plan: string) =>
    request<{
      id: string;
      plan: string;
      status: string;
      days_remaining: number | null;
    }>(
      `/api/v1/billing/activate-mock?plan=${plan}`,
      { method: "POST" },
      tenantId,
    ),

  adminUpdateTenantStatus: (tenantId: string, status: string) =>
    request<{ id: string; name: string; status: string }>(
      `/api/v1/admin/tenants/${tenantId}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
};

export type GenerationBrief = {
  tone_id?: string;
  custom_tone?: string;
  occasion_id?: string;
  custom_occasion?: string;
  focus?: string;
  extra_notes?: string;
  platform_override?: string;
};

export type MediaAsset = {
  id: string;
  url: string;
  public_id?: string | null;
  filename?: string | null;
  title?: string | null;
  mime_type?: string | null;
  source: "upload" | "ai_generated" | string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  role?: string | null;
  origin_post_id?: string | null;
  created_at: string;
  sort_order?: number;
  attachment_role?: string | null;
  meta_json?: Record<string, unknown> | null;
};

export type ContentPost = {
  id: string;
  campaign_id: string;
  scheduled_date: string;
  day_index: number;
  platform: string;
  theme: string;
  caption: string;
  hashtags: string[] | null;
  cta: string | null;
  graphic_prompt: string | null;
  graphic_url?: string | null;
  status: string;
  media?: MediaAsset[];
  media_count?: number;
};

export type Campaign = {
  id: string;
  title: string;
  month: number;
  year: number;
  status: string;
  strategy_summary: string | null;
  pillars: { name: string; intent: string }[] | null;
  objectives: string[] | null;
  generation_provider?: string | null;
  generation_model?: string | null;
  posts: ContentPost[];
  created_at: string;
};
