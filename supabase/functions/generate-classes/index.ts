import OpenAI from 'npm:openai'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const classSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classes: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          tagline: { type: 'string' },
          starting_skill: { type: 'string' },
          dungeon_note: { type: 'string' },
        },
        required: ['name', 'tagline', 'starting_skill', 'dungeon_note'],
      },
    },
  },
  required: ['classes'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) throw new Error('Authentication required')

    const body = await req.json()
    const characterId = String(body.characterId ?? '')
    const description = String(body.description ?? '').trim()

    if (!characterId) throw new Error('characterId is required')
    if (description.length < 12) throw new Error('Give the Dungeon a little more to work with.')
    if (description.length > 1200) throw new Error('Character description is too long. Keep it under 1200 characters.')

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await sb.auth.getUser()
    if (userError || !user) throw new Error('Authentication required')

    const { data: character, error: characterError } = await sb
      .from('characters')
      .select('id,user_id,setup_complete')
      .eq('id', characterId)
      .maybeSingle()

    if (characterError) throw characterError
    if (!character || character.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'You can only generate classes for your own crawler.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
    const response = await openai.responses.create({
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-5',
      instructions: `You are a cruelly enthusiastic Dungeon AI assigning RPG classes to a new crawler based on their self-description.

Create exactly four distinct class options. The tone should be darkly comic, absurd, specific, slightly insulting, and game-show-dungeon chaotic. Make the options feel surprising but still clearly connected to the person's description. Do not copy or reference class names, characters, catchphrases, or prose from any existing book, game, show, or franchise.

Each option needs:
- name: a punchy, ridiculous class title, usually 2-7 words.
- tagline: one sentence describing what kind of disaster this class is built for.
- starting_skill: one practical, broadly usable skill name suitable for a lightweight tabletop RPG. Keep it short.
- dungeon_note: one short sarcastic sentence explaining why the Dungeon thinks this person deserves this class.

Vary the four options. At least one should lean physical, one clever/technical, one social/support, and one should be an unexpected wildcard when the description allows it. Avoid raw numeric bonuses, complicated rules, and overpowered abilities. Profanity may be used sparingly when it makes the joke better.`,
      input: JSON.stringify({ description }),
      text: { format: { type: 'json_schema', name: 'class_options', strict: true, schema: classSchema } },
    })

    return new Response(response.output_text, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
