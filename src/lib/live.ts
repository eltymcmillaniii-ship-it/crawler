import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Character, DungeonVerdict, GearSlot, Item, LootOpenResult, Rarity, Role, TradeRecord, TradeTarget, TradeableItem } from './types'

export type GameSummary = {
  id: string
  name: string
  joinCode: string
  floorNumber: number
  role: Role
  joinedAt: string
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function ensureAnonymousUser(): Promise<User> {
  const sb = client()
  const { data: sessionData, error: sessionError } = await sb.auth.getSession()
  if (sessionError) throw sessionError
  if (sessionData.session?.user) return sessionData.session.user
  const { data, error } = await sb.auth.signInAnonymously()
  if (error) throw error
  if (!data.user) throw new Error('Anonymous sign-in did not return a user.')
  return data.user
}

export async function listMyGames(userId: string): Promise<GameSummary[]> {
  const sb = client()
  const { data, error } = await sb
    .from('game_members')
    .select('game_id,role,joined_at,games(id,name,join_code,floor_number)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false })
  if (error) throw error
  return (data ?? []).flatMap((row: any) => {
    const game = Array.isArray(row.games) ? row.games[0] : row.games
    if (!game) return []
    return [{
      id: String(game.id),
      name: String(game.name),
      joinCode: String(game.join_code),
      floorNumber: Number(game.floor_number ?? 1),
      role: row.role as Role,
      joinedAt: String(row.joined_at ?? ''),
    }]
  })
}

export async function createGame(name: string): Promise<{ gameId: string; joinCode: string }> {
  const sb = client()
  const { data, error } = await sb.rpc('create_game', { p_name: name.trim() || 'Friday Crawl' })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.game_id) throw new Error('Game creation did not return a game ID.')
  return { gameId: String(row.game_id), joinCode: String(row.join_code) }
}

export async function joinGame(joinCode: string, characterName = 'Unnamed Crawler'): Promise<string> {
  const sb = client()
  const { data, error } = await sb.rpc('join_game', {
    p_join_code: joinCode.trim().toUpperCase(),
    p_character_name: characterName.trim() || 'Unnamed Crawler',
  })
  if (error) throw error
  if (!data) throw new Error('Joining the game did not return a character ID.')
  return String(data)
}

export async function completeCharacterSetup(args: {
  characterId: string
  name: string
  background: string
  stats: Character['stats']
  startingSkill: string
}) {
  const sb = client()
  const { error } = await sb.rpc('complete_character_setup', {
    p_character_id: args.characterId,
    p_name: args.name.trim(),
    p_background: args.background.trim(),
    p_stats: args.stats,
    p_starting_skill: args.startingSkill.trim(),
  })
  if (error) throw error
}

const emptyGear = (): Record<GearSlot, Item | null> => ({
  Head: null, Body: null, Hands: null, Feet: null,
  'Weapon 1': null, 'Weapon 2': null, 'Accessory 1': null, 'Accessory 2': null,
})

function normalizeItemType(value: string): Item['type'] {
  const allowed: Item['type'][] = ['Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated']
  return allowed.includes(value as Item['type']) ? value as Item['type'] : 'AI Generated'
}

function normalizeRarity(value: string): Rarity {
  return value === 'S' || value === 'G' ? value : 'B'
}

function normalizeGearSlot(value: unknown): GearSlot | undefined {
  const allowed: GearSlot[] = ['Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2']
  return allowed.includes(value as GearSlot) ? value as GearSlot : undefined
}

export async function loadCharacters(gameId: string): Promise<Character[]> {
  const sb = client()
  const { data: rows, error } = await sb.from('characters').select('*').eq('game_id', gameId).order('created_at')
  if (error) throw error
  const chars = rows ?? []
  if (!chars.length) return []
  const ids = chars.map((c: any) => c.id)
  const [skillsRes, itemsRes, achievementsRes, boxesRes] = await Promise.all([
    sb.from('skills').select('*').in('character_id', ids),
    sb.from('character_items').select('id,character_id,quantity,equipped_slot,tradeable,item:items(id,name,rarity,item_type,slot,effect,quirk,ai_generated)').in('character_id', ids),
    sb.from('achievements').select('*').in('character_id', ids).order('created_at'),
    sb.from('loot_boxes').select('*').in('character_id', ids).is('opened_at', null).order('created_at'),
  ])
  if (skillsRes.error) throw skillsRes.error
  if (itemsRes.error) throw itemsRes.error
  if (achievementsRes.error) throw achievementsRes.error
  if (boxesRes.error) throw boxesRes.error

  return chars.map((row: any) => {
    const gear = emptyGear()
    const inventory: Item[] = []
    for (const ci of (itemsRes.data ?? []).filter((x: any) => x.character_id === row.id)) {
      const raw = Array.isArray(ci.item) ? ci.item[0] : ci.item
      if (!raw) continue
      const item: Item = {
        id: String(ci.id),
        name: String(raw.name),
        rarity: normalizeRarity(String(raw.rarity)),
        type: normalizeItemType(String(raw.item_type)),
        slot: normalizeGearSlot(raw.slot),
        effect: String(raw.effect ?? ''),
        quirk: raw.quirk ? String(raw.quirk) : undefined,
        quantity: Number(ci.quantity ?? 1),
        tradeable: Boolean(ci.tradeable ?? true),
      }
      const equipped = normalizeGearSlot(ci.equipped_slot)
      if (equipped) gear[equipped] = item
      else inventory.push(item)
    }
    return {
      id: String(row.id),
      userId: String(row.user_id),
      name: String(row.name),
      background: String(row.background ?? 'Former Normal Human'),
      level: Number(row.level ?? 1),
      unspentStatPoints: Number(row.unspent_stat_points ?? 0),
      currentHealth: Number(row.current_health ?? 6),
      maxHealth: Number(row.max_health ?? 6),
      portraitUrl: row.portrait_url ? String(row.portrait_url) : null,
      setupComplete: Boolean(row.setup_complete ?? false),
      stats: { Strength:0, Dexterity:0, Intelligence:0, Constitution:0, Charisma:0, ...(row.stats ?? {}) },
      conditions: Array.isArray(row.conditions) ? row.conditions : [],
      skills: (skillsRes.data ?? []).filter((s: any) => s.character_id === row.id).map((s: any) => ({ name:String(s.name), rank:Number(s.rank ?? 1) })),
      techniques: Array.isArray(row.techniques) ? row.techniques : [],
      perks: Array.isArray(row.perks) ? row.perks : [],
      gear,
      inventory,
      boxes: (boxesRes.data ?? []).filter((b: any) => b.character_id === row.id).map((b: any) => ({ id:String(b.id), name:String(b.name), rarity:normalizeRarity(String(b.rarity)) })),
      achievements: (achievementsRes.data ?? []).filter((a: any) => a.character_id === row.id).map((a: any) => ({ id:String(a.id), name:String(a.title), commentary:String(a.commentary ?? '') })),
    }
  })
}

function itemState(character: Character) {
  const map = new Map<string, { slot: GearSlot | null; quantity: number }>()
  for (const item of character.inventory) map.set(item.id, { slot: null, quantity: item.quantity ?? 1 })
  for (const [slot, item] of Object.entries(character.gear) as [GearSlot, Item | null][]) {
    if (item) map.set(item.id, { slot, quantity: item.quantity ?? 1 })
  }
  return map
}

async function uploadDataUrlPortrait(userId: string, characterId: string, dataUrl: string) {
  const sb = client()
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${userId}/${characterId}-${Date.now()}.${ext}`
  const { error } = await sb.storage.from('character-portraits').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })
  if (error) throw error
  return sb.storage.from('character-portraits').getPublicUrl(path).data.publicUrl
}

export async function persistCharacterDiff(previous: Character, next: Character, actingUserId: string) {
  const sb = client()
  let portraitUrl = next.portraitUrl ?? null
  if (portraitUrl?.startsWith('data:')) portraitUrl = await uploadDataUrlPortrait(actingUserId, next.id, portraitUrl)

  const coreChanged = previous.name !== next.name || previous.background !== next.background || previous.level !== next.level ||
    previous.currentHealth !== next.currentHealth || previous.maxHealth !== next.maxHealth || previous.portraitUrl !== portraitUrl ||
    JSON.stringify(previous.stats) !== JSON.stringify(next.stats) || JSON.stringify(previous.conditions) !== JSON.stringify(next.conditions) ||
    JSON.stringify(previous.techniques) !== JSON.stringify(next.techniques) || JSON.stringify(previous.perks) !== JSON.stringify(next.perks)

  if (coreChanged) {
    const { error } = await sb.from('characters').update({
      name: next.name,
      background: next.background,
      level: next.level,
      current_health: next.currentHealth,
      max_health: next.maxHealth,
      portrait_url: portraitUrl,
      stats: next.stats,
      conditions: next.conditions,
      techniques: next.techniques,
      perks: next.perks,
    }).eq('id', next.id)
    if (error) throw error
  }

  const before = itemState(previous)
  const after = itemState(next)
  for (const [itemId, state] of after) {
    const prior = before.get(itemId)
    if (!prior) continue
    if (prior.slot !== state.slot || prior.quantity !== state.quantity) {
      const { error } = await sb.from('character_items').update({ equipped_slot: state.slot, quantity: Math.max(1, state.quantity) }).eq('id', itemId)
      if (error) throw error
    }
  }
  for (const [itemId] of before) {
    if (!after.has(itemId)) {
      const { error } = await sb.from('character_items').delete().eq('id', itemId)
      if (error) throw error
    }
  }
}

export async function applyDungeonVerdict(gameId: string, eventText: string, verdict: DungeonVerdict) {
  const sb = client()
  const { error } = await sb.rpc('apply_dungeon_verdict', {
    p_game_id: gameId,
    p_event_text: eventText,
    p_verdict: verdict,
  })
  if (error) throw error
}

export async function listTradeTargets(gameId: string): Promise<TradeTarget[]> {
  const sb = client()
  const { data, error } = await sb.rpc('list_trade_targets', { p_game_id: gameId })
  if (error) throw error
  return (data ?? []).map((row: any) => ({ characterId:String(row.character_id), characterName:String(row.character_name) }))
}

export async function listTradeableItems(gameId: string, characterId: string): Promise<TradeableItem[]> {
  const sb = client()
  const { data, error } = await sb.rpc('list_tradeable_items', { p_game_id: gameId, p_character_id: characterId })
  if (error) throw error
  return (data ?? []).map((row: any) => ({
    characterItemId:String(row.character_item_id),
    name:String(row.item_name),
    rarity:normalizeRarity(String(row.rarity)),
    type:String(row.item_type),
    effect:String(row.effect ?? ''),
    quirk:String(row.quirk ?? ''),
    quantity:Number(row.quantity ?? 1),
  }))
}

export async function listMyTrades(gameId: string): Promise<TradeRecord[]> {
  const sb = client()
  const { data, error } = await sb.rpc('list_my_trades', { p_game_id: gameId })
  if (error) throw error
  return (data ?? []).map((row: any) => ({
    id:String(row.trade_id),
    senderCharacterId:String(row.sender_character_id),
    senderName:String(row.sender_name),
    recipientCharacterId:String(row.recipient_character_id),
    recipientName:String(row.recipient_name),
    offeredCharacterItemId:String(row.offered_character_item_id),
    offeredItemName:String(row.offered_item_name),
    requestedCharacterItemId:row.requested_character_item_id ? String(row.requested_character_item_id) : null,
    requestedItemName:row.requested_item_name ? String(row.requested_item_name) : null,
    status:row.status as TradeRecord['status'],
    createdAt:String(row.created_at),
    respondedAt:row.responded_at ? String(row.responded_at) : null,
  }))
}

export async function createTrade(args: { gameId:string; senderCharacterId:string; recipientCharacterId:string; offeredCharacterItemId:string; requestedCharacterItemId?:string | null }) {
  const sb = client()
  const { data, error } = await sb.rpc('create_trade', {
    p_game_id:args.gameId,
    p_sender_character_id:args.senderCharacterId,
    p_recipient_character_id:args.recipientCharacterId,
    p_offered_character_item_id:args.offeredCharacterItemId,
    p_requested_character_item_id:args.requestedCharacterItemId || null,
  })
  if (error) throw error
  return String(data)
}

export async function acceptTrade(tradeId: string) {
  const { error } = await client().rpc('accept_trade', { p_trade_id: tradeId })
  if (error) throw error
}

export async function declineTrade(tradeId: string) {
  const { error } = await client().rpc('decline_trade', { p_trade_id: tradeId })
  if (error) throw error
}

export async function cancelTrade(tradeId: string) {
  const { error } = await client().rpc('cancel_trade', { p_trade_id: tradeId })
  if (error) throw error
}

export async function openLootBox(boxId: string): Promise<LootOpenResult> {
  const sb = client()
  const { data, error } = await sb.functions.invoke('open-loot-box', { body: { boxId } })
  if (error) throw error
  if (data?.error) throw new Error(String(data.error))
  return data as LootOpenResult
}

export function subscribeToGame(gameId: string, onChange: () => void): RealtimeChannel {
  const sb = client()
  let scheduled = false
  const refresh = () => {
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => { scheduled = false; onChange() }, 120)
  }
  return sb
    .channel(`crawler-game-${gameId}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'characters', filter:`game_id=eq.${gameId}` }, refresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'skills' }, refresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'character_items' }, refresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'achievements' }, refresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'loot_boxes' }, refresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'trades', filter:`game_id=eq.${gameId}` }, refresh)
    .subscribe()
}
