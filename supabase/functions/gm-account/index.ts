import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(url, serviceKey)

    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Authentication required' }, 401)
    const currentUser = userData.user

    const body = await req.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()
    const password = String(body?.password ?? '')

    if (!email || !email.includes('@')) return json({ error: 'Enter a valid email address.' }, 400)
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
    if (!currentUser.is_anonymous) return json({ error: 'This device is already signed in with a permanent account.' }, 409)

    const { count, error: ownerError } = await admin
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', currentUser.id)

    if (ownerError) throw ownerError
    if (!count) return json({ error: 'Only a group owner can create a GM login.' }, 403)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { crawler_gm: true },
    })

    if (createError || !created.user) {
      const message = createError?.message ?? 'Could not create GM account.'
      if (/already|registered|exists/i.test(message)) {
        return json({ error: 'That email already has an account. Sign in instead.' }, 409)
      }
      return json({ error: message }, 400)
    }

    const newUserId = created.user.id
    const { data: migrated, error: migrateError } = await admin.rpc('migrate_gm_identity', {
      p_old_user_id: currentUser.id,
      p_new_user_id: newUserId,
    })

    if (migrateError) {
      try { await admin.auth.admin.deleteUser(newUserId) } catch {}
      throw migrateError
    }

    return json({ ok: true, migratedGroups: Number(migrated ?? 0), email })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not create GM login.' }, 500)
  }
})
