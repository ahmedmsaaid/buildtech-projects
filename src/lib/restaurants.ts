/**
 * The restaurant product's own settings: the restaurant's profile and its
 * menu. A restaurant is an account (accounts.ts) plus the profile below; the
 * two share one id. Orders live in orders.ts.
 */
import { getAccountById, getAccountBySlug, type Account } from './accounts';
import { newId, query } from './db';
import { queryFor } from './tenants';
import { takesOrders, wordsForOrdering } from './words';

export interface RestaurantProfile {
  cuisine: string;
  address: string;
  phone: string;
  whatsapp: string;
  about: string;
  map_url: string;
  hours_note: string;
  tables_count: number;
  accepts_orders: boolean;
  allows_pickup: boolean;
  prep_minutes: number;
}

/** A restaurant as the rest of the product uses it: the account and its profile together. */
export type Restaurant = Account & RestaurantProfile;

const PROFILE_COLUMNS = 'cuisine, address, phone, whatsapp, about, map_url, hours_note, tables_count, accepts_orders, allows_pickup, prep_minutes';

/** Joins an account with its restaurant profile, which is kept with the restaurant's other records. Null when the account's product does not take orders. */
async function asRestaurant(account: Account | null): Promise<Restaurant | null> {
  if (!account || !takesOrders(account.product)) return null;
  const [profile] = await queryFor<RestaurantProfile>(account.id, `select ${PROFILE_COLUMNS} from restaurants where id = $1`, [account.id]);
  return profile ? { ...account, ...profile } : null;
}

export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  return asRestaurant(await getAccountBySlug(slug));
}

export async function getRestaurantById(id: string): Promise<Restaurant | null> {
  return asRestaurant(await getAccountById(id));
}

/**
 * Turns a new account into a working restaurant: its profile and a first
 * menu category to fill in. Called by the platform when an account of this
 * product is created.
 */
export async function setUpRestaurant(accountId: string, product: string, profile: { cuisine: string; phone: string }): Promise<void> {
  await queryFor(accountId, 'insert into restaurants (id, cuisine, phone, whatsapp) values ($1, $2, $3, $3)', [accountId, profile.cuisine, profile.phone]);
  await addCategory(accountId, wordsForOrdering(product).firstCategory);
}

/** What a restaurant edits in its own settings: its name and its whole profile. */
export type RestaurantDetails = { name: string } & RestaurantProfile;

export async function updateRestaurantDetails(restaurantId: string, details: RestaurantDetails): Promise<void> {
  // The name belongs to the account; everything else is the restaurant's profile.
  await query('update accounts set name = $2 where id = $1', [restaurantId, details.name]);
  await queryFor(restaurantId, 
    `update restaurants set cuisine = $2, address = $3, phone = $4, whatsapp = $5, about = $6, map_url = $7, hours_note = $8,
       tables_count = $9, accepts_orders = $10, allows_pickup = $11, prep_minutes = $12
     where id = $1`,
    [
      restaurantId,
      details.cuisine,
      details.address,
      details.phone,
      details.whatsapp,
      details.about,
      details.map_url,
      details.hours_note,
      details.tables_count,
      details.accepts_orders,
      details.allows_pickup,
      details.prep_minutes,
    ],
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  is_available: boolean;
  sort_order: number;
}

export interface MenuCategory {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  items: MenuItem[];
}

/**
 * The menu as categories with their items, in the restaurant's order.
 * Guests get active categories only, and empty ones are left out so they
 * never see a heading with nothing under it.
 */
export async function getMenu(restaurantId: string, options: { forStaff?: boolean } = {}): Promise<MenuCategory[]> {
  const [categories, items] = await Promise.all([
    queryFor<Omit<MenuCategory, 'items'>>(restaurantId, 'select id, name, sort_order, is_active from menu_categories where restaurant_id = $1 order by sort_order, name', [
      restaurantId,
    ]),
    queryFor<MenuItem>(restaurantId, 
      'select id, category_id, name, description, price, is_available, sort_order from menu_items where restaurant_id = $1 order by sort_order, name',
      [restaurantId],
    ),
  ]);

  const menu = categories.map((category) => ({ ...category, items: items.filter((item) => item.category_id === category.id) }));
  return options.forStaff ? menu : menu.filter((category) => category.is_active && category.items.length > 0);
}

export async function addCategory(restaurantId: string, name: string): Promise<void> {
  await queryFor(restaurantId, 
    `insert into menu_categories (id, restaurant_id, name, sort_order)
     values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 1 from menu_categories where restaurant_id = $2))`,
    [newId(), restaurantId, name],
  );
}

export async function updateCategory(restaurantId: string, id: string, changes: { name: string; is_active: boolean }): Promise<void> {
  await queryFor(restaurantId, 'update menu_categories set name = $3, is_active = $4 where restaurant_id = $1 and id = $2', [restaurantId, id, changes.name, changes.is_active]);
}

/** Adds an item. Returns false when the category is not one of this restaurant's. */
export async function addItem(restaurantId: string, categoryId: string, item: { name: string; description: string; price: number }): Promise<boolean> {
  const [category] = await queryFor(restaurantId, 'select 1 from menu_categories where restaurant_id = $1 and id = $2', [restaurantId, categoryId]);
  if (!category) return false;

  await queryFor(restaurantId, 
    `insert into menu_items (id, restaurant_id, category_id, name, description, price, sort_order)
     values ($1, $2, $3, $4, $5, $6, (select coalesce(max(sort_order), 0) + 1 from menu_items where category_id = $3))`,
    [newId(), restaurantId, categoryId, item.name, item.description, item.price],
  );
  return true;
}

export async function updateItem(
  restaurantId: string,
  id: string,
  changes: { name: string; description: string; price: number; is_available: boolean },
): Promise<void> {
  await queryFor(restaurantId, 'update menu_items set name = $3, description = $4, price = $5, is_available = $6 where restaurant_id = $1 and id = $2', [
    restaurantId,
    id,
    changes.name,
    changes.description,
    changes.price,
    changes.is_available,
  ]);
}

export async function deleteItem(restaurantId: string, id: string): Promise<void> {
  await queryFor(restaurantId, 'delete from menu_items where restaurant_id = $1 and id = $2', [restaurantId, id]);
}

/** How much a restaurant is being used, for the platform owner. */
export async function getRestaurantUsage(restaurantId: string, since: string): Promise<{ label: string; value: string }[]> {
  const [usage] = await queryFor<{ orders: number; revenue: number }>(restaurantId, 
    `select count(*)::int as orders, coalesce(sum(total), 0)::int as revenue
     from orders where restaurant_id = $1 and day >= $2 and status <> 'cancelled'`,
    [restaurantId, since],
  );
  const [menu] = await queryFor<{ items: number }>(restaurantId, 'select count(*)::int as items from menu_items where restaurant_id = $1', [restaurantId]);
  return [
    { label: 'طلب في 30 يوم', value: String(usage.orders) },
    { label: 'مبيعات 30 يوم (ج)', value: String(usage.revenue) },
    { label: 'صنف في المنيو', value: String(menu.items) },
  ];
}
