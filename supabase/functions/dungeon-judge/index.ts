import OpenAI from 'npm:openai'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    should_reward: { type: 'boolean' },
    recipients: { type: 'array', items: { type: 'string' } },
    achievement: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false,
          properties: { title: { type: 'string' }, commentary: { type: 'string' } },
          required: ['title','commentary'],
        },
      ],
    },
    reward: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['none','loot_box','item','skill','perk','party_reward'] },
        rarity: { type: 'string', enum: ['none','B','S','G'] },
        name: { type: 'string' },
        effect: { type: 'string' },
        quirk: { type: 'string' },
      },
      required: ['kind','rarity','name','effect','quirk'],
    },
    reasoning_for_gm: { type: 'string' },
  },
  required: ['should_reward','recipients','achievement','reward','reasoning_for_gm'],
}

type CharacterInput = { id?: string; name?: string }

function fallbackVerdict(body: any) {
  const event = String(body?.event ?? '').trim()
  const characters: CharacterInput[] = Array.isArray(body?.characters) ? body.characters : []
  const ids = characters.map(c => String(c?.id ?? '')).filter(Boolean)
  const lower = event.toLowerCase()

  const spectacular = /nat 12|critical|crit|spectacular|impossible|saved everyone|boss|troll|mimic|threw|explod|fire|naked|sacrifice|ridiculous/.test(lower)
  const clever = /clever|trick|trap|plan|improv|used .* as|talked|bluff|distract|creative|teamwork|combo/.test(lower)
  const disaster = /nat 2|failed|disaster|fell|blew up|friendly fire|accident/.test(lower)

  if (spectacular && ids.length) {
    return {
      should_reward: true,
      recipients: ids,
      achievement: {
        title: disaster ? 'THIS WAS NOT THE PLAN' : 'Against All Better Judgment',
        commentary: disaster
          ? 'You converted failure into a spectacle. The Dungeon has standards, but apparently not many.'
          : 'That was unnecessary, dangerous, and entertaining. Finally, someone understands the assignment.',
      },
      reward: {
        kind: 'loot_box',
        rarity: 'B',
        name: 'Bronze Box of Questionable Merit',
        effect: 'Contains one useful, weird, or situational dungeon item.',
        quirk: 'The Dungeon insists this was earned through talent rather than poor impulse control.',
      },
      reasoning_for_gm: 'Fallback judgment used because the AI judge was unavailable. The event sounded unusually risky or spectacular, so a Bronze reward was granted.',
    }
  }

  if ((clever || disaster) && ids.length) {
    return {
      should_reward: true,
      recipients: ids,
      achievement: {
        title: disaster ? 'Task Failed Successfully' : 'Disturbingly Resourceful',
        commentary: disaster
          ? 'Technically terrible. Spiritually magnificent.'
          : 'You found a solution the Dungeon did not specifically forbid. Annoying.',
      },
      reward: { kind: 'none', rarity: 'none', name: '', effect: '', quirk: '' },
      reasoning_for_gm: 'Fallback judgment used because the AI judge was unavailable. The event merited a flavor achievement but not a mechanical reward.',
    }
  }

  return {
    should_reward: false,
    recipients: [],
    achievement: null,
    reward: { kind: 'none', rarity: 'none', name: '', effect: '', quirk: '' },
    reasoning_for_gm: 'Fallback judgment used because the AI judge was unavailable. Nothing in the event clearly justified a reward.',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    if (!body.gameId) {
      return new Response(JSON.stringify({ error: 'gameId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!String(body.event ?? '').trim()) {
      return new Response(JSON.stringify({ error: 'Describe what the crawlers did first.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await sb.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: membership, error: membershipError } = await sb
      .from('game_members')
      .select('role')
      .eq('game_id', body.gameId)
      .eq('user_id', user.id)
      .eq('role', 'gm')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) {
      return new Response(JSON.stringify({ error: 'GM authorization required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fallback = fallbackVerdict(body)
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ ...fallback, source: 'fallback' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    try {
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna',
        instructions: `You are the Dungeon AI for a fast tabletop dungeon-crawl game. Judge player behavior rather than automatically rewarding it. Boring competency may get nothing. Clever, risky, funny, emergent, or spectacular play may earn a sarcastic achievement and sometimes a reward. Keep rewards rare enough to stay exciting. Bronze is useful/situational, Silver is meaningfully character-shaping, Gold is rare and can bend a normal rule. Prefer weird mechanical options over raw numerical inflation. Never create real-world dangerous instructions. The GM sees reasoning_for_gm; players do not. Recipient IDs MUST be copied exactly from the supplied character IDs. For party rewards, include every intended recipient ID. Tone should match the requested Dungeon personality.`,
        input: JSON.stringify(body),
        text: { format: { type: 'json_schema', name: 'dungeon_verdict', strict: true, schema } },
      })

      const parsed = JSON.parse(response.output_text)
      return new Response(JSON.stringify({ ...parsed, source: 'ai' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (aiError) {
      console.error('Dungeon Judge AI error:', aiError instanceof Error ? aiError.message : String(aiError))
      return new Response(JSON.stringify({ ...fallback, source: 'fallback' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
