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
    summary: { type: 'string' },
    recipients: { type: 'array', items: { type: 'string' } },
    action: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['loot_box','item','health'] },
        rarity: { type: 'string', enum: ['B','S','G'] },
        box_name: { type: 'string' },
        opening_message: { type: 'string' },
        item: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            item_type: { type: 'string', enum: ['Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated'] },
            slot: {
              anyOf: [
                { type: 'null' },
                { type: 'string', enum: ['Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2'] },
              ],
            },
            effect: { type: 'string' },
            quirk: { type: 'string' },
          },
          required: ['name','item_type','slot','effect','quirk'],
        },
        health_delta: { type: 'integer' },
        full_heal: { type: 'boolean' },
      },
      required: ['kind','rarity','box_name','opening_message','item','health_delta','full_heal'],
    },
  },
  required: ['summary','recipients','action'],
}

type CharacterInput = { id: string; name: string }

function fallback(body: any) {
  const command = String(body?.command ?? '').trim()
  const chars: CharacterInput[] = Array.isArray(body?.characters) ? body.characters : []
  const lower = command.toLowerCase()
  const all = /\b(everyone|everybody|all players|all crawlers|whole party|the party)\b/.test(lower)
  let recipients = all ? chars.map(c=>c.id) : chars.filter(c=>lower.includes(String(c.name).toLowerCase())).map(c=>c.id)
  if (!recipients.length && chars.length === 1) recipients = [chars[0].id]

  const rarity = /\bgold\b/.test(lower) ? 'G' : /\bsilver\b/.test(lower) ? 'S' : 'B'

  if (/loot\s*box|box/.test(lower)) {
    const healing = /heal|healing|potion/.test(lower)
    return {
      summary: healing ? 'Award the selected crawlers a loot box containing a healing potion.' : 'Award the selected crawlers a GM-defined loot box.',
      recipients,
      action: {
        kind: 'loot_box',
        rarity,
        box_name: healing ? 'Emergency Healing Supply Box' : 'Dungeon Supply Box',
        opening_message: healing ? 'DIRECTIVE RECEIVED. Apparently keeping you alive remains operationally useful.' : 'DIRECTIVE RECEIVED. The Dungeon has issued supplies.',
        item: {
          name: healing ? 'Healing Potion' : 'Dungeon Supply',
          item_type: healing ? 'Consumable' : 'Utility',
          slot: null,
          effect: healing ? 'Recover a small amount of health when used.' : 'A useful supply issued directly by the GM.',
          quirk: healing ? 'Tastes aggressively medicinal.' : 'Marked PROPERTY OF THE DUNGEON.',
        },
        health_delta: 0,
        full_heal: false,
      },
    }
  }

  if (/heal|restore.*health|full health/.test(lower)) {
    return {
      summary: /full/.test(lower) ? 'Restore the selected crawlers to full health.' : 'Restore health to the selected crawlers.',
      recipients,
      action: {
        kind: 'health',
        rarity: 'B',
        box_name: '',
        opening_message: '',
        item: { name:'', item_type:'AI Generated', slot:null, effect:'', quirk:'' },
        health_delta: /full/.test(lower) ? 0 : 1,
        full_heal: /full/.test(lower),
      },
    }
  }

  return {
    summary: 'Give the selected crawlers the requested item.',
    recipients,
    action: {
      kind: 'item',
      rarity,
      box_name: '',
      opening_message: '',
      item: {
        name: command || 'Dungeon Item',
        item_type: 'AI Generated',
        slot: null,
        effect: 'Issued directly by the GM.',
        quirk: '',
      },
      health_delta: 0,
      full_heal: false,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error:'Authentication required' }), { status:401, headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    const body = await req.json()
    const gameId = String(body?.gameId ?? '')
    const command = String(body?.command ?? '').trim()
    if (!gameId) throw new Error('gameId is required')
    if (!command) throw new Error('Enter a command first.')

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global:{ headers:{ Authorization:authHeader } } },
    )

    const { data:{ user }, error:userError } = await sb.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error:'Authentication required' }), { status:401, headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    const { data:membership, error:membershipError } = await sb
      .from('game_members')
      .select('role')
      .eq('game_id',gameId)
      .eq('user_id',user.id)
      .eq('role','gm')
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) {
      return new Response(JSON.stringify({ error:'GM authorization required' }), { status:403, headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    const characters: CharacterInput[] = Array.isArray(body?.characters)
      ? body.characters.map((c:any)=>({id:String(c?.id??''),name:String(c?.name??'')})).filter((c:CharacterInput)=>c.id)
      : []

    const input = { command, characters }
    const fallbackCommand = fallback(input)
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({...fallbackCommand,source:'fallback'}), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    try {
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna',
        instructions: `You are a command interpreter for a tabletop RPG GM. This is NOT judgment. Do not decide whether players deserve something and do not add achievements. Obey the GM's instruction as directly as possible and convert it into exactly one supported game action. Supported actions: loot_box, item, health. Recipient IDs MUST be copied exactly from the supplied character list. "Everyone", "all", or "party" means every supplied character ID. If the GM asks for a loot box containing a specific item, put that exact guaranteed item in action.item; it must not be randomized later. Keep item effects short and tabletop-friendly. Bronze is default unless the GM explicitly says Silver or Gold. If an item is a weapon use Weapon 1 as its slot; accessories use Accessory 1; armor needs the most plausible Head/Body/Hands/Feet slot; consumables and utilities use null. For health commands, use full_heal=true only when explicitly asked for full/max health; otherwise infer a small integer health_delta. summary should plainly restate what will happen before execution.`,
        input: JSON.stringify(input),
        text: { format:{ type:'json_schema', name:'dungeon_command', strict:true, schema } },
      })
      const parsed = JSON.parse(response.output_text)
      const validIds = new Set(characters.map(c=>c.id))
      parsed.recipients = Array.isArray(parsed.recipients) ? parsed.recipients.filter((id:any)=>validIds.has(String(id))).map(String) : []
      return new Response(JSON.stringify({...parsed,source:'ai'}), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    } catch (e) {
      console.error('Dungeon command AI error:', e instanceof Error ? e.message : String(e))
      return new Response(JSON.stringify({...fallbackCommand,source:'fallback'}), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error:error instanceof Error?error.message:'Unknown error' }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'} })
  }
})
