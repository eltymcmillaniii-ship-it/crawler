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
                { type: 'string', enum: ['Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2'] },
              ],
            },
            effect: { type: 'string' },
            quirk: { type: 'string' },
            stat_bonuses: {
              type: 'object',
              additionalProperties: false,
              properties: {
                Strength: { type: 'integer', minimum: 0, maximum: 999 },
                Dexterity: { type: 'integer', minimum: 0, maximum: 999 },
                Intelligence: { type: 'integer', minimum: 0, maximum: 999 },
                Constitution: { type: 'integer', minimum: 0, maximum: 999 },
                Charisma: { type: 'integer', minimum: 0, maximum: 999 },
              },
              required: ['Strength','Dexterity','Intelligence','Constitution','Charisma'],
            },
          },
          required: ['name','item_type','slot','effect','quirk','stat_bonuses'],
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

const zeroBonuses = () => ({ Strength:0, Dexterity:0, Intelligence:0, Constitution:0, Charisma:0 })

function explicitRecipients(command: string, chars: CharacterInput[]) {
  const lower = command.toLowerCase()
  if (/\b(everyone|everybody|all players|all crawlers|whole party|the party|party-wide)\b/.test(lower)) {
    return chars.map(c=>c.id)
  }
  const named = chars.filter(c=>{
    const name=String(c.name??'').trim().toLowerCase()
    return name.length>0 && lower.includes(name)
  }).map(c=>c.id)
  if (named.length) return named
  return chars.length===1 ? [chars[0].id] : []
}

function inferItemPlacement(command: string, item: any) {
  const text = `${command} ${item?.name??''} ${item?.effect??''}`.toLowerCase()
  let itemType = String(item?.item_type ?? 'AI Generated')
  let slot = item?.slot ?? null

  if (/\b(helmet|helm|hat|hood|crown|headgear|mask)\b/.test(text)) { itemType='Armor'; slot='Head' }
  else if (/\b(shirt|vest|jacket|coat|tunic|robe|chestplate|breastplate|jerkin|top)\b/.test(text)) { itemType='Armor'; slot='Shirt' }
  else if (/\b(pants|trousers|leggings|greaves|shorts|kilt|breeches)\b/.test(text)) { itemType='Armor'; slot='Pants' }
  else if (/\b(gloves|gauntlets|mitts|bracers|handwraps)\b/.test(text)) { itemType='Armor'; slot='Hands' }
  else if (/\b(boots|shoes|sandals|slippers|footwear)\b/.test(text)) { itemType='Armor'; slot='Feet' }
  else if (/\b(ring|amulet|necklace|pendant|charm|brooch|bracelet|accessory)\b/.test(text)) { itemType='Accessory'; slot='Accessory 1' }
  else if (/\b(sword|axe|ax|dagger|knife|hammer|bow|crossbow|staff|spear|mace|club|cleaver|blade|weapon)\b/.test(text)) { itemType='Weapon'; slot='Weapon 1' }
  else if (/\b(potion|elixir|tonic|draught|consumable)\b/.test(text)) { itemType='Consumable'; slot=null }

  if (itemType==='Weapon') slot='Weapon 1'
  if (itemType==='Accessory') slot='Accessory 1'
  if (['Consumable','Utility','Quest'].includes(itemType)) slot=null

  if (itemType==='Armor' && !['Head','Shirt','Pants','Hands','Feet'].includes(String(slot))) {
    slot='Shirt'
  }

  return { itemType, slot }
}

function normalizeCommand(parsed: any, command: string, chars: CharacterInput[]) {
  const validIds = new Set(chars.map(c=>c.id))
  const explicit = explicitRecipients(command,chars)
  const aiRecipients = Array.isArray(parsed?.recipients)
    ? parsed.recipients.filter((id:any)=>validIds.has(String(id))).map(String)
    : []
  parsed.recipients = explicit.length ? explicit : aiRecipients

  const item = parsed?.action?.item
  if (item) {
    item.stat_bonuses = { ...zeroBonuses(), ...(item.stat_bonuses ?? {}) }
    const placement = inferItemPlacement(command,item)
    item.item_type = placement.itemType
    item.slot = placement.slot

    const hasStructuredBonus = Object.values(item.stat_bonuses).some((v:any)=>Number(v)>0)
    if (hasStructuredBonus && !item.slot) {
      // Permanent core-stat bonuses only function on equipped gear.
      // If the GM did not explicitly request a consumable/non-equippable object,
      // turn the creative item into a wearable accessory rather than silently losing the bonus.
      const explicitNonEquip = /\b(potion|elixir|tonic|scroll|consumable|utility|quest item)\b/i.test(command)
      if (!explicitNonEquip) {
        item.item_type='Accessory'
        item.slot='Accessory 1'
      } else {
        item.stat_bonuses = zeroBonuses()
      }
    }
  }
  return parsed
}

function inferHealthUnits(lower: string) {
  if (/\bfull\b|\bmax\b/.test(lower)) return 0
  const hpMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hp|health points?)/)
  if (hpMatch) return Math.max(1, Math.round(Number(hpMatch[1]) * 4))
  const heartMatch = lower.match(/(\d+(?:\.\d+)?)\s*hearts?/)
  if (heartMatch) return Math.max(1, Math.round(Number(heartMatch[1]) * 4))
  return 1
}

function fallback(body: any) {
  const command = String(body?.command ?? '').trim()
  const chars: CharacterInput[] = Array.isArray(body?.characters) ? body.characters : []
  const lower = command.toLowerCase()
  const recipients = explicitRecipients(command,chars)

  const rarity = /\bgold\b/.test(lower) ? 'G' : /\bsilver\b/.test(lower) ? 'S' : 'B'

  if (/loot\s*box|box/.test(lower)) {
    const healing = /heal|healing|potion/.test(lower)
    const minorHealing = healing && /\bminor\b/.test(lower)
    return {
      summary: healing ? 'Fine. The Dungeon will issue emergency juice to the selected crawlers. Try not to waste it on something embarrassing.' : 'The Dungeon will package the GM’s general idea into a properly questionable supply box.',
      recipients,
      action: {
        kind: 'loot_box',
        rarity,
        box_name: healing ? 'Box of Barely Adequate Medical Supervision' : 'Box of Management-Mandated Generosity',
        opening_message: healing ? 'Oh good. Medical intervention. Because apparently natural selection needs supervision.' : 'Management has intervened. Please enjoy this suspiciously specific act of generosity.',
        item: {
          name: minorHealing ? 'Minor Healing Potion' : healing ? 'Healing Potion' : 'Dungeon Supply',
          item_type: healing ? 'Consumable' : 'Utility',
          slot: null,
          effect: healing ? 'Restore 0.25 HP when used.' : 'A useful supply issued directly by the GM.',
          quirk: healing ? 'Tastes aggressively medicinal.' : 'Marked PROPERTY OF THE DUNGEON.',
          stat_bonuses: zeroBonuses(),
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
        item: { name:'', item_type:'AI Generated', slot:null, effect:'', quirk:'', stat_bonuses: zeroBonuses(), },
        health_delta: /full/.test(lower) ? 0 : inferHealthUnits(lower),
        full_heal: /full/.test(lower),
      },
    }
  }

  return {
    summary: 'The Dungeon will interpret the GM’s intent and manufacture something appropriately useful, weird, and legally deniable.',
    recipients,
    action: {
      kind: 'item',
      rarity,
      box_name: '',
      opening_message: '',
      item: {
        name: 'Management-Issued Object of Dubious Merit',
        item_type: 'Accessory',
        slot: 'Accessory 1',
        effect: command || 'Issued according to the GM’s general intent.',
        quirk: 'The Dungeon would like it noted that this was management’s idea.',
        stat_bonuses: zeroBonuses(),
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

    const { data:gameContext } = await sb
      .from('games')
      .select('name,floor_number,floor_theme')
      .eq('id',gameId)
      .maybeSingle()

    const input = {
      command,
      characters,
      game: gameContext ? {
        name: String(gameContext.name ?? ''),
        floor_number: Number(gameContext.floor_number ?? 1),
        floor_theme: String(gameContext.floor_theme ?? ''),
      } : null,
    }
    const fallbackCommand = normalizeCommand(fallback(input),command,characters)
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({...fallbackCommand,source:'fallback'}), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    try {
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna',
        instructions: `You are the SAME Dungeon AI personality used by the Dungeon Judge: a smug, theatrical, sarcastic game-show system that enjoys crawler incompetence far too much. This mode is a GM OVERRIDE, so do NOT judge whether the crawlers deserve the result and do NOT create achievements. The GM has already decided that something should happen.

Interpret the GM's INTENT, not their wording. The command is a creative brief, not dictation. Preserve hard constraints exactly when the GM gives them: recipients, explicit rarity, explicit item category, explicit stat bonus amounts, explicit health amount, and any clearly required item or effect. For everything the GM leaves open, invent a polished Dungeon-style result: funny item name, concise useful effect, ridiculous quirk, sarcastic summary, and opening_message. Do not simply copy the command into the item name or effect.

Examples of intent:
- "Give everyone something to help with the cold" -> invent one fitting Dungeon item/effect with humor; do not name it "Something to Help With the Cold."
- "Give Mike a sword that boosts strength" -> create a flavorful Weapon in Weapon 1 with a sensible Strength bonus and a Dungeon-style name/quirk.
- "Give everyone a bronze box with a healing item" -> create a Bronze loot box with a guaranteed healing consumable; make the box/item names and commentary entertaining.
- "Heal Sarah 1 HP" -> perform the health change exactly, but the summary/opening commentary can still be sarcastic.

Supported actions: loot_box, item, health. Return exactly one action. Recipient IDs MUST come from the supplied character list. "Everyone", "all", or "party" means every supplied character ID. If a crawler is named, target that crawler. Never invent recipient IDs.

ITEM ASSIGNMENT RULES:
- Sword/axe/dagger/hammer/bow/staff/spear/mace/other held weapon -> item_type Weapon, slot Weapon 1.
- Ring/amulet/necklace/charm/other wearable trinket -> Accessory, slot Accessory 1.
- Helmet/hat/hood/mask -> Armor, Head.
- Shirt/vest/jacket/tunic/robe/chest armor -> Armor, Shirt.
- Pants/trousers/leggings/greaves -> Armor, Pants.
- Gloves/gauntlets/bracers -> Armor, Hands.
- Boots/shoes -> Armor, Feet.
- Consumables and utilities -> slot null.
- Permanent structured stat bonuses only work while equipped. If the GM asks for a permanent stat boost, make the item equippable unless they explicitly requested a consumable. If they explicitly request a consumable with a temporary boost, describe that temporary boost in effect and leave structured stat_bonuses at zero.

Items can boost any core stats while equipped. Always return stat_bonuses for Strength, Dexterity, Intelligence, Constitution, and Charisma, using 0 for unspecified stats. Interpret explicit numbers such as "+2 Strength" literally. If the GM only says "boost Strength" without a number, use a modest +1 unless rarity/context strongly suggests otherwise. Bronze is the default rarity unless the GM explicitly says Silver or Gold.

Use current floor/theme context when it helps flavor an underspecified request, but never let flavor override an explicit GM instruction. Keep effects short and tabletop-friendly.

Health is displayed in HP but stored in quarter-HP units. health_delta uses stored units: 1 means 0.25 HP, 2 means 0.5 HP, and 4 means 1 HP. Convert requested HP changes into quarter-HP units. full_heal=true only when explicitly asked for full/max health. A Minor Healing Potion restores exactly 0.25 HP.

summary should explain what the system interpreted, in the Dungeon AI's sarcastic voice. opening_message should be a punchy Dungeon AI broadcast line suitable for showing to the GM/player.`,
        input: JSON.stringify(input),
        text: { format:{ type:'json_schema', name:'dungeon_command', strict:true, schema } },
      })
      const parsed = normalizeCommand(JSON.parse(response.output_text),command,characters)
      return new Response(JSON.stringify({...parsed,source:'ai'}), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    } catch (e) {
      console.error('Dungeon command AI error:', e instanceof Error ? e.message : String(e))
      return new Response(JSON.stringify({...fallbackCommand,source:'fallback'}), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error:error instanceof Error?error.message:'Unknown error' }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'} })
  }
})
