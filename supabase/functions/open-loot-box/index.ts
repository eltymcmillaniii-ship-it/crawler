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
    opening_message: { type: 'string' },
  },
  required: ['name','item_type','slot','effect','quirk','stat_bonuses','opening_message'],
}

type Reward = {
  name: string
  item_type: 'Weapon'|'Armor'|'Accessory'|'Consumable'|'Utility'|'Quest'|'AI Generated'
  slot: 'Head'|'Body'|'Hands'|'Feet'|'Weapon 1'|'Weapon 2'|'Accessory 1'|'Accessory 2'|null
  effect: string
  quirk: string
  stat_bonuses?: { Strength:number; Dexterity:number; Intelligence:number; Constitution:number; Charisma:number }
  opening_message: string
}

const bronze: Reward[] = [
  { name:'Potion of Probably Healing', item_type:'Consumable', slot:null, effect:'Recover a small amount of health when used.', quirk:'Smells like fruit punch and poor oversight.', opening_message:'BRONZE BOX! Please enjoy this medically ambiguous beverage.' },
  { name:'Dungeon Chalk', item_type:'Utility', slot:null, effect:'Mark a route, warning, clue, or improvised symbol that is hard to miss.', quirk:'The chalk occasionally adds an insulting annotation of its own.', opening_message:'You got chalk. Try not to make this depressing.' },
  { name:'Rat Whistle', item_type:'Utility', slot:null, effect:'Once in a suitable area, attempt to attract or distract nearby vermin.', quirk:'You are not guaranteed to like what answers.', opening_message:'Congratulations. You now possess authority over absolutely no rat whatsoever.' },
  { name:'Boots of Questionable Traction', item_type:'Armor', slot:'Feet', effect:'Gain an edge when scrambling, sliding, climbing, or staying upright on bad footing.', quirk:'They squeak loudly at dramatically inappropriate moments.', opening_message:'Footwear! Finally, something standing between you and dungeon tetanus.' },
  { name:'Goblin Cleaver', item_type:'Weapon', slot:'Weapon 1', effect:'A brutal little blade that is especially useful for close, messy fighting.', quirk:'The previous owner carved “MINE” into both sides.', opening_message:'A weapon with all the craftsmanship of an angry kitchen drawer.' },
  { name:'Pocket Doorstop of Defiance', item_type:'Utility', slot:null, effect:'Jam a normal door open or closed until something stronger forces it.', quirk:'It says “TACTICAL WEDGE” in tiny gold letters.', opening_message:'At last: military-grade door management.' },
  { name:'Emergency Pocket Sand', item_type:'Consumable', slot:null, effect:'Create a brief distraction at very close range.', quirk:'Somehow gets into your own pockets too.', opening_message:'The Dungeon has reviewed your combat potential and issued dirt.' },
  { name:'Helmet of Mild Concern', item_type:'Armor', slot:'Head', effect:'Helps protect against one minor head-related mishap or falling debris.', quirk:'Whispers “duck” several seconds too late.', opening_message:'Safety equipment! This place really has changed.' },
]

const silver: Reward[] = [
  { name:'Coward’s Blade', item_type:'Weapon', slot:'Weapon 1', effect:'Becomes especially effective when used while retreating, escaping, or protecting an exit.', quirk:'The blade hums approvingly whenever you run away.', opening_message:'SILVER BOX! Heroism is optional. Survival has better benefits.' },
  { name:'Spider-Silk Vest', item_type:'Armor', slot:'Body', effect:'Once per encounter, reduce the effect of a hit, fall, or entangling hazard.', quirk:'Tiny spiders appear to be emotionally invested in your survival.', opening_message:'Fashionable, flexible, and only slightly haunted by arachnids.' },
  { name:'Ring of Bad Decisions', item_type:'Accessory', slot:'Accessory 1', effect:'Once per session, gain an edge on a reckless action you knowingly should not attempt.', quirk:'Warms noticeably whenever someone says “that’s a terrible idea.”', opening_message:'The Dungeon supports your worst instincts with jewelry.' },
  { name:'Gloves of Unscheduled Maintenance', item_type:'Armor', slot:'Hands', effect:'Once per encounter, quickly manipulate, disable, or jury-rig a simple mechanism.', quirk:'Leave greasy fingerprints even when perfectly clean.', opening_message:'For the crawler who sees a machine and immediately voids the warranty.' },
  { name:'Mimic Detector, Probably', item_type:'Utility', slot:null, effect:'Once per room, test one mundane object for suspicious dungeon behavior.', quirk:'It is wrong often enough to remain exciting.', opening_message:'A sophisticated scientific instrument consisting mostly of anxiety.' },
  { name:'Belt of Emergency Snacks', item_type:'Accessory', slot:'Accessory 2', effect:'Once per session, produce a small useful consumable ration or distraction.', quirk:'You never remember packing any of it.', opening_message:'SILVER! Your tactical doctrine now includes snacks.' },
  { name:'Lantern of Extremely Local Truth', item_type:'Utility', slot:null, effect:'Once per session, reveal one nearby hidden mundane detail, track, seam, or clue.', quirk:'Refuses to illuminate anything it considers “obvious.”', opening_message:'Behold: a lantern with opinions.' },
  { name:'Second-Chance Shoelaces', item_type:'Armor', slot:'Feet', effect:'Once per session, recover from a failed movement, balance, or escape attempt with a lesser consequence.', quirk:'They retie themselves into increasingly aggressive knots.', opening_message:'The Dungeon has issued footwear-based mercy. Do not get used to it.' },
]

const gold: Reward[] = [
  { name:'Boots of Fuck This', item_type:'Armor', slot:'Feet', effect:'Once per session, immediately escape a dangerous position you could plausibly flee from, ignoring one normal obstacle.', quirk:'The boots loudly announce your departure.', opening_message:'GOLD BOX! Sometimes discretion is the better part of screaming.' },
  { name:'Axe of Overreaction', item_type:'Weapon', slot:'Weapon 1', effect:'Once per session, turn a successful forceful attack or smash into an absurdly effective result with collateral consequences.', quirk:'Treats every problem as load-bearing.', opening_message:'You have received a sophisticated conflict-resolution device.' },
  { name:'Badge of Temporary Authority', item_type:'Accessory', slot:'Accessory 1', effect:'Once per session, declare a plausible minor fact about dungeon procedure or hierarchy; the GM decides the complication.', quirk:'The badge lists your title as “Acting Whatever.”', opening_message:'GOLD! Bureaucracy is now technically a weapon.' },
  { name:'Parachute of Dubious Timing', item_type:'Utility', slot:null, effect:'Once per session, prevent a fall from becoming catastrophic, even if you did not prepare for it.', quirk:'Deploys with a cheerful party-popper sound.', opening_message:'Gravity has filed a formal complaint.' },
  { name:'The Backup Plan', item_type:'Accessory', slot:'Accessory 2', effect:'Once per session after a plan fails, introduce one small preparation your crawler could reasonably have made beforehand.', quirk:'The item itself is just a laminated card that says “I meant to do that.”', opening_message:'GOLD BOX! Retroactive competence has been approved.' },
  { name:'Crown of Terrible Leadership', item_type:'Armor', slot:'Head', effect:'Once per session, when the whole party commits to your bad plan, everyone gains an edge on the first roll to execute it.', quirk:'The crown audibly sighs when anyone suggests caution.', opening_message:'Leadership recognized. Judgment not included.' },
]

function randomIndex(length: number) {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return bytes[0] % length
}

function offlineReward(rarity: string, existingNames: Set<string>): Reward {
  const pool = rarity === 'G' ? gold : rarity === 'S' ? silver : bronze
  const fresh = pool.filter(item => !existingNames.has(item.name.toLowerCase()))
  const choices = fresh.length ? fresh : pool
  return choices[randomIndex(choices.length)]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) throw new Error('Authentication required')
    const { boxId } = await req.json()
    if (!boxId) throw new Error('boxId is required')

    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError) throw userError
    const user = userData.user
    if (!user) throw new Error('Authentication required')

    const { data: box, error: boxError } = await caller
      .from('loot_boxes')
      .select('id,character_id,name,rarity,opened_at,preset_reward')
      .eq('id', boxId)
      .maybeSingle()
    if (boxError) throw boxError
    if (!box) return new Response(JSON.stringify({ error: 'Loot box not found or not owned by this crawler.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    if (box.opened_at) return new Response(JSON.stringify({ error: 'That loot box is already open.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { data: character, error: characterError } = await caller
      .from('characters')
      .select('id,user_id,name,background,level,stats,conditions,techniques,perks')
      .eq('id', box.character_id)
      .maybeSingle()
    if (characterError) throw characterError
    if (!character || character.user_id !== user.id) return new Response(JSON.stringify({ error: 'This is not your loot box.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const [skillsRes, itemsRes] = await Promise.all([
      caller.from('skills').select('name,rank').eq('character_id', character.id),
      caller.from('character_items').select('quantity,equipped_slot,item:items(name,rarity,item_type,slot,effect,quirk,strength_bonus,dexterity_bonus,intelligence_bonus,constitution_bonus,charisma_bonus)').eq('character_id', character.id),
    ])
    if (skillsRes.error) throw skillsRes.error
    if (itemsRes.error) throw itemsRes.error

    const existingNames = new Set(
      (itemsRes.data ?? [])
        .map((row: any) => {
          const item = Array.isArray(row.item) ? row.item[0] : row.item
          return item?.name ? String(item.name).toLowerCase() : ''
        })
        .filter(Boolean),
    )

    const context = {
      loot_box: { name: box.name, rarity: box.rarity },
      crawler: {
        name: character.name,
        background: character.background,
        level: character.level,
        stats: character.stats,
        conditions: character.conditions,
        techniques: character.techniques,
        perks: character.perks,
        skills: skillsRes.data ?? [],
        gear_and_inventory: itemsRes.data ?? [],
      },
    }

    let reward: Reward
    let source = 'offline'
    const preset = box.preset_reward && typeof box.preset_reward === 'object' ? box.preset_reward as Reward : null
    const apiKey = Deno.env.get('OPENAI_API_KEY')

    if (preset) {
      reward = {
        name: String((preset as any).name ?? 'Dungeon Item'),
        item_type: (['Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated'].includes(String((preset as any).item_type))
          ? String((preset as any).item_type)
          : 'AI Generated') as Reward['item_type'],
        slot: (['Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2'].includes(String((preset as any).slot))
          ? String((preset as any).slot)
          : null) as Reward['slot'],
        effect: String((preset as any).effect ?? ''),
        quirk: String((preset as any).quirk ?? ''),
        stat_bonuses: {
          Strength: Number((preset as any).stat_bonuses?.Strength ?? 0),
          Dexterity: Number((preset as any).stat_bonuses?.Dexterity ?? 0),
          Intelligence: Number((preset as any).stat_bonuses?.Intelligence ?? 0),
          Constitution: Number((preset as any).stat_bonuses?.Constitution ?? 0),
          Charisma: Number((preset as any).stat_bonuses?.Charisma ?? 0),
        },
        opening_message: String((preset as any).opening_message ?? 'The Dungeon has issued a direct supply allocation.'),
      }
      source = 'gm-command'
    } else if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey })
        const response = await openai.responses.create({
          model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna',
          instructions: `You are the Dungeon AI generating the contents of a tabletop RPG loot box. The box rarity is fixed and MUST NOT be upgraded. Generate exactly one surprising, funny, useful item that fits the crawler without simply duplicating their existing gear. Bronze items are useful, situational, consumable, or mildly weird. Silver items are meaningful keeper items with a strong option or once-per-combat/session ability. Gold items are rare, character-defining, and may bend one normal rule, but should not trivialize the game. Prefer new tactical behavior over raw stacking bonuses, but items may boost core stats while equipped. Always return stat_bonuses for Strength, Dexterity, Intelligence, Constitution, and Charisma, using 0 for stats not boosted. Keep bonuses modest by rarity: Bronze usually 0-1 total points, Silver 1-2, Gold 2-3 unless a rare effect clearly warrants more. Stat bonuses only matter when the item is equipped, so consumables and non-equippable utility items should normally have all zeroes. Extra attacks should be limited or conditional. Keep effects short enough to fit on an item card. Quirks can be absurd and flavorful but should not make the item unusable. opening_message is a short Dungeon AI reveal line, sarcastic and entertaining. Never provide real-world dangerous instructions.`,
          input: JSON.stringify(context),
          text: { format: { type: 'json_schema', name: 'loot_box_reward', strict: true, schema } },
        })
        reward = JSON.parse(response.output_text)
        source = 'ai'
      } catch (aiError) {
        console.error('Loot box AI error:', aiError instanceof Error ? aiError.message : String(aiError))
        reward = offlineReward(String(box.rarity), existingNames)
      }
    } else {
      reward = offlineReward(String(box.rarity), existingNames)
    }

    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error: completeError } = await service.rpc('complete_loot_box_open', {
      p_box_id: box.id,
      p_user_id: user.id,
      p_reward: reward,
    })
    if (completeError) throw completeError

    return new Response(JSON.stringify({
      boxId: box.id,
      boxName: box.name,
      rarity: box.rarity,
      openingMessage: reward.opening_message,
      source,
      item: {
        name: reward.name,
        type: reward.item_type,
        slot: reward.slot ?? undefined,
        effect: reward.effect,
        quirk: reward.quirk,
        statBonuses: reward.stat_bonuses ?? { Strength:0, Dexterity:0, Intelligence:0, Constitution:0, Charisma:0 },
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})