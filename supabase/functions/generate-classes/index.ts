import OpenAI from 'npm:openai'

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

type ClassOption = {
  name: string
  tagline: string
  starting_skill: string
  dungeon_note: string
}

function fallbackClasses(description: string): ClassOption[] {
  const d = description.toLowerCase()
  const medical = /nurse|doctor|medic|emt|medical|health|hospital|paramedic/.test(d)
  const technical = /mechanic|engineer|developer|programmer|it\b|computer|fix|repair|electric|tech/.test(d)
  const social = /sales|teacher|bartender|manager|marketing|talk|people|customer|parent/.test(d)
  const outdoors = /hunt|fish|ranch|farm|outdoor|camp|hike|military|construction/.test(d)

  return [
    {
      name: medical ? 'Trauma Goblin With Credentials' : outdoors ? 'Feral Problem-Solving Enthusiast' : 'Weaponized Competence Gremlin',
      tagline: medical ? 'Built to keep idiots alive long enough for them to create a second emergency.' : 'Built for solving problems with whatever is nearby, including other problems.',
      starting_skill: medical ? 'First Aid' : outdoors ? 'Survival' : 'Improvisation',
      dungeon_note: medical ? 'You already work around screaming and bodily fluids. Frankly, this is barely a career change.' : 'You seem alarmingly functional under pressure. The Dungeon intends to correct that.',
    },
    {
      name: technical ? 'Duct-Tape Technomancer' : 'Certified Bad-Idea Technician',
      tagline: 'Turns broken objects, terrible plans, and questionable materials into something that probably works once.',
      starting_skill: technical ? 'Technical Troubleshooting' : 'Scavenging',
      dungeon_note: technical ? 'You fix things for a living, so naturally we have placed you somewhere everything is trying to kill you.' : 'You have the energy of someone who says “I can make that work” immediately before property damage.',
    },
    {
      name: social ? 'Hostile Negotiation Professional' : medical ? 'Bedside-Manner Extortionist' : 'Socially Questionable Diplomat',
      tagline: 'Specializes in talking people into, out of, or directly toward terrible decisions.',
      starting_skill: social ? 'People Reading' : 'Persuasion',
      dungeon_note: social ? 'You already weaponize eye contact and tone of voice. Adorable. Let us add monsters.' : 'Your survival strategy appears to involve speaking until reality gives up.',
    },
    {
      name: outdoors ? 'Predator-Adjacent Logistics Manager' : technical ? 'Panic-Fueled Systems Analyst' : 'Emergency Pants Strategist',
      tagline: outdoors ? 'Tracks threats, finds routes, and has strong opinions about what should count as edible.' : 'Thrives when the plan has failed, the map is wrong, and somebody is bleeding.',
      starting_skill: outdoors ? 'Tracking' : technical ? 'Quick Thinking' : 'Danger Sense',
      dungeon_note: outdoors ? 'You voluntarily spend time where there are no bathrooms. The Dungeon respects poor judgment.' : 'No one knows what this class is supposed to do, which puts you exactly on schedule.',
    },
  ]
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

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ classes: fallbackClasses(description), source: 'fallback' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    try {
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5',
        instructions: `You are a cruelly enthusiastic Dungeon AI assigning RPG classes to a new crawler based on their self-description.

Create exactly four distinct class options. The tone should be darkly comic, absurd, specific, slightly insulting, and game-show-dungeon chaotic. Make the options feel surprising but still clearly connected to the person's description. Do not copy or reference class names, characters, catchphrases, or prose from any existing book, game, show, or franchise.

Each option needs:
- name: a punchy, ridiculous class title, usually 2-7 words.
- tagline: one sentence describing what kind of disaster this class is built for.
- starting_skill: one practical, broadly usable skill name suitable for a lightweight tabletop RPG. Keep it short.
- dungeon_note: one short sarcastic sentence explaining why the Dungeon thinks this person deserves this class.

Vary the four options. At least one should lean physical, one clever/technical, one social/support, and one should be an unexpected wildcard when the description allows it. Avoid raw numerical bonuses, complicated rules, and overpowered abilities. Profanity may be used sparingly when it makes the joke better.`,
        input: JSON.stringify({ description }),
        text: { format: { type: 'json_schema', name: 'class_options', strict: true, schema: classSchema } },
      })

      const parsed = JSON.parse(response.output_text)
      if (!Array.isArray(parsed?.classes) || parsed.classes.length !== 4) throw new Error('Invalid class response')

      return new Response(JSON.stringify({ classes: parsed.classes, source: 'ai' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (aiError) {
      console.error('Class generation AI error:', aiError instanceof Error ? aiError.message : String(aiError))
      return new Response(JSON.stringify({ classes: fallbackClasses(description), source: 'fallback' }), {
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
