import { createClient } from '@supabase/supabase-js'

const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://gcvoxvjifkwpbsneijeh.supabase.co'

const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'sb_publishable_PR1dfdRpJr3VkQaPg5TthQ_1s0vytGh'

export const supabaseConfigured = Boolean(url && anonKey)
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null
