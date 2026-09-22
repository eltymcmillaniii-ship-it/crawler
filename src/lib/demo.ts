import type { Character, Item } from './types'

let n = 1
const item = (x: Omit<Item, 'id' | 'coreValue' | 'statBonuses'> & { coreValue?: number; statBonuses?: Item['statBonuses'] }): Item => ({
  ...x,
  coreValue: x.coreValue ?? 0,
  statBonuses: x.statBonuses ?? { Strength:0, Dexterity:0, Intelligence:0, Constitution:0, Charisma:0 },
  id: `demo-item-${n++}`,
})

const emptyGear = () => ({
  Head: null, Body: null, Hands: null, Feet: null,
  'Weapon 1': null, 'Weapon 2': null, 'Accessory 1': null, 'Accessory 2': null,
})

export const demoCharacters: Character[] = [
  {
    id: 'elty', userId: 'u-elty', name: 'Elty', background: 'Former Normal Human', level: 2, unspentStatPoints: 0,
    currentHealth: 6, maxHealth: 7, portraitUrl: null, recoveryCode: 'DEMO-ELTY', setupComplete: true,
    stats: { Strength: 2, Dexterity: 1, Intelligence: 1, Constitution: 0, Charisma: 0 }, conditions: ['Poisoned'],
    skills: [{ name: 'Blades', rank: 1 }, { name: 'Scavenging', rank: 1 }, { name: 'Bullshitting', rank: 1 }],
    techniques: ['Dirty Fighting'], perks: ['Improvised Thinker'],
    gear: {
      ...emptyGear(),
      Body: item({ name: 'Spider-Silk Vest', rarity: 'S', type: 'Armor', slot: 'Body', effect: 'Ignore the first ❤️ physical damage each combat.' }),
      Feet: item({ name: 'Boots of Questionable Traction', rarity: 'B', type: 'Armor', slot: 'Feet', effect: 'Ignore knockdown once per combat.' }),
      'Weapon 1': item({ name: 'Goblin Cleaver', rarity: 'S', type: 'Weapon', slot: 'Weapon 1', effect: '❤️❤️ · Knockback on 10+.' }),
      'Weapon 2': item({ name: 'Rusty Dagger', rarity: 'B', type: 'Weapon', slot: 'Weapon 2', effect: '❤️ · Concealable.' }),
    },
    inventory: [
      item({ name: 'Minor Healing Potion', rarity: 'B', type: 'Consumable', effect: 'Restore ❤️❤️.', quantity: 3 }),
      item({ name: 'Smoke Bomb', rarity: 'B', type: 'Consumable', effect: 'Obscure a NEARBY area for one round.', quantity: 2 }),
      item({ name: 'Goblin Crown', rarity: 'B', type: 'Armor', slot: 'Head', effect: '+1 Charisma when dealing with goblins.' }),
      item({ name: 'Rat Whistle', rarity: 'S', type: 'Utility', effect: 'Once per session, summon a nearby rat. No guarantees.' }),
    ],
    boxes: [{ id: 'box-e1', name: "Bronze Asshole's Box", rarity: 'B' }],
    achievements: [{ id: 'a-e1', name: 'Pest Control', commentary: 'Killed your first dungeon creature.' }],
  },
  {
    id: 'sarah', userId: 'u-sarah', name: 'Sarah', background: 'Former Nurse', level: 2, unspentStatPoints: 0,
    currentHealth: 4, maxHealth: 7, portraitUrl: null, recoveryCode: 'DEMO-SARA', setupComplete: true,
    stats: { Strength: 0, Dexterity: 1, Intelligence: 1, Constitution: 2, Charisma: 0 }, conditions: ['Bleeding'],
    skills: [{ name: 'First Aid', rank: 1 }, { name: 'Improvised Weapons', rank: 1 }], techniques: ['Field Medic'], perks: [],
    gear: { ...emptyGear(), 'Weapon 1': item({ name: 'Iron Spear', rarity: 'B', type: 'Weapon', slot: 'Weapon 1', effect: '❤️❤️ damage.' }) },
    inventory: [item({ name: 'Antidote', rarity: 'B', type: 'Consumable', effect: 'Remove Poisoned.', quantity: 2 })],
    boxes: [], achievements: [{ id: 'a-s1', name: 'Unauthorized Surgery', commentary: 'Harvested a monster while it was still moving.' }],
  },
  {
    id: 'kevin', userId: 'u-kevin', name: 'Kevin', background: 'Former Mechanic', level: 2, unspentStatPoints: 0,
    currentHealth: 2, maxHealth: 6, portraitUrl: null, recoveryCode: 'DEMO-KEVN', setupComplete: true,
    stats: { Strength: 2, Dexterity: 0, Intelligence: 1, Constitution: 1, Charisma: 0 }, conditions: [],
    skills: [{ name: 'Mechanical Repair', rank: 1 }, { name: 'Blunt Weapons', rank: 1 }], techniques: ['Shoulder Check'], perks: ['Pack Mule'],
    gear: { ...emptyGear(), 'Weapon 1': item({ name: 'Trollbone Hammer', rarity: 'G', type: 'Weapon', slot: 'Weapon 1', effect: '❤️❤️❤️ · Push on 10+.' }) },
    inventory: [item({ name: 'Dungeon Chalk', rarity: 'B', type: 'Utility', effect: 'Marks glow for 24 hours.' })],
    boxes: [{ id: 'box-k1', name: 'Silver Adventurer Box', rarity: 'S' }],
    achievements: [{ id: 'a-k1', name: 'Human Ammunition', commentary: 'Used another crawler as a projectile.' }],
  },
]
