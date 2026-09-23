import OpenAI from 'npm:openai'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error:'Authentication required' }), {
        status:401,
        headers:{...corsHeaders,'Content-Type':'application/json'},
      })
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global:{ headers:{ Authorization:authHeader } } },
    )

    const { data:{user}, error:userError } = await sb.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error:'Authentication required' }), {
        status:401,
        headers:{...corsHeaders,'Content-Type':'application/json'},
      })
    }

    const form = await req.formData()
    const gameId = String(form.get('gameId') ?? '')
    const audio = form.get('audio')

    if (!gameId) throw new Error('gameId is required')
    if (!(audio instanceof File)) throw new Error('Audio recording is required')
    if (audio.size < 1000) throw new Error('Recording was too short to transcribe')
    if (audio.size > 20 * 1024 * 1024) throw new Error('Recording is too large. Keep voice captures shorter than about 10 minutes.')

    const { data:membership, error:membershipError } = await sb
      .from('game_members')
      .select('role')
      .eq('game_id',gameId)
      .eq('user_id',user.id)
      .eq('role','gm')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) {
      return new Response(JSON.stringify({ error:'GM authorization required' }), {
        status:403,
        headers:{...corsHeaders,'Content-Type':'application/json'},
      })
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) throw new Error('Voice transcription is not configured')

    const openai = new OpenAI({ apiKey })
    const transcript = await openai.audio.transcriptions.create({
      file: audio,
      model: Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-transcribe',
      prompt: 'Transcribe a live tabletop RPG scene. Preserve player names, game terms, item names, actions, jokes, and important outcomes. Ignore filler words where possible, but do not summarize.',
    })

    return new Response(JSON.stringify({ text: String(transcript.text ?? '').trim() }), {
      headers:{...corsHeaders,'Content-Type':'application/json'},
    })
  } catch (error) {
    return new Response(JSON.stringify({
      error:error instanceof Error ? error.message : 'Voice transcription failed',
    }), {
      status:500,
      headers:{...corsHeaders,'Content-Type':'application/json'},
    })
  }
})
