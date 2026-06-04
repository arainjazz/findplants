import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { renderDraftHtml, type PlantDraftFields } from "./plant-html-template";
import { slugify } from "./plants";

const AI_MODEL = "google/gemini-2.5-pro";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

type AiMeta = Omit<
  PlantDraftFields,
  "photo_url" | "capture_place" | "capture_lat" | "capture_lng" | "capture_date" | "ai_model"
>;

async function callAiIdentify(photoDataUrl: string, hintPlace: string): Promise<AiMeta> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY 未配置");

  const systemPrompt = `你是植物图鉴编辑助手。给定一张实地拍摄的植物照片（可选附带拍摄地点），请尽你所能识别物种，并按 emit_plant_draft 工具返回中英双语的科普草稿。
要求：
- 中文段落使用 Noto Serif SC 风格的正式植物志措辞，每段 150–300 字。
- 英文段落为对应中文段落的精炼意译，70–150 词。
- summary：一段总览，体现植物名、所属科属、最显著的形态/生态特征。
- name_origin：解释中文名与拉丁学名（Zizania, latifolia 这种）的含义和命名史，如不确定可基于词源给出最合理推断。
- morphology：描述根/茎/叶/花/果等关键形态。
- habitat：描述其常见生境与分布范围，并在中文段落里自然带出"本次拍摄于 ${hintPlace || "（未知地点）"}"这一信息。
- culture：描述文化、食用、药用或园艺利用，若该物种无相关用途则简述生态角色。
- tags：3–8 个简短标签（中英文均可），用于站内检索，如「水生」「禾本科」「多年生」「invasive」等。
- iucn_status：仅在你有充分把握时填入 LC/NT/VU/EN/CR/DD 之一，否则留空字符串。
- 若识别不确定，仍要给出最可能的物种，并在 summary 中标注"疑似"。`;

  const body = {
    model: AI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请直接调用工具返回结构化结果。`,
          },
          { type: "image_url", image_url: { url: photoDataUrl } },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_plant_draft",
          description: "返回植物识别与科普草稿",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "中文物种名" },
              scientific_name: { type: "string", description: "拉丁学名（含命名人）" },
              common_name_en: { type: "string", description: "英文 common name" },
              family: { type: "string", description: "科（中文+拉丁，如『禾本科 Poaceae』）" },
              genus: { type: "string", description: "属（中文+拉丁）" },
              iucn_status: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              summary_zh: { type: "string" },
              summary_en: { type: "string" },
              name_origin_zh: { type: "string" },
              name_origin_en: { type: "string" },
              morphology_zh: { type: "string" },
              morphology_en: { type: "string" },
              habitat_zh: { type: "string" },
              habitat_en: { type: "string" },
              culture_zh: { type: "string" },
              culture_en: { type: "string" },
            },
            required: [
              "title",
              "scientific_name",
              "common_name_en",
              "family",
              "genus",
              "iucn_status",
              "tags",
              "summary_zh",
              "summary_en",
              "name_origin_zh",
              "name_origin_en",
              "morphology_zh",
              "morphology_en",
              "habitat_zh",
              "habitat_en",
              "culture_zh",
              "culture_en",
            ],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "emit_plant_draft" } },
  };

  const resp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    if (resp.status === 429) throw new Error("AI 调用太频繁，请稍后重试");
    if (resp.status === 402) throw new Error("AI 额度已用完，请到工作区充值");
    const t = await resp.text();
    console.error("AI gateway error", resp.status, t);
    throw new Error(`AI 网关错误 ${resp.status}`);
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI 未返回结构化结果");
  return typeof args === "string" ? JSON.parse(args) : args;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // Use the AI gateway with a tiny text-only prompt to map coords -> Chinese place name.
  // Avoids needing an extra geocoding API key.
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return "";
  try {
    const resp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "你是地理助手。给定经纬度，仅用一行简体中文返回最可能的行政区位置（省/市/区或国家+城市），不要解释、不要标点。",
          },
          { role: "user", content: `纬度 ${lat}，经度 ${lng}` },
        ],
      }),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    const txt: string = data.choices?.[0]?.message?.content ?? "";
    return txt.trim().split("\n")[0].slice(0, 60);
  } catch {
    return "";
  }
}

const SubmitInput = z.object({
  photo_base64: z.string().min(100).max(8_000_000),
  photo_mime: z.string().regex(/^image\/(jpeg|jpg|png|webp)$/i).default("image/jpeg"),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  creator_label: z.string().max(80).optional(),
});

export const submitPlantDraft = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Try to identify the authenticated user (optional — anon is allowed).
    let createdBy: string | null = null;
    let creatorLabel = data.creator_label?.trim() || "访客";
    try {
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const authHeader = getRequestHeader("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const { data: u } = await supabaseAdmin.auth.getUser(token);
        if (u.user) {
          createdBy = u.user.id;
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("display_name")
            .eq("id", u.user.id)
            .maybeSingle();
          if (prof?.display_name) creatorLabel = prof.display_name;
        }
      }
    } catch {
      /* anon */
    }

    // Reverse-geocode (if coords supplied).
    let place = "";
    const lat = data.lat ?? null;
    const lng = data.lng ?? null;
    if (lat != null && lng != null) {
      place = await reverseGeocode(lat, lng);
    }

    // Build the data URL for the multimodal AI call.
    const dataUrl = `data:${data.photo_mime};base64,${data.photo_base64}`;

    // Call AI to identify + generate copy.
    const meta = await callAiIdentify(dataUrl, place);

    // Upload the photo to Storage (drafts/ prefix is anon-writable).
    const buffer = Buffer.from(data.photo_base64, "base64");
    const ext = data.photo_mime.includes("png") ? "png" : data.photo_mime.includes("webp") ? "webp" : "jpg";
    const path = `drafts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("plant-images")
      .upload(path, buffer, { contentType: data.photo_mime, upsert: false });
    if (upErr) throw new Error(`照片上传失败：${upErr.message}`);
    const photoUrl = supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl;

    // Compose HTML.
    const captureDate = new Date().toISOString().slice(0, 10);
    const html = renderDraftHtml({
      ...meta,
      photo_url: photoUrl,
      capture_place: place || "未知地点",
      capture_lat: lat != null ? lat.toFixed(5) : "",
      capture_lng: lng != null ? lng.toFixed(5) : "",
      capture_date: captureDate,
      ai_model: AI_MODEL,
    });

    // Persist draft row.
    const { data: row, error: insErr } = await supabaseAdmin
      .from("plant_drafts")
      .insert({
        created_by: createdBy,
        creator_label: creatorLabel,
        photo_url: photoUrl,
        capture_lat: lat,
        capture_lng: lng,
        capture_place: place,
        ai_model: AI_MODEL,
        ai_payload: meta as unknown as Record<string, unknown>,
        title: meta.title,
        scientific_name: meta.scientific_name,
        common_name_en: meta.common_name_en,
        family: meta.family,
        genus: meta.genus,
        summary: meta.summary_zh.slice(0, 600),
        tags: meta.tags ?? [],
        iucn_status: meta.iucn_status || null,
        html_content: html,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`保存草稿失败：${insErr.message}`);
    return { draftId: row.id as string, place };
  });

// ─── Approve draft → publish into plants + record edit ──────────────────────
const ApproveInput = z.object({ draftId: z.string().uuid() });

export const approvePlantDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApproveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check editor or admin
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isEditor = roles?.some((r) => r.role === "editor" || r.role === "admin");
    if (!isEditor) throw new Error("仅审核通过的编辑可以收录草稿");

    const { data: draft, error: dErr } = await supabaseAdmin
      .from("plant_drafts")
      .select("*")
      .eq("id", data.draftId)
      .maybeSingle();
    if (dErr) throw dErr;
    if (!draft) throw new Error("草稿不存在");
    if (draft.status === "approved" && draft.published_plant_id) {
      return { plantId: draft.published_plant_id as string };
    }

    // Build slug: prefer ASCII slug of scientific name, fall back to id.
    let slug = slugify(draft.scientific_name || draft.title || "");
    if (!slug || slug.startsWith("p-")) slug = `draft-${draft.id.slice(0, 8)}`;

    // Ensure slug uniqueness
    for (let i = 0; i < 5; i++) {
      const { data: dup } = await supabaseAdmin
        .from("plants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!dup) break;
      slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
    }

    // Upload the HTML body to plant-html bucket.
    const htmlPath = `${userId}/draft-${draft.id}.html`;
    const blob = new Blob([draft.html_content as string], { type: "text/html" });
    const { error: upErr } = await supabaseAdmin.storage
      .from("plant-html")
      .upload(htmlPath, blob, { contentType: "text/html", upsert: true });
    if (upErr) throw new Error(`HTML 上传失败：${upErr.message}`);
    const htmlUrl = supabaseAdmin.storage.from("plant-html").getPublicUrl(htmlPath).data.publicUrl;

    // Insert plants row (admin = bypass RLS so we can set author_id = approver).
    const { data: plant, error: pErr } = await supabaseAdmin
      .from("plants")
      .insert({
        slug,
        title: draft.title,
        scientific_name: draft.scientific_name,
        common_name_en: draft.common_name_en,
        family: draft.family,
        genus: draft.genus,
        summary: draft.summary,
        cover_url: draft.photo_url,
        content_type: "html",
        html_url: htmlUrl,
        tags: draft.tags ?? [],
        author_id: userId,
        iucn_status: draft.iucn_status,
      })
      .select("id")
      .single();
    if (pErr) throw new Error(`收录失败：${pErr.message}`);

    // Update draft status.
    await supabaseAdmin
      .from("plant_drafts")
      .update({ status: "approved", published_plant_id: plant.id })
      .eq("id", draft.id);

    // Editor display name
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();

    // Write edits log entries.
    const source = `ai:${AI_MODEL}@lovable-ai+ai_camera_capture`;
    await supabaseAdmin.from("plant_edits").insert([
      {
        plant_id: plant.id,
        editor_id: userId,
        editor_name: prof?.display_name ?? "编辑",
        kind: "create",
        marker_n: 0,
        summary: `由 AI 草稿收录：${draft.title}（拍摄于 ${draft.capture_place || "未知地点"}）`,
        source,
      },
      {
        plant_id: plant.id,
        editor_id: userId,
        editor_name: prof?.display_name ?? "编辑",
        kind: "draft_approve",
        marker_n: 0,
        summary: `审核通过 AI 草稿 #${draft.id.slice(0, 8)}（提交者：${draft.creator_label}）`,
        source,
      },
    ]);

    return { plantId: plant.id as string, slug };
  });

const RejectInput = z.object({ draftId: z.string().uuid() });
export const rejectPlantDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RejectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isEditor = roles?.some((r) => r.role === "editor" || r.role === "admin");
    if (!isEditor) throw new Error("仅审核通过的编辑可以驳回草稿");
    await supabaseAdmin
      .from("plant_drafts")
      .update({ status: "rejected" })
      .eq("id", data.draftId);
    return { ok: true };
  });
