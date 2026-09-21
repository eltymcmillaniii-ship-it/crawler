import OpenAI from 'npm:openai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const statSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    Strength: { type: 'integer', minimum: 0, maximum: 8 },
    Dexterity: { type: 'integer', minimum: 0, maximum: 8 },
    Intelligence: { type: 'integer', minimum: 0, maximum: 8 },
    Constitution: { type: 'integer', minimum: 0, maximum: 8 },
    Charisma: { type: 'integer', minimum: 0, maximum: 8 },
  },
  required: ['Strength', 'Dexterity', 'Intelligence', 'Constitution', 'Charisma'],
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
    suggested_stats: statSchema,
  },
  required: ['classes', 'suggested_stats'],
}

type CoreStats = {
  Strength: number
  Dexterity: number
  Intelligence: number
  Constitution: number
  Charisma: number
}

type ClassOption = {
  name: string
  tagline: string
  starting_skill: string
  dungeon_note: string
}

function traits(description: string) {
  const d = description.toLowerCase()
  return {
    medical: /nurse|doctor|medic|emt|medical|health|hospital|paramedic|caregiver/.test(d),
    technical: /mechanic|engineer|developer|programmer|it\b|computer|fix|repair|electric|tech|build|maker/.test(d),
    social: /sales|teacher|bartender|manager|marketing|talk|people|customer|parent|leader|coach/.test(d),
    outdoors: /hunt|fish|ranch|farm|outdoor|camp|hike|military|construction|athlete|sports/.test(d),
  }
}

function fallbackStats(description: string): CoreStats {
  const t = traits(description)
  const stats: CoreStats = { Strength: 1, Dexterity: 1, Intelligence: 1, Constitution: 1, Charisma: 1 }
  const priorities: (keyof CoreStats)[] = []
  if (t.medical) priorities.push('Constitution', 'Intelligence')
  if (t.technical) priorities.push('Intelligence', 'Dexterity')
  if (t.social) priorities.push('Charisma', 'Intelligence')
  if (t.outdoors) priorities.push('Strength', 'Dexterity', 'Constitution')
  priorities.push('Intelligence', 'Constitution', 'Dexterity', 'Strength', 'Charisma')

  const unique = [...new Set(priorities)]
  for (const stat of unique.slice(0, 3)) stats[stat] += 1
  return stats
}

function fallbackClasses(description: string): ClassOption[] {
  const t = traits(description)

  return [
    {
      name: t.medical ? 'Trauma Goblin With Credentials' : t.outdoors ? 'Feral Problem-Solving Enthusiast' : 'Weaponized Competence Gremlin',
      tagline: t.medical ? 'Built to keep idiots alive long enough for them to create a second emergency.' : 'Built for solving problems with whatever is nearby, including other problems.',
      starting_skill: t.medical ? 'First Aid' : t.outdoors ? 'Survival' : 'Improvisation',
      dungeon_note: t.medical ? 'You already work around screaming and bodily fluids. Frankly, this is barely a career change.' : 'You seem alarmingly functional under pressure. The Dungeon intends to correct that.',
    },
    {
      name: t.technical ? 'Duct-Tape Technomancer' : 'Certified Bad-Idea Technician',
      tagline: 'Turns broken objects, terrible plans, and questionable materials into something that probably works once.',
      starting_skill: t.technical ? 'Technical Troubleshooting' : 'Scavenging',
      dungeon_note: t.technical ? 'You fix things for a living, so naturally we have placed you somewhere everything is trying to kill you.' : 'You have the energy of someone who says “I can make that work” immediately before property damage.',
    },
    {
      name: t.social ? 'Hostile Negotiation Professional' : t.medical ? 'Bedside-Manner Extortionist' : 'Socially Questionable Diplomat',
      tagline: 'Specializes in talking people into, out of, or directly toward terrible decisions.',
      starting_skill: t.social ? 'People Reading' : 'Persuasion',
      dungeon_note: t.social ? 'You already weaponize eye contact and tone of voice. Adorable. Let us add monsters.' : 'Your survival strategy appears to involve speaking until reality gives up.',
    },
    {
      name: t.outdoors ? 'Predator-Adjacent Logistics Manager' : t.technical ? 'Panic-Fueled Systems Analyst' : 'Emergency Pants Strategist',
      tagline: t.outdoors ? 'Tracks threats, finds routes, and has strong opinions about what should count as edible.' : 'Thrives when the plan has failed, the map is wrong, and somebody is bleeding.',
      starting_skill: t.outdoors ? 'Tracking' : t.technical ? 'Quick Thinking' : 'Danger Sense',
      dungeon_note: t.outdoors ? 'You voluntarily spend time where there are no bathrooms. The Dungeon respects poor judgment.' : 'No one knows what this class is supposed to do, which puts you exactly on schedule.',
    },
  ]
}

function validStats(stats: CoreStats) {
  const values = Object.values(stats)
  return values.every(v => Number.isInteger(v) && v >= 0) && values.reduce((a, b) => a + b, 0) === 8
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const description = String(body.description ?? '').trim()

    if (description.length < 12) {
      return new Response(JSON.stringify({ error: 'Give the Dungeon a little more to work with.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (description.length > 1200) {
      return new Response(JSON.stringify({ error: 'Character description is too long. Keep it under 1200 characters.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fallback = {
      classes: fallbackClasses(description),
      suggested_stats: fallbackStats(description),
      source: 'fallback',
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    try {
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5',
        instructions: `You are a cruelly enthusiastic Dungeon AI assigning RPG classes and a starting stat spread to a new crawler based on their self-description.

Create exactly four distinct class options. The tone should be darkly comic, absurd, specific, slightly insulting, and game-show-dungeon chaotic. Make the options feel surprising but still clearly connected to the person's description. Do not copy or reference class names, characters, catchphrases, or prose from any existing book, game, show, or franchise.

Each class option needs:
- name: a punchy, ridiculous class title, usually 2-7 words.
- tagline: one sentence describing what kind of disaster this class is built for.
- starting_skill: one practical, broadly usable skill name suitable for a lightweight tabletop RPG. Keep it short.
- dungeon_note: one short sarcastic sentence explaining why the Dungeon thinks this person deserves this class.

Also assign exactly 8 TOTAL starting stat points across Strength, Dexterity, Intelligence, Constitution, and Charisma based only on the self-description. Every stat must be a nonnegative integer. The five values MUST sum to exactly 8. These are a suggested starting allocation, not permanent restrictions; the player may redistribute them before entering the dungeon.

Interpret the stats broadly:
- Strength: raw physical power, lifting, force.
- Dexterity: agility, coordination, reflexes, fine motor skill.
- Intelligence: reasoning, technical knowledge, problem solving.
- Constitution: toughness, stamina, ability to keep functioning under stress.
- Charisma: persuasion, leadership, social instinct, presence.

Vary the four classes. At least one should lean physical, one clever/technical, one social/support, and one should be an unexpected wildcard when the description allows it. Avoid complicated rules and overpowered abilities. Profanity may be used sparingly when it makes the joke better.`,
        input: JSON.stringify({ description }),
        text: { format: { type: 'json_schema', name: 'class_options_and_stats', strict: true, schema: classSchema } },
      })

      const parsed = JSON.parse(response.output_text)
      if (!Array.isArray(parsed?.classes) || parsed.classes.length !== 4 || !validStats(parsed.suggested_stats as CoreStats)) {
        throw new Error('Invalid class or stat response')
      }

      return new Response(JSON.stringify({
        classes: parsed.classes,
        suggested_stats: parsed.suggested_stats,
        source: 'ai',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (aiError) {
      console.error('Class generation AI error:', aiError instanceof Error ? aiError.message : String(aiError))
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
