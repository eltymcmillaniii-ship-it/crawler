export type Rarity = 'B' | 'S' | 'G'
export type Role = 'gm' | 'player'
export type GearSlot = 'Head' | 'Shirt' | 'Pants' | 'Hands' | 'Feet' | 'Weapon 1' | 'Weapon 2' | 'Accessory 1' | 'Accessory 2'

export type Item = {
  id: string
  name: string
  rarity: Rarity
  type: 'Weapon' | 'Armor' | 'Accessory' | 'Consumable' | 'Utility' | 'Quest' | 'AI Generated'
  slot?: GearSlot
  effect: string
  coreValue: number
  statBonuses: Record<'Strength'|'Dexterity'|'Intelligence'|'Constitution'|'Charisma', number>
  quirk?: string
  quantity?: number
  tradeable?: boolean
}

export type Character = {
  id: string
  userId: string
  name: string
  background: string
  level: number
  unspentStatPoints: number
  currentHealth: number
  maxHealth: number
  portraitUrl?: string | null
  recoveryCode: string
  setupComplete: boolean
  stats: Record<'Strength' | 'Dexterity' | 'Intelligence' | 'Constitution' | 'Charisma', number>
  conditions: string[]
  skills: { name: string; rank: number }[]
  techniques: string[]
  perks: string[]
  gear: Record<GearSlot, Item | null>
  inventory: Item[]
  boxes: { id: string; name: string; rarity: Rarity }[]
  achievements: { id: string; name: string; commentary: string }[]
}

export type DungeonVerdict = {
  should_reward: boolean
  recipients: string[]
  achievement: {
    title: string
    commentary: string
  } | null
  reward: {
    kind: 'none' | 'loot_box' | 'item' | 'skill' | 'perk' | 'party_reward'
    rarity: 'none' | 'B' | 'S' | 'G'
    name: string
    effect: string
    quirk: string
    item_type?: Item['type']
    slot?: GearSlot | null
    stat_bonuses?: Record<'Strength'|'Dexterity'|'Intelligence'|'Constitution'|'Charisma', number>
  }
  reasoning_for_gm: string
}

export type TradeTarget = {
  characterId: string
  characterName: string
}

export type TradeableItem = {
  characterItemId: string
  name: string
  rarity: Rarity
  type: string
  effect: string
  quirk: string
  quantity: number
}

export type TradeRecord = {
  id: string
  senderCharacterId: string
  senderName: string
  recipientCharacterId: string
  recipientName: string
  offeredCharacterItemId: string
  offeredItemName: string
  requestedCharacterItemId?: string | null
  requestedItemName?: string | null
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  createdAt: string
  respondedAt?: string | null
}

export type LootOpenResult = {
  boxId: string
  boxName: string
  rarity: Rarity
  openingMessage: string
  item: {
    name: string
    type: Item['type']
    slot?: GearSlot
    effect: string
    quirk: string
    statBonuses: Record<'Strength'|'Dexterity'|'Intelligence'|'Constitution'|'Charisma', number>
  }
}
