import { onInit } from './db.ts';

type Cat = 'fruit' | 'vegetable' | 'leafy';
// [name, category, unit_type, rate (per kg | per piece), avg piece grams, emoji]
const CATALOG: [string, Cat, 'weight' | 'piece', number, number | null, string][] = [
  ['Tomato', 'vegetable', 'weight', 20, null, '🍅'],
  ['Potato', 'vegetable', 'weight', 14, null, '🥔'],
  ['Onion', 'vegetable', 'weight', 16, null, '🧅'],
  ['Carrot', 'vegetable', 'weight', 20, null, '🥕'],
  ['Capsicum', 'vegetable', 'weight', 28, null, '🫑'],
  ['Brinjal', 'vegetable', 'weight', 20, null, '🍆'],
  ['Cucumber', 'vegetable', 'weight', 18, null, '🥒'],
  ['Cauliflower', 'vegetable', 'piece', 8, 600, '🥦'],
  ['Cabbage', 'vegetable', 'piece', 8, 800, '🥬'],
  ['Bottle Gourd', 'vegetable', 'piece', 8, 900, '🥒'],
  ['Lady Finger', 'vegetable', 'weight', 28, null, '🌿'],
  ['Green Peas', 'vegetable', 'weight', 30, null, '🫛'],
  ['Green Chilli', 'vegetable', 'weight', 40, null, '🌶️'],
  ['Ginger', 'vegetable', 'weight', 60, null, '🫚'],
  ['Garlic', 'vegetable', 'weight', 60, null, '🧄'],
  ['Lemon', 'vegetable', 'piece', 2, 50, '🍋'],
  ['Corn', 'vegetable', 'piece', 4, 300, '🌽'],
  ['Coriander', 'leafy', 'weight', 80, null, '🌿'],
  ['Mint', 'leafy', 'weight', 80, null, '🌱'],
  ['Spinach', 'leafy', 'weight', 40, null, '🥬'],
  ['Methi', 'leafy', 'weight', 60, null, '🌿'],
  ['Curry Leaves', 'leafy', 'weight', 100, null, '🍃'],
  ['Banana', 'fruit', 'piece', 2, 120, '🍌'],
  ['Apple', 'fruit', 'weight', 30, null, '🍎'],
  ['Mango', 'fruit', 'piece', 6, 300, '🥭'],
  ['Orange', 'fruit', 'weight', 24, null, '🍊'],
  ['Grapes', 'fruit', 'weight', 30, null, '🍇'],
  ['Papaya', 'fruit', 'piece', 10, 1200, '🍈'],
  ['Pomegranate', 'fruit', 'weight', 36, null, '🍎'],
  ['Watermelon', 'fruit', 'piece', 14, 3000, '🍉'],
  ['Guava', 'fruit', 'weight', 24, null, '🍐'],
  ['Pineapple', 'fruit', 'piece', 10, 1200, '🍍'],
  ['Chikoo', 'fruit', 'weight', 24, null, '🥝'],
  ['Coconut', 'fruit', 'piece', 8, 600, '🥥'],
];

/** Fallback rates for produce not in the catalog. */
export const DEFAULT_RATES: Record<Cat, number> = { vegetable: 20, fruit: 24, leafy: 80 };

/** Inserts the catalogue once, right after the schema is created (idempotent). */
onInit(async (d) => {
  const esc = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const values = CATALOG.map(([name, category, unit, rate, grams, emoji]) =>
    `(${esc(name)}, ${esc(category)}, ${esc(unit)}, ${rate}, ${grams ?? 'NULL'}, ${esc(emoji)})`).join(', ');
  await d.exec(`INSERT INTO produce_catalog (name, category, unit_type, rate, avg_piece_grams, emoji) VALUES ${values} ON CONFLICT (name) DO NOTHING`);
});
