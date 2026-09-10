/**
 * 平台管理者代登入 —— #25 的八格驗收整合測試
 * -----------------------------------------------------------------------------
 * 規格：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` §7
 * Owner 裁示：`docs/OWNER-DECISIONS.md`（2026-08-27 / 2026-08-28）
 *
 * 八格對應（每個 describe 標題直接標號，驗收時逐條對照）：
 *   1 角色分離、租戶 OWNER 無法自我升級
 *   2 進入後可查看**且可修改**
 *   3 非 platform admin 一律 403（含租戶 OWNER）
 *   4 全程 audit（進入／退出／每次寫入）
 *   5 租戶自己查得到
 *   6 不取得也不共用密碼
 *   7 provenance 只作來源 badge，不改變 owner 權限
 *   8 與 tour platform 的連通（guideId → tenant）
 *
 * ⚠️ 這一檔跑的是**真的** HTTP + 真的資料庫。斷言一律直查資料庫確認，
 * 不以 API 自己的回應當作「事情真的發生了」的證據。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SHOP_A, SHOP_B, STAFF_A2, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = `platform-admin-${suffix}@test.local`;
const OUTSIDER_EMAIL = `outsider-${suffix}@test.local`;
const PASSWORD = 'Passw0rd!pa';
const GUIDE_ID = '9e000000-0000-4000-8000-0000000000a1';

let admin: SupabaseClient;
let adminUserId = '';
let outsiderUserId = '';
let api: AuthedApi;          // platform admin 的登入 session
let ownerApi: AuthedApi;     // A 店 OWNER 的登入 session
let sessionId = '';
let createdServiceId = '';
/** 本檔會改到共用種子（trip_plans.planA1），afterAll 必須原樣還原——整合測試串行共用一個庫。 */
let planA1Before: { name: string; source: string | null } | null = null;
/** 種子有沒有給 SHOP_A TOUR_MODULE；沒有的話本檔自己開通，afterAll 要刪回去。 */
let tourModuleWasGranted = false;
/** B 店的一筆服務，專供跨租戶隔離比對（種子的 SHOP_B 是最小資料，沒有服務）。 */
let shopBServiceId = '';
/** 代登入下建立的方案，用來驗 source 自動標記；afterAll 刪掉。 */
let impersonatedPlanId = '';

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  expect(error, `建立測試帳號 ${email} 失敗：${error?.message}`).toBeNull();
  return data!.user!.id;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  adminUserId = await createUser(ADMIN_EMAIL);
  outsiderUserId = await createUser(OUTSIDER_EMAIL);

  // 授予只能由 service role 直接寫 DB —— 這正是驗收 1 要證的事。
  const { error: grantErr } = await admin
    .from('platform_admins')
    .insert({ user_id: adminUserId, active: true });
  expect(grantErr, `授予 platform admin 失敗：${grantErr?.message}`).toBeNull();

  // 驗收 8：把 A 店對應到一個 tour platform 的導遊 id。
  const { error: mapErr } = await admin
    .from('tenants')
    .update({ midao_guide_id: GUIDE_ID })
    .eq('id', SHOP_A.id);
  expect(mapErr, `寫入 midao_guide_id 失敗：${mapErr?.message}`).toBeNull();

  // 種子的 SHOP_B 是「最小資料」，沒有任何服務——沒有東西可比對，跨租戶那條就會
  // 退化成一個永遠成立的斷言。這裡自己補一筆，afterAll 刪掉。
  const { data: bService, error: bServiceErr } = await admin
    .from('services')
    .insert({
      tenant_id: SHOP_B.id,
      name: `B店隔離比對用-${suffix}`,
      description: '',
      duration_minutes: 30,
      price: 100,
      image_url: '',
      active: true,
      line_featured: false,
      sort_order: 900,
      line_sort_order: 900,
    })
    .select('id')
    .single();
  expect(bServiceErr, `建立 B 店比對服務失敗：${bServiceErr?.message}`).toBeNull();
  shopBServiceId = bService!.id as string;

  // 驗收 7 要打 `PUT /api/trip-plans/:id`，那支端點有 `TOUR_MODULE` 閘門，
  // 而**標準種子沒有給 SHOP_A 這個訂閱**（keyword-replies.05 / tours.10 也各自
  // 踩過同一個坑）。第一版沒開通，於是拿到 FEAT_001 403，看起來像
  // 「provenance 變成了權限」——其實只是這家店沒訂閱旅遊模組。
  const { data: featBefore } = await admin
    .from('feature_subscriptions')
    .select('code')
    .eq('tenant_id', SHOP_A.id)
    .eq('code', 'TOUR_MODULE')
    .maybeSingle();
  tourModuleWasGranted = Boolean(featBefore);
  if (!tourModuleWasGranted) {
    const { error: featErr } = await admin.from('feature_subscriptions').upsert(
      {
        tenant_id: SHOP_A.id,
        code: 'TOUR_MODULE',
        active: true,
        expires_at: null,
        source: 'GRANTED',
        cancelled_at: null,
      },
      { onConflict: 'tenant_id,code' },
    );
    expect(featErr, `開通 TOUR_MODULE 失敗，驗收 7 就驗不到：${featErr?.message}`).toBeNull();
  }

  const { data: planBefore } = await admin
    .from('trip_plans')
    .select('name, source')
    .eq('id', TRIP_A.planA1)
    .maybeSingle();
  planA1Before = planBefore
    ? { name: planBefore.name as string, source: (planBefore.source as string | null) ?? null }
    : null;

  api = await loginAs(ADMIN_EMAIL, PASSWORD);
  ownerApi = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
}, 60_000);

afterAll(async () => {
  if (!admin) return;
  await admin.from('tenants').update({ midao_guide_id: null }).eq('id', SHOP_A.id);
  if (createdServiceId) await admin.from('services').delete().eq('id', createdServiceId);
  if (shopBServiceId) await admin.from('services').delete().eq('id', shopBServiceId);
  if (impersonatedPlanId) await admin.from('trip_plans').delete().eq('id', impersonatedPlanId);
  if (!tourModuleWasGranted) {
    await admin
      .from('feature_subscriptions')
      .delete()
      .eq('tenant_id', SHOP_A.id)
      .eq('code', 'TOUR_MODULE');
  }
  if (planA1Before) {
    await admin
      .from('trip_plans')
      .update({ name: planA1Before.name, source: planA1Before.source })
      .eq('id', TRIP_A.planA1);
  }
  await admin.from('platform_admins').update({ active: true }).eq('user_id', adminUserId);
  await admin.from('platform_admins').delete().eq('user_id', adminUserId);

  /**
   * ⚠️ 順序有意義，而且原本是錯的：`impersonation_sessions.admin_user_id` 是
   * `on delete restrict`，所以只要還有 session 列，`deleteUser()` 必然失敗——
   * 而它被 `.catch(() => undefined)` 吞掉，於是每跑一次就在共用 TEST 庫留下一個
   * 平台管理者帳號。先刪 action（外鍵指向 session）、再刪 session，才刪得掉帳號。
   */
  if (adminUserId) {
    const { data: mySessions } = await admin
      .from('impersonation_sessions')
      .select('id')
      .eq('admin_user_id', adminUserId);
    const sessionIds = (mySessions ?? []).map((s) => s.id as string);
    if (sessionIds.length) {
      await admin.from('impersonation_actions').delete().in('session_id', sessionIds);
      await admin.from('impersonation_sessions').delete().in('id', sessionIds);
    }
  }

  for (const id of [adminUserId, outsiderUserId]) {
    if (!id) continue;
    const { error } = await admin.auth.admin.deleteUser(id);
    // 刪不掉就講出來，不要靜靜留下一個帳號在共用 TEST 庫裡。
    if (error) console.error(`[cleanup] 刪不掉測試帳號 ${id}：${error.message}`);
  }
});

// ---------------------------------------------------------------------------
describe('驗收 1 —— platform admin 與租戶角色完全分離', () => {
  it('platform admin 不是任何租戶的成員（tenant_users 查無此人）', async () => {
    const { data, error } = await admin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', adminUserId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('沒有任何 API 能新增 platform admin（原始碼掃描）', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (entry.endsWith('.ts') && /platform_admins/.test(readFileSync(p, 'utf8'))) {
          // 只讀（select）不算提權；寫入才是。
          const src = readFileSync(p, 'utf8');
          if (/from\('platform_admins'\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(src)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(join(process.cwd(), 'src/app/api'));
    expect(offenders, `這些端點會寫 platform_admins：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('租戶 OWNER 無法自我升級：以 OWNER 身分直接寫 platform_admins 被 RLS 擋下', async () => {
    const anon = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: SHOP_A.owner.email,
      password: SHOP_A.owner.password,
    });
    expect(signInErr).toBeNull();

    const { data: userRes } = await anon.auth.getUser();
    const { error } = await anon
      .from('platform_admins')
      .insert({ user_id: userRes.user!.id, active: true });
    expect(error, '租戶 OWNER 竟然寫得進 platform_admins —— 這是全平台提權').not.toBeNull();

    // 連讀都不該讀得到（「有沒有人是管理者」不外洩）。
    const { data: readBack } = await anon.from('platform_admins').select('user_id');
    expect(readBack ?? []).toEqual([]);

    // ⚠️ 這裡**不能** signOut()。supabase-js 的 signOut 預設是 global scope，
    // 會把該使用者**所有**裝置的 session 一起撤銷——包含 beforeAll 裡
    // `ownerApi` 那份 cookie session。第一版就是這樣寫的，結果後面每一個
    // 以 A 店 OWNER 身分發的請求都變成 401，看起來像端點壞了。
    // 這個 client 是 persistSession:false 的暫時物件，讓它自然被回收即可。
  });
});

// ---------------------------------------------------------------------------
describe('驗收 3 —— 非 platform admin 一律 403', () => {
  it('未登入 → 401', async () => {
    const res = await fetch(`${BASE}/api/platform/impersonation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: SHOP_A.id, reason: '未登入不該進得來' }),
    });
    expect(res.status).toBe(401);
  });

  it('一般登入者（非管理者、非成員）→ 403', async () => {
    const outsider = await loginAs(OUTSIDER_EMAIL, PASSWORD);
    const res = await outsider.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '我不是平台管理者',
    });
    expect(res.status).toBe(403);
  });

  it('租戶 OWNER 也是 403（自己店的 OWNER 不等於平台管理者）', async () => {
    const res = await ownerApi.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '我是自己店的 OWNER',
    });
    expect(res.status).toBe(403);
  });

  it('target 端點同樣擋（確認畫面不得成為店名列舉工具）', async () => {
    const res = await ownerApi.get(`/api/platform/impersonation/target?tenantId=${SHOP_B.id}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('驗收 8 —— 與 tour platform 的連通（guideId → tenant）', () => {
  it('用 guide id 查得到對應店家', async () => {
    const res = await api.get(`/api/platform/impersonation/target?guide=${GUIDE_ID}`);
    expect(res.status).toBe(200);
    const body = await readJson<{ tenantId: string; shopCode: string }>(res);
    expect(body.data!.tenantId).toBe(SHOP_A.id);
    expect(body.data!.shopCode).toBe(SHOP_A.shopCode);
  });

  it('沒對應到店家的 guide id → 404，且訊息說得出是哪一種情況', async () => {
    const res = await api.get(
      '/api/platform/impersonation/target?guide=9e000000-0000-4000-8000-0000000000ff',
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.message).toContain('導遊');
  });

  /**
   * ⚠️ 最終風險評估（第二輪）抓到的：`tenants` 早在 0003 就有一條不限欄位的
   * `for update using (tenant_role_at_least(id,'OWNER'))`，而 authenticated 對 tenants
   * 有 UPDATE。0095 新增 `midao_guide_id` 卻不擋，等於一併新增了一條劫持路徑：
   * 任一店的 OWNER 直打 PostgREST 就能把自己的店對應到任意導遊 id，於是 Midao 那端
   * 「進入導遊 G 的後台」會落到攻擊者的店。已用 trigger 擋住，這裡實測。
   */
  it('租戶 OWNER 改不動 midao_guide_id（不能劫持導遊對應）', async () => {
    const anon = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: SHOP_B.owner.email,
      password: SHOP_B.owner.password,
    });
    expect(signInErr).toBeNull();

    const { error } = await anon
      .from('tenants')
      .update({ midao_guide_id: GUIDE_ID })
      .eq('id', SHOP_B.id);
    expect(error, 'B 店 OWNER 竟然改得動 midao_guide_id —— 可以劫持導遊對應').not.toBeNull();

    // 直查確認真的沒改到（錯誤訊息可能誤導，看資料庫）。
    const { data } = await admin
      .from('tenants')
      .select('midao_guide_id')
      .eq('id', SHOP_B.id)
      .single();
    expect(data!.midao_guide_id).toBeNull();
  });

  it('guide 與 tenantId 同時給 → 400（含糊輸入沒有預設行為）', async () => {
    const res = await api.get(
      `/api/platform/impersonation/target?guide=${GUIDE_ID}&tenantId=${SHOP_A.id}`,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('驗收 2＋4 —— 進入後可查看且可修改，全程留紀錄', () => {
  it('reason 太短 → 400（沒有理由的進入紀錄等於沒有紀錄）', async () => {
    const res = await api.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '短',
    });
    expect(res.status).toBe(400);
  });

  it('用 guideId 進入 A 店 → 200，且 impersonation_sessions 留下一列', async () => {
    const res = await api.post('/api/platform/impersonation/start', {
      guideId: GUIDE_ID,
      reason: '協助店家設定 LINE 官方帳號',
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ sessionId: string; tenantId: string }>(res);
    sessionId = body.data!.sessionId;
    expect(body.data!.tenantId).toBe(SHOP_A.id);

    const { data, error } = await admin
      .from('impersonation_sessions')
      .select('admin_user_id, tenant_id, reason, ended_at, expires_at')
      .eq('id', sessionId)
      .single();
    expect(error).toBeNull();
    expect(data!.admin_user_id).toBe(adminUserId);
    expect(data!.tenant_id).toBe(SHOP_A.id);
    expect(data!.reason).toBe('協助店家設定 LINE 官方帳號');
    expect(data!.ended_at).toBeNull();
    // 30 分鐘硬上限
    const ttl = Date.parse(data!.expires_at as string) - Date.now();
    expect(ttl).toBeGreaterThan(25 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
  });

  it('current 回報代入中，且指向正確的店', async () => {
    const res = await api.get('/api/platform/impersonation/current');
    expect(res.status).toBe(200);
    const body = await readJson<{ active: boolean; tenantId: string }>(res);
    expect(body.data!.active).toBe(true);
    expect(body.data!.tenantId).toBe(SHOP_A.id);
  });

  it('**可查看**：以代入身分讀得到 A 店的服務', async () => {
    const res = await api.get('/api/services');
    expect(res.status).toBe(200);
    const body = await readJson<Array<{ id: string }>>(res);
    const ids = body.data!.map((s) => s.id);
    expect(ids).toContain(SHOP_A.serviceA1);
  });

  it('**可修改**：以代入身分新增一筆服務，直查資料庫確認真的寫進 A 店', async () => {
    const name = `平台代建服務-${suffix}`;
    const res = await api.post('/api/services', { name, price: 500, durationMinutes: 30 });
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    createdServiceId = body.data!.id;

    const { data, error } = await admin
      .from('services')
      .select('tenant_id, name')
      .eq('id', createdServiceId)
      .single();
    expect(error).toBeNull();
    expect(data!.tenant_id).toBe(SHOP_A.id);
    expect(data!.name).toBe(name);
  });

  it('那次寫入留下了 action 紀錄（method／path／status 都對）', async () => {
    const { data, error } = await admin
      .from('impersonation_actions')
      .select('method, path, status, tenant_id')
      .eq('session_id', sessionId)
      .eq('method', 'POST')
      .eq('path', '/api/services');
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].tenant_id).toBe(SHOP_A.id);
    expect(data![0].status).toBe(200);
  });

  /**
   * 21 分冊 §6：代登入下建立的資料自動標成 `PLATFORM_ASSISTED`，伺服器端決定。
   *
   * ⚠️ 最終風險審查抓到：這件事原本**一行都沒實作**（`grep -rn PLATFORM_ASSISTED src`
   * 零結果），而驗收 7 是先用 service role 直接把既有方案 update 成
   * `PLATFORM_ASSISTED` 再測——證了「badge 不改權限」，卻繞過了「建立時會被標記」。
   * 兩件事都要驗，這一條補的是後者。
   */
  it('**代登入下建立**的方案自動標成 PLATFORM_ASSISTED（不接受客戶端傳入）', async () => {
    const res = await api.post(`/api/trips/${TRIP_A.id}/plans`, {
      name: `平台代建方案-${suffix}`,
      pricePerPerson: 3000,
      // 故意送一個 source，伺服器必須忽略它——來源標記不接受客戶端決定。
      source: 'GUIDE',
    });
    // ⚠️ 只能讀一次 body。`expect(x, \`…${await res.text()}\`)` 的訊息是**先算好**才傳進去的，
    // 所以把 text() 寫在訊息裡會把 body 消耗掉，後面再 res.json() 就是
    // 「Body is unusable: Body has already been read」。先讀成字串，再自己 parse。
    const raw = await res.text();
    expect(res.status, `代建方案失敗：${raw}`).toBe(200);
    const body = JSON.parse(raw) as Envelope<{ id: string }>;
    impersonatedPlanId = body.data!.id;

    const { data, error } = await admin
      .from('trip_plans')
      .select('tenant_id, source')
      .eq('id', impersonatedPlanId)
      .single();
    expect(error).toBeNull();
    expect(data!.tenant_id).toBe(SHOP_A.id);
    expect(data!.source, '代建的資料沒有被標記，事後分不出是誰建的').toBe('PLATFORM_ASSISTED');
  });

  it('讀取不留紀錄（GET /api/services 不該產生 action）', async () => {
    const { data } = await admin
      .from('impersonation_actions')
      .select('id')
      .eq('session_id', sessionId)
      .eq('method', 'GET');
    expect(data ?? []).toEqual([]);
  });

  /**
   * ⚠️ 這一條原本寫成 `expect(ids).not.toContain(SHOP_B.id)`——拿**服務 id 陣列**去比對
   * **B 店的租戶 id**，兩者永遠不可能相等，所以把 `GET /api/services` 改成回全平台
   * 資料它照樣綠（PB-029）。最終風險審查抓到的：代登入分支明文「沒有第二道防線」，
   * 而這是它在整合層唯一的隔離證據，那條證據是空的。
   *
   * 改成兩面都驗：B 店真的有一筆服務，它**不能**出現；而且回傳的每一筆都要直查
   * 資料庫確認 tenant_id 屬於 A 店。
   */
  it('代入身分看不到別家店的資料（跨租戶邊界沒有因為代入而消失）', async () => {
    expect(shopBServiceId, 'B 店沒有服務可比對，這條就什麼都沒驗到').toBeTruthy();

    const res = await api.get('/api/services');
    expect(res.status).toBe(200);
    const body = await readJson<Array<{ id: string }>>(res);
    const ids = body.data!.map((s) => s.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(SHOP_A.serviceA1);
    expect(ids, '代入 A 店卻看得到 B 店的服務 —— 跨租戶邊界破了').not.toContain(shopBServiceId);

    const { data: rows, error } = await admin
      .from('services')
      .select('id, tenant_id')
      .in('id', ids);
    expect(error).toBeNull();
    expect(rows!.length).toBe(ids.length);
    expect(
      rows!.filter((r) => r.tenant_id !== SHOP_A.id),
      '回傳了不屬於 A 店的服務',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('驗收 5 —— 租戶自己查得到', () => {
  it('A 店 OWNER 讀得到剛才那段 session 與那筆 action', async () => {
    const res = await ownerApi.get('/api/settings/impersonation-log');
    expect(res.status).toBe(200);
    const body = await readJson<{
      sessions: Array<{ id: string; reason: string }>;
      actions: Array<{ sessionId: string; method: string; path: string }>;
    }>(res);
    expect(body.data!.sessions.map((s) => s.id)).toContain(sessionId);
    expect(body.data!.sessions.find((s) => s.id === sessionId)!.reason).toBe(
      '協助店家設定 LINE 官方帳號',
    );
    expect(
      body.data!.actions.some((a) => a.sessionId === sessionId && a.path === '/api/services'),
    ).toBe(true);
  });

  /**
   * ⚠️ 最終風險審查抓到的落差：端點要求 MANAGER（這份紀錄會揭露平台看過哪些頁面），
   * 但 0095 的 RLS 原本只寫 `is_tenant_member()`——任何 STAFF 拿 anon key 直打
   * PostgREST 就繞過端點的門檻讀得到。**端點的權限門檻不等於資料的權限門檻**，
   * 已把 RLS 對齊到比較嚴的那一邊，這一條兩邊都驗。
   */
  it('STAFF 讀不到：端點 403，直打 PostgREST 也讀不到（兩道門檻一致）', async () => {
    const staffApi = await loginAs(STAFF_A2.email, STAFF_A2.password);
    const res = await staffApi.get('/api/settings/impersonation-log');
    expect(res.status, 'STAFF 竟然讀得到平台協助紀錄').toBe(403);

    const anon = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: STAFF_A2.email,
      password: STAFF_A2.password,
    });
    expect(signInErr).toBeNull();
    const { data } = await anon
      .from('impersonation_sessions')
      .select('id')
      .eq('tenant_id', SHOP_A.id);
    expect(data ?? [], 'STAFF 繞過端點直讀 PostgREST 就拿到了紀錄').toEqual([]);
    // 不呼叫 signOut()：預設 global scope 會撤銷該帳號所有 session（見驗收 1 的註解）。
  });

  it('B 店 OWNER 看不到 A 店的紀錄（RLS 邊界）', async () => {
    const bOwner = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await bOwner.get('/api/settings/impersonation-log');
    expect(res.status).toBe(200);
    const body = await readJson<{ sessions: Array<{ id: string }> }>(res);
    expect(body.data!.sessions.map((s) => s.id)).not.toContain(sessionId);
  });
});

// ---------------------------------------------------------------------------
describe('驗收 7 —— provenance 只作來源 badge，不改變 owner 權限', () => {
  it('把方案標成 PLATFORM_ASSISTED 之後，店家自己仍然改得動', async () => {
    const { error: markErr } = await admin
      .from('trip_plans')
      .update({ source: 'PLATFORM_ASSISTED' })
      .eq('id', TRIP_A.planA1);
    expect(markErr).toBeNull();

    const newName = `店家自己改的名字-${suffix}`;
    const res = await ownerApi.put(`/api/trip-plans/${TRIP_A.planA1}`, { name: newName });
    expect(res.status, `店家改不動代建資料 —— provenance 變成了權限：${await res.text()}`).toBe(200);

    const { data } = await admin
      .from('trip_plans')
      .select('name, source')
      .eq('id', TRIP_A.planA1)
      .single();
    expect(data!.name).toBe(newName);
    // 來源標記不因店家編輯而消失（它記的是「當初誰建的」）。
    expect(data!.source).toBe('PLATFORM_ASSISTED');
  });
});

// ---------------------------------------------------------------------------
describe('驗收 4（續）—— 退出與失效', () => {
  it('end → session 標記 ended_at，且 current 回 active:false', async () => {
    const res = await api.post('/api/platform/impersonation/end', {});
    expect(res.status).toBe(200);

    const { data } = await admin
      .from('impersonation_sessions')
      .select('ended_at')
      .eq('id', sessionId)
      .single();
    expect(data!.ended_at).not.toBeNull();

    const cur = await api.get('/api/platform/impersonation/current');
    const body = await readJson<{ active: boolean }>(cur);
    expect(body.data!.active).toBe(false);
  });

  it('退出後的寫入回到自己的身分：管理者不是任何店的成員 → 403', async () => {
    const res = await api.post('/api/services', { name: `退出後不該寫得進去-${suffix}` });
    expect(res.status).toBe(403);
  });

  /**
   * ⚠️ 最終風險審查抓到：cookie 只有一個，所以「在 A 店代入中又 start B 店」實際上
   * 已經離開 A 店了，但 A 的那一列原本會維持 ended_at is null 直到逾時——A 店的
   * 自查頁會看到一段「進行中」的紀錄，而平台早就不在裡面。稽核紀錄說謊比沒有更糟。
   */
  it('重複 start → 前一段 session 立刻標記結束，不會留下假的「進行中」', async () => {
    const fresh = await loginAs(ADMIN_EMAIL, PASSWORD);
    const first = await fresh.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '先進 A 店，準備驗重複 start',
    });
    expect(first.status).toBe(200);
    const firstId = (await readJson<{ sessionId: string }>(first)).data!.sessionId;

    const second = await fresh.post('/api/platform/impersonation/start', {
      tenantId: SHOP_B.id,
      reason: '改進 B 店，前一段應該被結束',
    });
    expect(second.status).toBe(200);
    const secondId = (await readJson<{ sessionId: string }>(second)).data!.sessionId;
    expect(secondId).not.toBe(firstId);

    const { data } = await admin
      .from('impersonation_sessions')
      .select('id, ended_at')
      .in('id', [firstId, secondId]);
    const first_ = data!.find((r) => r.id === firstId)!;
    const second_ = data!.find((r) => r.id === secondId)!;
    expect(first_.ended_at, 'A 店那段仍顯示進行中，但平台已經不在裡面了').not.toBeNull();
    expect(second_.ended_at).toBeNull();

    await fresh.post('/api/platform/impersonation/end', {});
  });

  it('權限被撤銷 → 既有 session 立刻失效（不必等逾時）', async () => {
    const fresh = await loginAs(ADMIN_EMAIL, PASSWORD);
    const start = await fresh.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '驗證撤銷後立刻失效',
    });
    expect(start.status).toBe(200);
    const started = await readJson<{ sessionId: string }>(start);

    // 撤銷
    await admin.from('platform_admins').update({ active: false }).eq('user_id', adminUserId);

    const cur = await fresh.get('/api/platform/impersonation/current');
    const body = await readJson<{ active: boolean }>(cur);
    expect(body.data!.active, '權限撤銷後舊 session 仍然有效 —— 全平台提權').toBe(false);

    const write = await fresh.post('/api/services', { name: `撤銷後不該寫得進去-${suffix}` });
    expect(write.status).toBe(403);

    // 復原並收尾
    await admin.from('platform_admins').update({ active: true }).eq('user_id', adminUserId);
    await admin
      .from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', started.data!.sessionId);
  });

  it('逾時 → 立刻失效（直接把 expires_at 撥到過去）', async () => {
    const fresh = await loginAs(ADMIN_EMAIL, PASSWORD);
    const start = await fresh.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '驗證逾時後立刻失效',
    });
    expect(start.status).toBe(200);
    const started = await readJson<{ sessionId: string }>(start);

    // ⚠️ `started_at` 也要一起往前撥：0095 有 `expires_at > started_at` 的
    // check constraint，只改 expires_at 這筆 update 會被資料庫擋下來。
    // 第一版沒有檢查 update 的 error，於是「更新失敗」被當成「逾時沒生效」，
    // 測試紅在錯的地方（PB-023 的形狀：把失敗當成一個看起來合理的結果）。
    const past = Date.now() - 60_000;
    const { error: expireErr } = await admin
      .from('impersonation_sessions')
      .update({
        started_at: new Date(past - 1000).toISOString(),
        expires_at: new Date(past).toISOString(),
      })
      .eq('id', started.data!.sessionId);
    expect(expireErr, `撥快時鐘失敗，這個案例就什麼都沒驗到：${expireErr?.message}`).toBeNull();

    const cur = await fresh.get('/api/platform/impersonation/current');
    const body = await readJson<{ active: boolean }>(cur);
    expect(body.data!.active, '逾時後仍然有效').toBe(false);

    const write = await fresh.post('/api/services', { name: `逾時後不該寫得進去-${suffix}` });
    expect(write.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('驗收 6 —— 不取得也不共用密碼', () => {
  it('代登入路徑完全不碰密碼、不簽任何憑證（原始碼掃描）', () => {
    const files = [
      'src/server/platform-admin.ts',
      'src/app/api/platform/impersonation/start/route.ts',
      'src/app/api/platform/impersonation/end/route.ts',
      'src/app/api/platform/impersonation/current/route.ts',
      'src/app/api/platform/impersonation/target/route.ts',
    ];
    const banned = /password|passwd|\bhash\b|createHmac|signJwt|access_token|refresh_token/i;
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(banned.test(src), `${rel} 出現了密碼／憑證相關字樣`).toBe(false);
    }
  });

  it('代登入不會產生第二組登入憑證：session cookie 只存一個 uuid', async () => {
    const fresh = await loginAs(ADMIN_EMAIL, PASSWORD);
    const start = await fresh.post('/api/platform/impersonation/start', {
      tenantId: SHOP_A.id,
      reason: '驗證 cookie 內容只是一個 id',
    });
    expect(start.status).toBe(200);
    const raw = start.headers.getSetCookie().find((c) => c.startsWith('vibeai_impersonation='));
    expect(raw, '沒有設下代登入 cookie').toBeTruthy();
    const value = raw!.slice('vibeai_impersonation='.length).split(';')[0];
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(raw).toContain('HttpOnly');

    const started = await readJson<{ sessionId: string }>(start);
    await admin
      .from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', started.data!.sessionId);
  });
});
